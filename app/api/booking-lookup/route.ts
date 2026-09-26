import { PublicApiError } from '~/lib/public-http.server';
import { lookupBooking } from '~/lib/booking-lookup.server';
import { getConfiguredSlug } from '~/lib/site-config.server';

export const dynamic = 'force-dynamic';

const MAX_NAME_CHARS = 80;

type ErrorBody = {
  error: { code: string; message: string; retryable: boolean };
};

function errorJson(
  code: string,
  message: string,
  status: number,
  retryable = false
): Response {
  const body: ErrorBody = { error: { code, message, retryable } };
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Recover a booking the visitor can no longer manage.
 *
 * The browser sends only `{ nombre, apellido, telefono }`. This route owns the
 * shop slug through `getConfiguredSlug()`, so the browser can never choose
 * which shop is searched, and it forwards the Edge body and status unchanged.
 * A 404 arrives as a typed `PublicApiError` from the server client, not as a
 * thrown network error, so the client's error map gets a stable code to match.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorJson('INVALID_INPUT', 'Invalid input', 400);
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return errorJson('INVALID_INPUT', 'Invalid input', 400);
  }

  const input = body as Record<string, unknown>;
  const nombre = asText(input.nombre);
  const apellido = asText(input.apellido);
  const telefono = asText(input.telefono);

  if (
    nombre.length < 2 ||
    nombre.length > MAX_NAME_CHARS ||
    apellido.length < 2 ||
    apellido.length > MAX_NAME_CHARS ||
    telefono === ''
  ) {
    return errorJson('INVALID_INPUT', 'Invalid input', 400);
  }

  try {
    const result = await lookupBooking({
      slug: getConfiguredSlug(),
      nombre,
      apellido,
      telefono,
    });
    // The Edge's only success status is 200, so forwarding the body here is
    // equivalent to forwarding its status.
    return Response.json(result, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof PublicApiError) {
      const status =
        error.code === 'PUBLIC_RESOURCE_NOT_FOUND'
          ? 404
          : error.code === 'INVALID_INPUT'
            ? 400
            : 500;
      return errorJson(
        status === 500 ? 'INTERNAL_ERROR' : error.code,
        status === 500 ? 'Internal error' : error.message,
        status,
        error.retryable
      );
    }
    return errorJson('INTERNAL_ERROR', 'Internal error', 500, true);
  }
}
