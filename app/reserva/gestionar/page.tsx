import type { Metadata } from 'next';
import Link from 'next/link';
import { ManageBooking } from '~/components/booking/ManageBooking';
import { loadBookingSummary } from '~/lib/booking-manage.server';
import { PublicApiError } from '~/lib/public-api.server';
import { getBookingCancelEndpoint } from '~/lib/site-config.server';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Gestionar turno | Conexión Barbería',
};

type SearchParams = Record<string, string | string[] | undefined>;

const MANAGEMENT_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

const ERROR_MESSAGE: Record<string, string> = {
  PUBLIC_RESOURCE_NOT_FOUND: 'No encontramos ningún turno para este enlace.',
  TOKEN_REVOKED: 'Este enlace ya no es válido.',
  TOKEN_EXPIRED: 'Este enlace venció porque el turno ya empezó.',
};

function InvalidLinkState({ message }: { message: string }) {
  return (
    <main className="page-main">
      <p className="eyebrow">Gestionar turno</p>
      <h1 className="hero-title">Enlace no válido</h1>
      <p className="tagline">{message}</p>
      <Link className="btn-outline-wide" href="/">
        Volver al inicio
      </Link>
    </main>
  );
}

export default async function ManageBookingPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const resolved = await searchParams;
  const rawToken = resolved.token;
  const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;

  if (!token || !MANAGEMENT_TOKEN_RE.test(token)) {
    return <InvalidLinkState message="Revisá que el enlace esté completo o pedí uno nuevo." />;
  }

  let booking;
  try {
    ({ booking } = await loadBookingSummary(token));
  } catch (error) {
    if (error instanceof PublicApiError) {
      if (error.code === 'INVALID_INPUT') {
        return <InvalidLinkState message="Revisá que el enlace esté completo o pedí uno nuevo." />;
      }
      const message = ERROR_MESSAGE[error.code];
      if (message) return <InvalidLinkState message={message} />;
    }
    throw error;
  }

  return (
    <>
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
        <span className="topbar-crumb">{booking.shopName}</span>
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
        <p className="eyebrow">Gestionar turno</p>
        <h1 className="hero-title">Tu turno en {booking.shopName}</h1>
        <p className="tagline">Consultá el resumen y el estado de tu turno.</p>

        <ManageBooking
          booking={booking}
          token={token}
          cancelEndpoint={getBookingCancelEndpoint()}
          shopWhatsappUrl={null}
        />
      </main>
    </>
  );
}
