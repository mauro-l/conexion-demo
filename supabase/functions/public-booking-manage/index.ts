import { createServiceClient } from '../_shared/supabase.ts';
import { errorResponse, handleOptions, jsonResponse, READ_METHODS } from '../_shared/http.ts';
import {
  hashManagementToken,
  MANAGEMENT_TOKEN_RE,
} from '../_shared/management-token.ts';

const FUNCTION_NAME = 'public-booking-manage';
const STATUS_BY_CODE: Record<string, number> = {
  PUBLIC_RESOURCE_NOT_FOUND: 404,
  TOKEN_REVOKED: 410,
  TOKEN_EXPIRED: 410,
  INVALID_INPUT: 400,
};

/** Read a minimal booking summary using possession of its opaque token. */
Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return handleOptions(origin, true, READ_METHODS);
  if (req.method !== 'GET') {
    return errorResponse(
      'METHOD_NOT_ALLOWED',
      'Method not allowed',
      405,
      false,
      origin,
      true,
      READ_METHODS
    );
  }

  const token = new URL(req.url).searchParams.get('token') ?? '';
  if (!MANAGEMENT_TOKEN_RE.test(token)) {
    return errorResponse('INVALID_INPUT', 'Invalid input', 400, false, origin, true, READ_METHODS);
  }

  try {
    const p_token_hash = await hashManagementToken(token);
    const sb = createServiceClient();
    const { data, error } = await sb.rpc('public_gestionar_turno', { p_token_hash });
    if (error) throw error;

    const payload = (data ?? {}) as Record<string, unknown>;
    const rpcError = payload.error as { code?: string; message?: string } | undefined;
    if (rpcError?.code) {
      const status = STATUS_BY_CODE[rpcError.code] ?? 500;
      return errorResponse(
        status === 500 ? 'INTERNAL_ERROR' : rpcError.code,
        status === 500 ? 'Internal error' : rpcError.message ?? 'Booking management rejected',
        status,
        false,
        origin,
        true,
        READ_METHODS
      );
    }

    return jsonResponse(payload, 200, origin, true, READ_METHODS);
  } catch {
    console.error(`${FUNCTION_NAME} error`);
    return errorResponse('INTERNAL_ERROR', 'Internal error', 500, false, origin, true, READ_METHODS);
  }
});
