import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AvailabilityCalendar } from '~/components/booking/AvailabilityCalendar';
import { loadAvailability } from '~/lib/availability.server';
import { loadPublicPageData, PublicApiError } from '~/lib/public-api.server';
import { formatDuration, formatPrice } from '~/lib/public-format';
import { getBookingEndpoint, getConfiguredSlug } from '~/lib/site-config.server';

/**
 * The public slug is server-only configuration, so this route is resolved per
 * request rather than pre-rendered. Availability is read through the uncached
 * server client; the one browser-to-Edge call in this app is the booking POST,
 * which the island makes with the signed slot token. The shop name for the modal
 * crumb comes from the cached public context read.
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

  const slug = getConfiguredSlug();

  // A malformed token or an unknown/unpublished service is a not-found for the
  // visitor; only real backend failures reach the 500 boundary. The same public
  // not-found boundary applies to the context read that supplies the crumb.
  const resolvePublicFailure = (error: unknown): never => {
    if (
      error instanceof PublicApiError &&
      (error.code === 'PUBLIC_RESOURCE_NOT_FOUND' || error.code === 'INVALID_INPUT')
    ) {
      notFound();
    }
    throw error;
  };

  const [availability, pageData] = await Promise.all([
    loadAvailability(slug, service).catch(resolvePublicFailure),
    loadPublicPageData(slug).catch(resolvePublicFailure),
  ]);

  const shopName = pageData.context.barberia.name;

  return (
    <>
      {/*
       * Modal chrome, not the home topbar: deterministic links to `/` for both
       * back and close. The home header must not render on this route.
       */}
      <header className="modal-topbar">
        <Link href="/" className="icon-btn" aria-label="Volver">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </Link>
        <span className="topbar-crumb">{shopName}</span>
        <Link href="/" className="icon-btn" aria-label="Cerrar">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </Link>
      </header>
      <main className="page-main">
        <p className="eyebrow">Reservar</p>
        <h1 className="hero-title">{availability.service.name}</h1>
        <p className="tagline">Elegí un horario disponible y confirmá tus datos.</p>

        <div className="service-chip">
          <span className="name">{availability.service.name}</span>
          <span className="meta">
            {formatDuration(availability.service.durationMinutes)}
            <span className="dot">·</span>
            {formatPrice(availability.service.price)}
          </span>
        </div>

        <AvailabilityCalendar
          days={availability.days}
          barbers={pageData.context.barbers}
          bookingEndpoint={getBookingEndpoint()}
          shopAddress={pageData.context.barberia.address ?? null}
        />
      </main>
    </>
  );
}
