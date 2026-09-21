import type { Catalog, Context } from '~/types/public';
import {
  DEFAULT_TIMEOUT_MS,
  PublicApiError,
  fetchPublicJson,
  isRecord,
  readEnv,
  validateSlug,
  type FetchLike,
} from '~/lib/public-http.server';

export { PublicApiError };

/**
 * Server-only client for the public discovery reads.
 *
 * Every read traverses the Edge Function/RPC boundary. Credentials come from
 * the server environment (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) and must never
 * be exposed through `NEXT_PUBLIC_*` or the client bundle.
 *
 * The shared error type, env reader, guards, slug validator, and request
 * pipeline live in `lib/public-http.server.ts`; this module keeps only the
 * cached context/catalog specifics. `PublicApiError` is re-exported so the
 * existing public import path stays stable.
 */

const REVALIDATE_SECONDS = 60;

export type PublicApiClientOptions = {
  baseUrl?: string;
  anonKey?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
};

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
      typeof service.publicServiceToken !== 'string' ||
      service.publicServiceToken.length === 0 ||
      typeof service.name !== 'string' ||
      typeof service.durationMinutes !== 'number' ||
      typeof service.price !== 'number'
    ) {
      throw new PublicApiError('INVALID_RESPONSE', 'Malformed public catalog response');
    }
  }
  return body as unknown as Catalog;
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

    return fetchPublicJson(
      {
        fetchImpl,
        url,
        headers,
        timeoutMs,
        // The only cached read surface: approved public DTOs with a one-minute
        // staleness bound. Token/PII and availability reads remain uncached.
        cache: { next: { revalidate: REVALIDATE_SECONDS } },
      },
      parse
    );
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
