import { createServiceClient } from '../_shared/supabase.ts';
import {
  errorResponse,
  handleOptions,
  jsonResponse,
  WRITE_METHODS,
} from '../_shared/http.ts';
import {
  verifyAvailabilityToken,
  type AvailabilityTokenFailure,
} from '../_shared/availability-token.ts';
import { generateManagementToken, hashManagementToken } from '../_shared/management-token.ts';

const FUNCTION_NAME = 'public-booking';
const MAX_BODY_BYTES = 4096;
const MAX_NAME_CHARS = 80;
const MAX_EMAIL_CHARS = 254;
const MAX_RAW_PHONE_CHARS = 40;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{1,255}$/;

/**
 * RPC error code -> HTTP status. Every code the booking RPC can return is
 * mapped, so the browser never has to interpret a status it cannot act on.
 * The codes themselves are the RPC's stable public contract.
 */
const STATUS_BY_CODE: Record<string, number> = {
  PUBLIC_RESOURCE_NOT_FOUND: 404,
  INVALID_INPUT: 400,
  AREA_NOT_ALLOWED: 400,
  SERVICE_NOT_BOOKABLE: 409,
  PAST_START: 409,
  OUTSIDE_WORKING_HOURS: 409,
  BLOCKED_SLOT: 409,
  SLOT_UNAVAILABLE: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
};

/** A rejected token is a client problem; 410 tells it to re-read availability. */
const TOKEN_FAILURE_STATUS: Record<AvailabilityTokenFailure, number> = {
  malformed: 400,
  unsupported_algorithm: 400,
  invalid_signature: 400,
  expired: 410,
  not_yet_valid: 400,
};

/**
 * Public booking writer.
 *
 * The browser POSTs here directly, so this endpoint is anonymous by design:
 * `verify_jwt` is false and there is no session. Authorization comes entirely
 * from the signed availability token the caller presents — it is unforgeable,
 * bound to one shop, one service and one start time, and expires in ten
 * minutes. The caller never names the shop, the service or the slot: those
 * claims come out of the verified token, so a tampered body cannot move a
 * booking to a different slot.
 *
 * On success, the Edge also mints a one-time management token; only its hash is
 * sent to Postgres, and the raw token is returned to the visitor once.
 *
 * CORS is not an authorization boundary here. The origin allow-list decides
 * only whether a browser is allowed to read the response, and `Origin` is
 * trivially spoofed outside a browser. The real gate is the token plus the
 * RPC's server-side revalidation; the plans defer rate limiting.
 */
Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return handleOptions(origin, true, WRITE_METHODS);
  if (req.method !== 'POST') {
    return errorResponse(
      'METHOD_NOT_ALLOWED',
      'Method not allowed',
      405,
      false,
      origin,
      true,
      WRITE_METHODS
    );
  }

  const invalid = (code = 'INVALID_INPUT', message = 'Invalid input') =>
    errorResponse(code, message, 400, false, origin, true, WRITE_METHODS);

  const secret = Deno.env.get('PUBLIC_AVAILABILITY_HMAC_SECRET') ?? '';
  if (secret === '') {
    // Fail closed: never accept a booking while unable to verify a token.
    console.error(
      `${FUNCTION_NAME} misconfigured: PUBLIC_AVAILABILITY_HMAC_SECRET is missing or empty`
    );
    return errorResponse('INTERNAL_ERROR', 'Internal error', 500, false, origin, true, WRITE_METHODS);
  }

  const idempotencyKey = (req.headers.get('idempotency-key') ?? '').trim();
  if (!IDEMPOTENCY_KEY_RE.test(idempotencyKey)) {
    return invalid('INVALID_INPUT', 'A valid Idempotency-Key header is required');
  }

  const rawBody = await req.text();
  if (rawBody.length === 0 || rawBody.length > MAX_BODY_BYTES) return invalid();

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return invalid();
  }
  if (body === null || typeof body !== 'object') return invalid();
  const input = body as Record<string, unknown>;
  const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

  const token = asText(input.token);
  const nombre = asText(input.nombre);
  const apellido = asText(input.apellido);
  const telefono = asText(input.telefono);
  const telefonoRaw = asText(input.telefonoRaw);
  const email = asText(input.email);

  // Only presence and bounds are checked here. The phone and email FORMATS are
  // deliberately left to the RPC, which owns those rules and already enforces
  // them: duplicating the patterns here would create a second copy of each that
  // can drift out of step.
  if (
    token === '' ||
    nombre.length < 2 ||
    nombre.length > MAX_NAME_CHARS ||
    apellido.length < 2 ||
    apellido.length > MAX_NAME_CHARS ||
    telefono === '' ||
    telefonoRaw.length > MAX_RAW_PHONE_CHARS ||
    email === '' ||
    email.length > MAX_EMAIL_CHARS
  ) {
    return invalid();
  }

  const verdict = await verifyAvailabilityToken(token, secret);
  if (!verdict.ok) {
    return errorResponse(
      `TOKEN_${verdict.reason.toUpperCase()}`,
      'Availability token rejected',
      TOKEN_FAILURE_STATUS[verdict.reason] ?? 400,
      false,
      origin,
      true,
      WRITE_METHODS
    );
  }
  const { slug, service, start } = verdict.payload;

  try {
    const managementToken = generateManagementToken();
    const managementTokenHash = await hashManagementToken(managementToken);
    const sb = createServiceClient();
    const { data, error } = await sb.rpc('public_crear_turno', {
      p_slug: slug,
      p_service_token: service,
      p_inicio: start,
      p_nombre: nombre,
      p_apellido: apellido,
      p_telefono: telefono,
      p_telefono_raw: telefonoRaw === '' ? telefono : telefonoRaw,
      p_email: email,
      p_management_token_hash: managementTokenHash,
      p_idempotency_key: idempotencyKey,
    });
    if (error) throw error;

    const payload = (data ?? {}) as Record<string, unknown>;
    const rpcError = payload.error as { code?: string; message?: string } | undefined;
    if (rpcError?.code) {
      const status = STATUS_BY_CODE[rpcError.code] ?? 500;
      if (status === 500) console.error(`${FUNCTION_NAME} RPC error`, rpcError);
      return errorResponse(
        status === 500 ? 'INTERNAL_ERROR' : rpcError.code,
        status === 500 ? 'Internal error' : rpcError.message ?? 'Booking rejected',
        status,
        false,
        origin,
        true,
        WRITE_METHODS
      );
    }

    const { managementTokenRegistered, ...publicPayload } = payload;
    if (managementTokenRegistered === true) {
      return jsonResponse(
        {
          booking: payload.booking,
          management: { token: managementToken, expiresAt: start },
        },
        201,
        origin,
        true,
        WRITE_METHODS
      );
    }

    return jsonResponse(publicPayload, 201, origin, true, WRITE_METHODS);
  } catch {
    // Do not expose the management-token hash through error details.
    console.error(`${FUNCTION_NAME} error`);
    return errorResponse('INTERNAL_ERROR', 'Internal error', 500, false, origin, true, WRITE_METHODS);
  }
});
