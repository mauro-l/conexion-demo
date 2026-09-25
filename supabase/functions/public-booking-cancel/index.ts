import { createServiceClient } from '../_shared/supabase.ts';
import { errorResponse, handleOptions, jsonResponse, WRITE_METHODS } from '../_shared/http.ts';
import {
  hashManagementToken,
  MANAGEMENT_TOKEN_RE,
} from '../_shared/management-token.ts';

const FUNCTION_NAME = 'public-booking-cancel';
const MAX_BODY_BYTES = 1024;
const STATUS_BY_CODE: Record<string, number> = {
  CANCEL_TOO_LATE: 409,
  NOT_CANCELLABLE: 409,
  TOKEN_REVOKED: 410,
  TOKEN_EXPIRED: 410,
  PUBLIC_RESOURCE_NOT_FOUND: 404,
  INVALID_INPUT: 400,
};

/** Cancel a booking idempotently using possession of its opaque token. */
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

  const rawBody = await req.text();
  if (rawBody.length === 0 || new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return errorResponse('INVALID_INPUT', 'Invalid input', 400, false, origin, true, WRITE_METHODS);
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return errorResponse('INVALID_INPUT', 'Invalid input', 400, false, origin, true, WRITE_METHODS);
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return errorResponse('INVALID_INPUT', 'Invalid input', 400, false, origin, true, WRITE_METHODS);
  }
  const token = (body as Record<string, unknown>).token;
  if (typeof token !== 'string' || !MANAGEMENT_TOKEN_RE.test(token)) {
    return errorResponse('INVALID_INPUT', 'Invalid input', 400, false, origin, true, WRITE_METHODS);
  }

  try {
    const p_token_hash = await hashManagementToken(token);
    const sb = createServiceClient();
    const { data, error } = await sb.rpc('public_cancelar_turno', { p_token_hash });
    if (error) throw error;

    const payload = (data ?? {}) as Record<string, unknown>;
    const rpcError = payload.error as { code?: string; message?: string } | undefined;
    if (rpcError?.code) {
      const status = STATUS_BY_CODE[rpcError.code] ?? 500;
      return errorResponse(
        status === 500 ? 'INTERNAL_ERROR' : rpcError.code,
        status === 500 ? 'Internal error' : rpcError.message ?? 'Booking cancellation rejected',
        status,
        false,
        origin,
        true,
        WRITE_METHODS
      );
    }

    return jsonResponse(payload, 200, origin, true, WRITE_METHODS);
  } catch {
    console.error(`${FUNCTION_NAME} error`);
    return errorResponse('INTERNAL_ERROR', 'Internal error', 500, false, origin, true, WRITE_METHODS);
  }
});
