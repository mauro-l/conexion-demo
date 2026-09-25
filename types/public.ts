/**
 * Public DTO contracts for the barbershop landing.
 *
 * These mirror the payloads returned by the `public-context` and
 * `public-catalog` Edge Functions (see phase10_public_landing_details.sql).
 * They are the only shape the landing may render; no internal identifiers and
 * no storage-shape leakage. The catalog's `publicServiceToken` is an opaque,
 * non-internal handle used only to address the public availability read.
 */

/** A barbershop's public landing details. */
export type Barberia = {
  name: string;
  description: string;
  address: string | null;
  hours: string | null;
  whatsappUrl: string | null;
  instagramHandle: string | null;
  instagramUrl: string | null;
};

/**
 * A barber entry. Retained in the context DTO for Fase 2, but the Fase 1
 * landing does not render a selector or a barber list.
 */
export type Barber = {
  name: string;
  alias: string | null;
  description: string | null;
  photoUrl: string | null;
};

export type Context = {
  barberia: Barberia;
  barbers: Barber[];
};

export type Service = {
  publicServiceToken: string;
  name: string;
  durationMinutes: number;
  price: number;
  description: string | null;
};

export type Catalog = {
  services: Service[];
};

export type PublicError = {
  error: {
    code: string;
    message: string;
    retryable: boolean;
  };
};
