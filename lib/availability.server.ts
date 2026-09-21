import type { Availability } from '~/types/booking';
import {
  DEFAULT_TIMEOUT_MS,
  PublicApiError,
  fetchPublicJson,
  isRecord,
  readEnv,
  validateSlug,
  type FetchLike,
} from '~/lib/public-http.server';

/**
 * Server-only client for the uncached public availability read.
 *
 * It follows the conventions of `lib/public-api.server.ts`: the same
 * `PublicApiError`, the same server env credentials (`SUPABASE_URL`,
 * `SUPABASE_ANON_KEY`), the same request timeout, and the same slug validation.
 * Those shared pieces live in `lib/public-http.server.ts`. The one deliberate
 * difference is caching: availability is database-authoritative and
 * time-sensitive, so this read opts out with `cache: 'no-store'` instead of the
 * catalog's 60-second revalidation.
 */

export type AvailabilityClientOptions = {
  baseUrl?: string;
  anonKey?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
};

function parseAvailability(body: unknown): Availability {
  if (!isRecord(body) || !isRecord(body.service) || !Array.isArray(body.days)) {
    throw new PublicApiError('INVALID_RESPONSE', 'Malformed public availability response');
  }

  const service = body.service;
  if (
    typeof service.publicServiceToken !== 'string' ||
    typeof service.name !== 'string' ||
    typeof service.durationMinutes !== 'number' ||
    typeof service.price !== 'number' ||
    !(service.description === null || typeof service.description === 'string')
  ) {
    throw new PublicApiError('INVALID_RESPONSE', 'Malformed public availability response');
  }

  for (const day of body.days) {
    if (
      !isRecord(day) ||
      typeof day.date !== 'string' ||
      typeof day.day !== 'number' ||
      !Array.isArray(day.slots)
    ) {
      throw new PublicApiError('INVALID_RESPONSE', 'Malformed public availability response');
    }
    for (const slot of day.slots) {
      if (
        !isRecord(slot) ||
        typeof slot.start !== 'string' ||
        typeof slot.end !== 'string' ||
        typeof slot.availabilityToken !== 'string'
      ) {
        throw new PublicApiError('INVALID_RESPONSE', 'Malformed public availability response');
      }
    }
  }

  return body as unknown as Availability;
}

export function createAvailabilityClient(options: AvailabilityClientOptions = {}) {
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

  return {
    async availability(slug: string, service: string): Promise<Availability> {
      validateSlug(slug);
      const url = `${baseUrl}/functions/v1/public-availability?slug=${encodeURIComponent(
        slug
      )}&service=${encodeURIComponent(service)}`;

      return fetchPublicJson(
        {
          fetchImpl,
          url,
          headers,
          timeoutMs,
          // Deliberately uncached: no `next: { revalidate }`. Stale availability
          // would let a visitor pick a slot that is already gone.
          cache: { cache: 'no-store' },
        },
        parseAvailability
      );
    },
  };
}

/**
 * Load one service's availability through the uncached read.
 *
 * The Edge Function's stable codes are surfaced unchanged, so callers can map
 * `PUBLIC_RESOURCE_NOT_FOUND` (unknown/unpublished slug or service) and
 * `INVALID_INPUT` (malformed token) to the public not-found experience instead
 * of a 500.
 */
export async function loadAvailability(
  slug: string,
  service: string,
  client: ReturnType<typeof createAvailabilityClient> = createAvailabilityClient()
): Promise<Availability> {
  return client.availability(slug, service);
}
