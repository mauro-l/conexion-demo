import type { BookingLookupResult } from '~/types/booking';
import {
  DEFAULT_TIMEOUT_MS,
  PublicApiError,
  fetchPublicJson,
  isRecord,
  readEnv,
  type FetchLike,
} from '~/lib/public-http.server';

/**
 * Server-only client for the uncached public booking lookup.
 *
 * The browser sends only the visitor's identity; this client adds nothing to
 * that. The shop slug is resolved by the route (`getConfiguredSlug`) and passed
 * in, so the browser never chooses the shop.
 */
export type BookingLookupClientOptions = {
  baseUrl?: string;
  anonKey?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
};

export type BookingLookupInput = {
  slug: string;
  nombre: string;
  apellido: string;
  telefono: string;
};

const BOOKING_STATUSES = ['pendiente', 'confirmado', 'completado', 'cancelado', 'ausente'] as const;

function parseBookingLookup(body: unknown): BookingLookupResult {
  if (!isRecord(body) || !isRecord(body.booking) || !isRecord(body.management)) {
    throw new PublicApiError('INVALID_RESPONSE', 'Malformed public booking lookup response');
  }

  const management = body.management;
  if (typeof management.token !== 'string' || management.token.length === 0) {
    throw new PublicApiError('INVALID_RESPONSE', 'Malformed public booking lookup response');
  }
  if (typeof management.expiresAt !== 'string') {
    throw new PublicApiError('INVALID_RESPONSE', 'Malformed public booking lookup response');
  }

  const booking = body.booking;
  if (
    typeof booking.start !== 'string' ||
    typeof booking.end !== 'string' ||
    typeof booking.durationMinutes !== 'number' ||
    typeof booking.price !== 'number' ||
    typeof booking.status !== 'string' ||
    !BOOKING_STATUSES.includes(booking.status as (typeof BOOKING_STATUSES)[number]) ||
    typeof booking.origin !== 'string' ||
    typeof booking.serviceName !== 'string' ||
    typeof booking.barberName !== 'string' ||
    typeof booking.shopName !== 'string' ||
    typeof booking.canCancel !== 'boolean'
  ) {
    throw new PublicApiError('INVALID_RESPONSE', 'Malformed public booking lookup response');
  }

  return body as unknown as BookingLookupResult;
}

export function createBookingLookupClient(options: BookingLookupClientOptions = {}) {
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
    async lookup(input: BookingLookupInput): Promise<BookingLookupResult> {
      const url = `${baseUrl}/functions/v1/public-booking-lookup`;

      return fetchPublicJson(
        {
          fetchImpl,
          url,
          headers,
          timeoutMs,
          cache: { cache: 'no-store' },
          method: 'POST',
          body: JSON.stringify({
            slug: input.slug,
            nombre: input.nombre,
            apellido: input.apellido,
            telefono: input.telefono,
          }),
        },
        parseBookingLookup
      );
    },
  };
}

/** Recover the nearest upcoming booking from the visitor's identity. */
export async function lookupBooking(
  input: BookingLookupInput,
  client: ReturnType<typeof createBookingLookupClient> = createBookingLookupClient()
): Promise<BookingLookupResult> {
  return client.lookup(input);
}
