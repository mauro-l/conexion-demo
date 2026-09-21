import { createServiceClient } from '../_shared/supabase.ts';
import { errorResponse, handleOptions, jsonResponse } from '../_shared/http.ts';

const FUNCTION_NAME = 'public-availability';
const SLUG_RE = /^[a-z0-9-]{1,63}$/;
// Matches the phase11 default `encode(gen_random_bytes(16), 'hex')`: opaque, 32 hex.
const SERVICE_TOKEN_RE = /^[a-f0-9]{32}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_QUERY_PARAMS = new Set(['slug', 'service', 'date']);
const TOKEN_TTL_SECONDS = 600;

export interface AvailabilityTokenClaims {
  slug: string;
  service: string;
  start: string;
  end: string;
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  // Unpadded base64url: it is a URL segment, not standard base64.
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlFromJson(value: unknown): string {
  return base64UrlFromBytes(new TextEncoder().encode(JSON.stringify(value)));
}

/**
 * Signs one availability token as `base64url(header).base64url(payload).base64url(signature)`
 * (HS256). Pure and side-effect-free: `secret` and `iatSeconds` are injected, so a
 * later slice can unit-test it with fixed inputs without booting the HTTP server.
 * The payload carries exactly `slug`, `service`, `start`, `end`, `iat`, `exp`
 * (no version field), and `start`/`end` stay exactly as the RPC returned them.
 */
export async function signAvailabilityToken(
  claims: AvailabilityTokenClaims,
  secret: string,
  iatSeconds: number
): Promise<string> {
  const header = base64UrlFromJson({ alg: 'HS256', typ: 'JWT' });
  const payload = base64UrlFromJson({
    slug: claims.slug,
    service: claims.service,
    start: claims.start,
    end: claims.end,
    iat: iatSeconds,
    exp: iatSeconds + TOKEN_TTL_SECONDS,
  });
  const signingInput = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${base64UrlFromBytes(new Uint8Array(signature))}`;
}

function isCalendarDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function hasUnknownQueryParam(params: URLSearchParams): boolean {
  for (const key of params.keys()) {
    if (!ALLOWED_QUERY_PARAMS.has(key)) return true;
  }
  return false;
}

async function signDay(
  day: Record<string, unknown>,
  claims: { slug: string; service: string },
  secret: string,
  iatSeconds: number
): Promise<Record<string, unknown>> {
  const slots = Array.isArray(day.slots) ? day.slots : [];
  const signedSlots = await Promise.all(
    slots.map(async (rawSlot) => {
      const slot = (rawSlot ?? {}) as Record<string, unknown>;
      const availabilityToken = await signAvailabilityToken(
        {
          slug: claims.slug,
          service: claims.service,
          start: String(slot.start ?? ''),
          end: String(slot.end ?? ''),
        },
        secret,
        iatSeconds
      );
      return { ...slot, availabilityToken };
    })
  );
  return { ...day, slots: signedSlots };
}

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return handleOptions(origin, true);
  if (req.method !== 'GET') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Method not allowed', 405, false, origin, true);
  }

  const url = new URL(req.url);
  if (hasUnknownQueryParam(url.searchParams)) {
    return errorResponse('INVALID_INPUT', 'Unknown query parameter', 400, false, origin, true);
  }

  const slug = url.searchParams.get('slug')?.trim() ?? '';
  if (!SLUG_RE.test(slug)) {
    return errorResponse('INVALID_INPUT', 'Invalid slug', 400, false, origin, true);
  }

  const service = url.searchParams.get('service')?.trim() ?? '';
  if (!SERVICE_TOKEN_RE.test(service)) {
    return errorResponse('INVALID_INPUT', 'Invalid service token', 400, false, origin, true);
  }

  const rawDate = url.searchParams.get('date');
  const date = rawDate?.trim() ?? '';
  if (rawDate !== null && !isCalendarDate(date)) {
    return errorResponse('INVALID_INPUT', 'Invalid date', 400, false, origin, true);
  }

  const secret = Deno.env.get('PUBLIC_AVAILABILITY_HMAC_SECRET') ?? '';
  if (secret === '') {
    // Fail closed: never sign with a fallback or default secret.
    console.error(
      `${FUNCTION_NAME} misconfigured: PUBLIC_AVAILABILITY_HMAC_SECRET is missing or empty`
    );
    return errorResponse('INTERNAL_ERROR', 'Internal error', 500, false, origin, true);
  }

  try {
    const sb = createServiceClient();
    const { data, error } = await sb.rpc('public_availability', {
      p_slug: slug,
      p_service_token: service,
    });
    if (error) throw error;

    const payload = (data ?? {}) as Record<string, unknown>;
    const rpcError = payload.error as { code?: string } | null | undefined;
    if (rpcError?.code === 'PUBLIC_RESOURCE_NOT_FOUND') {
      return errorResponse(
        'PUBLIC_RESOURCE_NOT_FOUND',
        'Resource not found',
        404,
        false,
        origin,
        true
      );
    }
    if (rpcError) {
      console.error(`${FUNCTION_NAME} RPC error`, rpcError);
      return errorResponse('INTERNAL_ERROR', 'Internal error', 500, false, origin, true);
    }

    const days = Array.isArray(payload.days)
      ? (payload.days as Record<string, unknown>[])
      : [];
    const iatSeconds = Math.floor(Date.now() / 1000);

    // The availability window is owned by the database: the RPC decides what
    // "in range" means. The Edge only checks membership against the days the RPC
    // actually returned.
    if (date !== '') {
      const selectedDay = days.find((day) => day.date === date);
      if (!selectedDay) {
        return errorResponse(
          'AVAILABILITY_RANGE_EXCEEDED',
          'Requested date is outside the availability window',
          400,
          false,
          origin,
          true
        );
      }
      const signedDay = await signDay(selectedDay, { slug, service }, secret, iatSeconds);
      return jsonResponse({ ...payload, days: [signedDay] }, 200, origin, true);
    }

    const signedDays = await Promise.all(
      days.map((day) => signDay(day, { slug, service }, secret, iatSeconds))
    );
    return jsonResponse({ ...payload, days: signedDays }, 200, origin, true);
  } catch (err) {
    console.error(`${FUNCTION_NAME} error`, err);
    return errorResponse('INTERNAL_ERROR', 'Internal error', 500, false, origin, true);
  }
});
