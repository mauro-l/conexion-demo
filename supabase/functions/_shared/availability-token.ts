/**
 * Availability token: stateless HS256 signing and verification, shared by the
 * Edge function (`supabase/functions/public-availability`) and the test suite.
 * It uses only cross-runtime globals (`globalThis.crypto.subtle`, `TextEncoder`,
 * `btoa`/`atob`) so the same code runs under Vitest on Node.
 *
 * The token is **signed, not encrypted**. The HMAC-SHA-256 signature proves the
 * claims were issued by the Edge function and were not tampered with; it does
 * not hide them. The base64url payload is readable by anyone holding the token,
 * and the token is handed to the browser on purpose. `slug` is a public
 * identifier and `service` is the catalog's `publicServiceToken` (the opaque
 * random value from `Servicio.public_service_token`); neither is a secret and no
 * credential is ever placed in the token. The signature exists so a future
 * writer can trust the slot, not to keep it confidential.
 */

/** Ten minutes; the spec pins `exp = iat + 600`. */
export const TOKEN_TTL_SECONDS = 600;
/** Clock skew tolerated before a token's own `iat`. */
export const CLOCK_SKEW_SECONDS = 5;

/** Public claims carried by every slot token: no internal IDs, no PII. */
export interface AvailabilityTokenClaims {
  slug: string;
  service: string;
  start: string;
  end: string;
}

/** The signed payload: the public claims plus the temporal bounds. */
export interface AvailabilityTokenPayload extends AvailabilityTokenClaims {
  iat: number;
  exp: number;
}

/** Why a token was rejected; callers branch on `ok`, never on truthiness. */
export type AvailabilityTokenFailure =
  | 'malformed'
  | 'unsupported_algorithm'
  | 'invalid_signature'
  | 'expired'
  | 'not_yet_valid';

/** Verification result; an invalid token never produces `ok: true`. */
export type AvailabilityTokenVerification =
  | { ok: true; payload: AvailabilityTokenPayload }
  | { ok: false; reason: AvailabilityTokenFailure };

const HEADER = { alg: 'HS256', typ: 'JWT' } as const;
const REQUIRED_CLAIMS = ['slug', 'service', 'start', 'end', 'iat', 'exp'] as const;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  // Unpadded base64url: it is a URL segment, not standard base64.
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlFromJson(value: unknown): string {
  return base64UrlFromBytes(new TextEncoder().encode(JSON.stringify(value)));
}

/** Strict base64url decode; `null` on a non-alphabet character or bad length. */
function base64UrlToBytes(value: string): Uint8Array | null {
  if (!BASE64URL_RE.test(value) || value.length % 4 === 1) return null;
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Imported HMAC keys, memoized per secret.
 *
 * `importKey` is async and costs roughly as much as one `sign`, and a
 * full-window availability response signs one token per slot (~249 with the
 * current window), all under the same secret. Importing once per secret removes
 * ~249 redundant key imports from every request without changing the key
 * material, the algorithm, the signing input, or any signed byte. The cache only
 * ever holds secret values this process already receives from its environment.
 */
const hmacKeyCache = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  const cached = hmacKeyCache.get(secret);
  if (cached) return cached;
  const pending = globalThis.crypto.subtle
    .importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
      'sign',
    ])
    .catch((error: unknown) => {
      // A failed import must not poison the cache for later requests.
      hmacKeyCache.delete(secret);
      throw error;
    });
  hmacKeyCache.set(secret, pending);
  return pending;
}

/** HMAC-SHA-256 over a UTF-8 signing input; used by signing and verification. */
async function hmacSignature(signingInput: string, secret: string): Promise<Uint8Array> {
  const key = await hmacKey(secret);
  const input = new TextEncoder().encode(signingInput);
  return new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', key, input));
}

/**
 * Constant-time byte comparison with no early exit. Signatures are always 32
 * bytes, so the length guard leaks nothing useful; JavaScript cannot promise
 * true constant time under a JIT, but the loop has no data-dependent branch.
 */
function signaturesMatch(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Accepts only an object with exactly the six required fields of the right type. */
function readPayload(value: unknown): AvailabilityTokenPayload | null {
  if (value === null || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== REQUIRED_CLAIMS.length) return null;
  for (const key of REQUIRED_CLAIMS) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) return null;
  }
  if (
    typeof record.slug !== 'string' ||
    typeof record.service !== 'string' ||
    typeof record.start !== 'string' ||
    typeof record.end !== 'string' ||
    typeof record.iat !== 'number' ||
    typeof record.exp !== 'number' ||
    !Number.isFinite(record.iat) ||
    !Number.isFinite(record.exp)
  ) {
    return null;
  }
  return record as unknown as AvailabilityTokenPayload;
}

/**
 * Signs a token as `base64url(header).base64url(payload).base64url(signature)`
 * (HS256). Pure: `secret` and `iatSeconds` are injected for testing. The payload
 * carries exactly `slug`, `service`, `start`, `end`, `iat`, `exp` (no version),
 * and `start`/`end` stay exactly as the RPC returned them.
 *
 * Signed, not encrypted: the claims above remain readable from the payload
 * segment; only their integrity is protected by the signature.
 */
export async function signAvailabilityToken(
  claims: AvailabilityTokenClaims,
  secret: string,
  iatSeconds: number
): Promise<string> {
  const header = base64UrlFromJson(HEADER);
  const payload = base64UrlFromJson({
    slug: claims.slug,
    service: claims.service,
    start: claims.start,
    end: claims.end,
    iat: iatSeconds,
    exp: iatSeconds + TOKEN_TTL_SECONDS,
  });
  const signingInput = `${header}.${payload}`;
  return `${signingInput}.${base64UrlFromBytes(await hmacSignature(signingInput, secret))}`;
}

/**
 * Verifies a token at `nowSeconds`. Rejects `now >= exp` with no positive expiry
 * tolerance, allows up to `CLOCK_SKEW_SECONDS` before `iat`, compares the
 * signature in constant time, and rejects malformed input, a wrong/missing
 * `alg`, or a tampered payload.
 */
export async function verifyAvailabilityToken(
  token: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Promise<AvailabilityTokenVerification> {
  const segments = token.split('.');
  if (segments.length !== 3) return { ok: false, reason: 'malformed' };
  const [headerSegment, payloadSegment, signatureSegment] = segments;

  const headerBytes = base64UrlToBytes(headerSegment);
  const payloadBytes = base64UrlToBytes(payloadSegment);
  const providedSignature = base64UrlToBytes(signatureSegment);
  if (!headerBytes || !payloadBytes || !providedSignature) return { ok: false, reason: 'malformed' };

  let header: unknown;
  let rawPayload: unknown;
  try {
    const decoder = new TextDecoder();
    header = JSON.parse(decoder.decode(headerBytes));
    rawPayload = JSON.parse(decoder.decode(payloadBytes));
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  const alg = (header as { alg?: unknown } | null)?.alg;
  if (alg !== 'HS256') return { ok: false, reason: 'unsupported_algorithm' };

  const expectedSignature = await hmacSignature(`${headerSegment}.${payloadSegment}`, secret);
  if (!signaturesMatch(providedSignature, expectedSignature)) {
    return { ok: false, reason: 'invalid_signature' };
  }

  const payload = readPayload(rawPayload);
  if (!payload) return { ok: false, reason: 'malformed' };
  if (nowSeconds >= payload.exp) return { ok: false, reason: 'expired' };
  if (nowSeconds < payload.iat - CLOCK_SKEW_SECONDS) return { ok: false, reason: 'not_yet_valid' };
  return { ok: true, payload };
}
