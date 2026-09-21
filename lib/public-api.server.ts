import type { Catalog, Context, PublicError } from '~/types/public';

/**
 * Server-only client for the public discovery reads.
 *
 * Every read traverses the Edge Function/RPC boundary. Credentials come from
 * the server environment (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) and must never
 * be exposed through `NEXT_PUBLIC_*` or the client bundle.
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
const DEFAULT_TIMEOUT_MS = 5000;
const REVALIDATE_SECONDS = 60;

type FetchInit = RequestInit & { next?: { revalidate?: number } };
type FetchLike = (input: string, init?: FetchInit) => Promise<Response>;

export type PublicApiClientOptions = {
  baseUrl?: string;
  anonKey?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
};

function readEnv(name: 'SUPABASE_URL' | 'SUPABASE_ANON_KEY'): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateSlug(slug: string): void {
  if (!SLUG_RE.test(slug)) {
    throw new PublicApiError('INVALID_INPUT', 'Invalid slug');
  }
}

function parseContext(body: unknown): Context {
  if (
    !isRecord(body) ||
    !isRecord(body.barberia) ||
    typeof body.barberia.name !== 'string' ||
    !Array.isArray(body.barbers)
  ) {
    throw new PublicApiError('INVALID_RESPONSE', 'Malformed public context response');
  }
  for (const barber of body.barbers) {
    if (!isRecord(barber) || typeof barber.name !== 'string') {
      throw new PublicApiError('INVALID_RESPONSE', 'Malformed public context response');
    }
  }
  return body as unknown as Context;
}

function parseCatalog(body: unknown): Catalog {
  if (!isRecord(body) || !Array.isArray(body.services)) {
    throw new PublicApiError('INVALID_RESPONSE', 'Malformed public catalog response');
  }
  for (const service of body.services) {
    if (
      !isRecord(service) ||
      typeof service.name !== 'string' ||
      typeof service.durationMinutes !== 'number' ||
      typeof service.price !== 'number'
    ) {
      throw new PublicApiError('INVALID_RESPONSE', 'Malformed public catalog response');
    }
  }
  return body as unknown as Catalog;
}

function toPublicApiError(error: unknown): PublicApiError {
  if (error instanceof PublicApiError) return error;
  if (error instanceof Error && error.name === 'TimeoutError') {
    return new PublicApiError('TIMEOUT', 'Public read timed out', true);
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return new PublicApiError('TIMEOUT', 'Public read timed out', true);
  }
  return new PublicApiError('NETWORK_ERROR', 'Public read failed', true);
}

export function createPublicApiClient(options: PublicApiClientOptions = {}) {
  const baseUrl = (options.baseUrl ?? readEnv('SUPABASE_URL') ?? '').replace(/\/$/, '');
  const anonKey = options.anonKey ?? readEnv('SUPABASE_ANON_KEY');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl: FetchLike = options.fetchImpl ?? fetch;

  if (!baseUrl) {
    throw new PublicApiError('CONFIGURATION_ERROR', 'SUPABASE_URL is not configured.');
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (anonKey) headers.Authorization = `Bearer ${anonKey}`;

  async function fetchJson<T>(
    slug: string,
    fn: 'public-context' | 'public-catalog',
    parse: (body: unknown) => T
  ): Promise<T> {
    validateSlug(slug);
    const url = `${baseUrl}/functions/v1/${fn}?slug=${encodeURIComponent(slug)}`;

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(timeoutMs),
        // The only cached read surface: approved public DTOs with a one-minute
        // staleness bound. Token/PII and availability reads remain uncached.
        next: { revalidate: REVALIDATE_SECONDS },
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

  return {
    context: (slug: string) => fetchJson(slug, 'public-context', parseContext),
    catalog: (slug: string) => fetchJson(slug, 'public-catalog', parseCatalog),
  };
}

export type PublicPageData = {
  context: Context;
  catalog: Catalog;
};

/**
 * Load both public reads with all-settled semantics.
 *
 * Any non-404 failure wins so a dead backend can never render as "barbershop
 * not found"; only `PUBLIC_RESOURCE_NOT_FOUND` is surfaced as a not-found.
 */
export async function loadPublicPageData(
  slug: string,
  client: ReturnType<typeof createPublicApiClient> = createPublicApiClient()
): Promise<PublicPageData> {
  const [contextResult, catalogResult] = await Promise.allSettled([
    client.context(slug),
    client.catalog(slug),
  ]);

  const rejections = [contextResult, catalogResult].filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected'
  );

  if (rejections.length > 0) {
    const failure = rejections.find(
      (result) =>
        !(result.reason instanceof PublicApiError) ||
        result.reason.code !== 'PUBLIC_RESOURCE_NOT_FOUND'
    );
    throw failure ? failure.reason : rejections[0].reason;
  }

  return {
    context: (contextResult as PromiseFulfilledResult<Context>).value,
    catalog: (catalogResult as PromiseFulfilledResult<Catalog>).value,
  };
}
