import type { PublicError } from '~/types/public';

/**
 * Shared server-side HTTP primitives for the public reads.
 *
 * `public-api.server.ts` (cached context/catalog) and
 * `availability.server.ts` (uncached availability) traverse the same Edge
 * Function boundary from the server, so they share the error type, the
 * credential env reader, the response guards, the slug validator, and the JSON
 * request pipeline. The one deliberate difference between the two reads is
 * caching, which each caller passes explicitly through `cache`.
 */

export class PublicApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = 'PublicApiError';
  }
}

const SLUG_RE = /^[a-z0-9-]{1,63}$/;
export const DEFAULT_TIMEOUT_MS = 5000;

export type FetchInit = RequestInit & { next?: { revalidate?: number } };
export type FetchLike = (input: string, init?: FetchInit) => Promise<Response>;

export function readEnv(name: 'SUPABASE_URL' | 'SUPABASE_ANON_KEY'): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateSlug(slug: string): void {
  if (!SLUG_RE.test(slug)) {
    throw new PublicApiError('INVALID_INPUT', 'Invalid slug');
  }
}

export function toPublicApiError(error: unknown): PublicApiError {
  if (error instanceof PublicApiError) return error;
  if (error instanceof Error && error.name === 'TimeoutError') {
    return new PublicApiError('TIMEOUT', 'Public read timed out', true);
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return new PublicApiError('TIMEOUT', 'Public read timed out', true);
  }
  return new PublicApiError('NETWORK_ERROR', 'Public read failed', true);
}

export type PublicJsonRequest = {
  fetchImpl: FetchLike;
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
  /**
   * Transport cache directive. The catalog read passes
   * `{ next: { revalidate: 60 } }`; the availability read passes
   * `{ cache: 'no-store' }`. This is the only place the two reads differ.
   */
  cache: FetchInit;
  /**
   * Read-only callers leave this unset and get `GET`. The booking lookup is a
   * POST because it carries the visitor's identity in the body, never in a URL
   * — names and phones must not land in access logs or browser history.
   */
  method?: 'GET' | 'POST';
  body?: string;
};

/**
 * Fetch one public Edge Function endpoint as JSON and hand the body to `parse`.
 *
 * `validateSlug` runs in the caller before the URL is built, so an invalid
 * slug is rejected before any network call. Transport failures and HTTP errors
 * map to the same `PublicApiError` codes for every public read.
 */
export async function fetchPublicJson<T>(
  request: PublicJsonRequest,
  parse: (body: unknown) => T
): Promise<T> {
  const { fetchImpl, url, headers, timeoutMs, cache, method = 'GET', body: requestBody } = request;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      ...cache,
      method,
      headers,
      body: requestBody,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw toPublicApiError(error);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new PublicApiError('INVALID_RESPONSE', 'Public read returned invalid JSON.');
  }

  if (!response.ok) {
    const err = body as PublicError | undefined;
    throw new PublicApiError(
      err?.error?.code ?? 'INTERNAL_ERROR',
      err?.error?.message ?? 'Request failed',
      err?.error?.retryable ?? false
    );
  }

  return parse(body);
}
