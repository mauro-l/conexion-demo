'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { formatDuration, formatLocalDateTime, formatPrice } from '~/lib/public-format';
import type { ManagedBooking } from '~/types/booking';

const MESSAGE_BY_CODE: Record<string, string> = {
  CANCEL_TOO_LATE: 'Ya no se puede cancelar este turno porque está muy cerca del horario.',
  NOT_CANCELLABLE: 'Este turno ya no se puede cancelar.',
  TOKEN_REVOKED: 'Este enlace ya no es válido.',
  TOKEN_EXPIRED: 'Este enlace venció porque el turno ya empezó.',
  PUBLIC_RESOURCE_NOT_FOUND: 'No encontramos ningún turno para este enlace.',
  INVALID_INPUT: 'El enlace no es válido. Revisá que esté completo.',
  METHOD_NOT_ALLOWED: 'No pudimos cancelar el turno. Probá de nuevo.',
  INTERNAL_ERROR: 'No pudimos cancelar el turno. Probá de nuevo en un momento.',
  NETWORK: 'No pudimos conectarnos. Revisá la conexión y probá de nuevo.',
};

const STATUS_LABEL: Record<ManagedBooking['status'], string> = {
  pendiente: 'Pendiente',
  confirmado: 'Confirmado',
  completado: 'Completado',
  cancelado: 'Cancelado',
  ausente: 'Ausente',
};

export function ManageBooking({
  booking,
  token,
  cancelEndpoint,
}: {
  booking: ManagedBooking;
  token: string;
  cancelEndpoint: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const statusVariant =
    booking.status === 'confirmado'
      ? 'confirmed'
      : booking.status === 'cancelado'
        ? 'cancelled'
        : 'neutral';

  async function cancelBooking() {
    if (sending) return;
    setSending(true);
    setError(null);

    try {
      const response = await fetch(cancelEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const payload: unknown = await response.json().catch(() => null);
      const result = payload as { error?: { code?: string }; booking?: unknown } | null;

      if (response.ok && result?.booking) {
        router.refresh();
        return;
      }

      const code = result?.error?.code ?? 'INTERNAL_ERROR';
      setError(MESSAGE_BY_CODE[code] ?? MESSAGE_BY_CODE.INTERNAL_ERROR);
    } catch {
      setError(MESSAGE_BY_CODE.NETWORK);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="manage-booking">
      <section className="recap" aria-label="Resumen del turno">
        <div className="recap-row">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <rect x="3" y="4" width="18" height="4" rx="1" />
            <path d="M4 8v11a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V8" />
          </svg>
          <div>
            <span className="label">Servicio</span>
            <span className="value">{booking.serviceName}</span>
          </div>
        </div>
        <div className="recap-row">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M3 10h18M8 3v4M16 3v4" />
          </svg>
          <div>
            <span className="label">Fecha y hora</span>
            <span className="value">{formatLocalDateTime(booking.start)}</span>
          </div>
        </div>
        <div className="recap-row">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
          </svg>
          <div>
            <span className="label">Duración · precio</span>
            <span className="value">
              {formatDuration(booking.durationMinutes)}
              <span className="dot"> · </span>
              {formatPrice(booking.price)}
            </span>
          </div>
        </div>
        <div className="recap-row">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path d="M20 21a8 8 0 1 0-16 0" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          <div>
            <span className="label">Profesional</span>
            <span className="value">{booking.barberName}</span>
          </div>
        </div>
        <div className="recap-row">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M9 12l2 2 4-4" />
          </svg>
          <div>
            <span className="label">Estado</span>
            <span className={`status-badge ${statusVariant}`}>
              <span className="dot" aria-hidden="true" />
              <span>{STATUS_LABEL[booking.status]}</span>
            </span>
          </div>
        </div>
      </section>

      {booking.status === 'cancelado' ? (
        <>
          <div className="note-box">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v5M12 16h.01" />
            </svg>
            <span>Este turno fue cancelado. Podés reservar uno nuevo cuando quieras.</span>
          </div>
          <Link className="btn-primary" href="/">
            Reservar otro turno
          </Link>
        </>
      ) : booking.canCancel ? (
        confirming ? (
          <div className="confirm-panel">
            <p>¿Seguro que querés cancelar este turno? Esta acción no se puede deshacer.</p>
            <div className="row">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setConfirming(false)}
                disabled={sending}
              >
                No, mantener
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={cancelBooking}
                disabled={sending}
              >
                Sí, cancelar
              </button>
            </div>
          </div>
        ) : (
          <div className="actions">
            <button
              type="button"
              className="btn-danger-outline"
              onClick={() => setConfirming(true)}
            >
              Cancelar turno
            </button>
          </div>
        )
      ) : (
        <div className="note-box">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v5M12 16h.01" />
          </svg>
          <span>Este turno ya no se puede cancelar porque está muy cerca del horario o ya empezó.</span>
        </div>
      )}

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      {/*
       * A page reached from a link (an email, the confirmation) has no history
       * to return to, so it needs its own way out. The cancelled state already
       * carries the rebook call to action, which is the same destination.
       */}
      {booking.status === 'cancelado' ? null : (
        <Link className="manage-exit" href="/">
          Volver al inicio
        </Link>
      )}
    </div>
  );
}
