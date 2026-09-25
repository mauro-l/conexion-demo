import type { ManagedBooking } from '~/types/booking';
import {
  DEFAULT_TIMEOUT_MS,
  PublicApiError,
  fetchPublicJson,
  isRecord,
  readEnv,
  type FetchLike,
} from '~/lib/public-http.server';

/** Server-only client for the uncached public booking management read. */
export type BookingManageClientOptions = {
  baseUrl?: string;
  anonKey?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
};

const BOOKING_STATUSES = ['pendiente', 'confirmado', 'completado', 'cancelado', 'ausente'] as const;

function parseManagedBooking(body: unknown): { booking: ManagedBooking } {
  if (!isRecord(body) || !isRecord(body.booking)) {
    throw new PublicApiError('INVALID_RESPONSE', 'Malformed public booking management response');
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
    throw new PublicApiError('INVALID_RESPONSE', 'Malformed public booking management response');
  }

  return { booking: booking as unknown as ManagedBooking };
}

export function createBookingManageClient(options: BookingManageClientOptions = {}) {
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
    async manage(token: string): Promise<{ booking: ManagedBooking }> {
      const url = `${baseUrl}/functions/v1/public-booking-manage?token=${encodeURIComponent(token)}`;

      return fetchPublicJson(
        {
          fetchImpl,
          url,
          headers,
          timeoutMs,
          cache: { cache: 'no-store' },
        },
        parseManagedBooking
      );
    },
  };
}

/** Load the public summary for a management token. */
export async function loadBookingSummary(
  token: string,
  client: ReturnType<typeof createBookingManageClient> = createBookingManageClient()
): Promise<{ booking: ManagedBooking }> {
  return client.manage(token);
}
