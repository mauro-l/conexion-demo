/**
 * Public booking-flow DTO contracts for the read-only availability surface.
 *
 * These mirror the payload returned by the `public-availability` Edge Function
 * (see phase12_public_availability.sql). The shape is ID-free by contract: the
 * only identifier that crosses the boundary is the opaque `publicServiceToken`,
 * and each slot carries a stateless, expiring `availabilityToken`.
 */

/** One bookable interval in Buenos Aires local time, with its signed token. */
export type AvailabilitySlot = {
  start: string;
  end: string;
  availabilityToken: string;
};

/** One local date in the window. `day` is `0=Sunday .. 6=Saturday`. */
export type AvailabilityDay = {
  date: string;
  day: number;
  slots: AvailabilitySlot[];
};

/** The dataset owner of the displayed availability, resolved server-side. */
export type AvailabilityService = {
  publicServiceToken: string;
  name: string;
  durationMinutes: number;
  price: number;
  description: string | null;
};

export type Availability = {
  service: AvailabilityService;
  days: AvailabilityDay[];
};

/** The ID-free booking summary returned by the public management endpoints. */
export type ManagedBooking = {
  start: string;
  end: string;
  durationMinutes: number;
  price: number;
  status: 'pendiente' | 'confirmado' | 'completado' | 'cancelado' | 'ausente';
  origin: string;
  serviceName: string;
  barberName: string;
  shopName: string;
  canCancel: boolean;
};

/** A one-time grant to manage a newly created booking. */
export type ManagementGrant = {
  token: string;
  expiresAt: string;
};
