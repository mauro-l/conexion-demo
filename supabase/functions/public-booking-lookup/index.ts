import { createServiceClient } from '../_shared/supabase.ts';
import {
  errorResponse,
  handleOptions,
  jsonResponse,
  WRITE_METHODS,
} from '../_shared/http.ts';
import { generateManagementToken, hashManagementToken } from '../_shared/management-token.ts';

const FUNCTION_NAME = 'public-booking-lookup';
const MAX_BODY_BYTES = 1024;
const MAX_NAME_CHARS = 80;

/**
 * RPC error code -> HTTP status. Both codes the lookup RPC can return are
 * mapped, so the Next route forwards them unchanged. The codes themselves are
 * the RPC's stable public contract.
 */
const STATUS_BY_CODE: Record<string, number> = {
  PUBLIC_RESOURCE_NOT_FOUND: 404,
  INVALID_INPUT: 400,
};

/**
 * Recover a booking from the visitor's own identity and mint a fresh
 * management token for it.
 *
 * Called server-to-server by the Next route, so the browser never sees this
 * endpoint and there is no CORS exposure of the response. The shop slug is
 * resolved server-side and sent in the body, so the browser can never choose
 * which shop is searched.
 *
 * The raw token is minted here and only its SHA-256 hash reaches Postgres,
 * the same split as `public-booking`. Neither the token, the hash nor the
 * request payload is ever logged.
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

  const rawBody = await req.text();
  if (rawBody.length === 0 || new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return invalid();
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return invalid();
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return invalid();
  const input = body as Record<string, unknown>;
  const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

  const slug = asText(input.slug);
  const nombre = asText(input.nombre);
  const apellido = asText(input.apellido);
  const telefono = asText(input.telefono);

  // Only presence and bounds are checked here. The phone FORMAT is
  // deliberately left to the RPC, which owns that rule and already enforces
  // it: duplicating the pattern here would create a second copy that can drift
  // out of step, exactly as `public-booking` does it.
  if (
    slug === '' ||
    nombre.length < 2 ||
    nombre.length > MAX_NAME_CHARS ||
    apellido.length < 2 ||
    apellido.length > MAX_NAME_CHARS ||
    telefono === '' ||
    telefono.length > 32
  ) {
    return invalid();
  }

  try {
    const managementToken = generateManagementToken();
    const managementTokenHash = await hashManagementToken(managementToken);
    const sb = createServiceClient();
    const { data, error } = await sb.rpc('public_recuperar_turno', {
      p_slug: slug,
      p_nombre: nombre,
      p_apellido: apellido,
      p_telefono: telefono,
      p_token_hash: managementTokenHash,
    });
    if (error) throw error;

    const payload = (data ?? {}) as Record<string, unknown>;
    const rpcError = payload.error as { code?: string; message?: string } | undefined;
    if (rpcError?.code) {
      const status = STATUS_BY_CODE[rpcError.code] ?? 500;
      if (status === 500) console.error(`${FUNCTION_NAME} RPC error`, rpcError);
      return errorResponse(
        status === 500 ? 'INTERNAL_ERROR' : rpcError.code,
        status === 500 ? 'Internal error' : rpcError.message ?? 'Lookup rejected',
        status,
        false,
        origin,
        true,
        WRITE_METHODS
      );
    }

    const { managementTokenRegistered, ...publicPayload } = payload;
    if (managementTokenRegistered === true) {
      const booking = (payload.booking ?? {}) as Record<string, unknown>;
      return jsonResponse(
        {
          booking,
          management: { token: managementToken, expiresAt: booking.start },
        },
        200,
        origin,
        true,
        WRITE_METHODS
      );
    }

    return jsonResponse(publicPayload, 200, origin, true, WRITE_METHODS);
  } catch {
    // Do not expose the management-token hash through error details.
    console.error(`${FUNCTION_NAME} error`);
    return errorResponse('INTERNAL_ERROR', 'Internal error', 500, false, origin, true, WRITE_METHODS);
  }
});
