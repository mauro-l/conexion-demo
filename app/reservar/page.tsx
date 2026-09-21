import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PublicHeader } from '~/components/public/PublicHeader';
import { AvailabilityCalendar } from '~/components/booking/AvailabilityCalendar';
import { loadAvailability } from '~/lib/availability.server';
import { PublicApiError } from '~/lib/public-api.server';
import { getConfiguredSlug } from '~/lib/site-config.server';

/**
 * The public slug is server-only configuration, so this route is resolved per
 * request rather than pre-rendered. Availability is read through the uncached
 * server client; the browser never talks to the Edge Function directly.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Reservá tu turno | Conexión Barbería',
};

type SearchParams = Record<string, string | string[] | undefined>;

export default async function ReservarPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const resolved = await searchParams;
  const rawService = resolved.service;
  const service = Array.isArray(rawService) ? rawService[0] : rawService;

  if (!service) {
    // A missing token is a broken link, not a server error.
    notFound();
  }

  const availability = await loadAvailability(getConfiguredSlug(), service).catch(
    (error: unknown) => {
      // A malformed token or an unknown/unpublished service is a not-found for
      // the visitor; only real backend failures reach the 500 boundary.
      if (
        error instanceof PublicApiError &&
        (error.code === 'PUBLIC_RESOURCE_NOT_FOUND' || error.code === 'INVALID_INPUT')
      ) {
        notFound();
      }
      throw error;
    }
  );

  return (
    <>
      <PublicHeader />
      <main className="page-main">
        <p className="eyebrow">Reservar</p>
        <h1 className="hero-title">{availability.service.name}</h1>
        <p className="tagline">
          Elegí un horario disponible. La reserva se completa en una próxima etapa.
        </p>

        {/*
         * Exactly one professional affordance, always "Cualquier profesional".
         * Per-barber selection is out of scope and no internal id is rendered.
         */}
        <section className="prof-select" aria-label="Profesional">
          <span className="prof-select-label">Profesional</span>
          <span className="prof-select-value">Cualquier profesional</span>
        </section>

        <AvailabilityCalendar days={availability.days} />
      </main>
    </>
  );
}
