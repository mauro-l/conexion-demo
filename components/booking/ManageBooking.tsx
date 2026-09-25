'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
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
  shopWhatsappUrl,
}: {
  booking: ManagedBooking;
  token: string;
  cancelEndpoint: string;
  shopWhatsappUrl: string | null;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <section className="confirm-card" aria-label="Resumen del turno">
      <div className="recap-row">
        <div>
          <span className="label">Servicio</span>
          <span className="value">{booking.serviceName}</span>
        </div>
      </div>
      <div className="recap-row">
        <div>
          <span className="label">Fecha y hora</span>
          <span className="value">{formatLocalDateTime(booking.start)}</span>
        </div>
      </div>
      <div className="recap-row">
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
        <div>
          <span className="label">Profesional</span>
          <span className="value">{booking.barberName}</span>
        </div>
      </div>
      <div className="recap-row">
        <div>
          <span className="label">Estado</span>
          <span className="value">{STATUS_LABEL[booking.status]}</span>
        </div>
      </div>

      {booking.status === 'cancelado' ? (
        <p className="confirm-note">Este turno ya está cancelado.</p>
      ) : booking.canCancel ? (
        <div className="form-actions">
          {confirming ? (
            <>
              <p className="confirm-note">¿Cancelar este turno?</p>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setConfirming(false)}
                disabled={sending}
              >
                No, volver
              </button>
              <button
                type="button"
                className="ticket-cta"
                onClick={cancelBooking}
                disabled={sending}
              >
                {sending ? 'Cancelando…' : 'Sí, cancelar turno'}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn-outline-wide"
              onClick={() => setConfirming(true)}
            >
              Cancelar turno
            </button>
          )}
        </div>
      ) : (
        <p className="confirm-note">
          Este turno ya no se puede cancelar porque está muy cerca del horario o ya empezó.
          {shopWhatsappUrl ? (
            <>
              {' '}
              <a href={shopWhatsappUrl}>Escribinos por WhatsApp.</a>
            </>
          ) : null}
        </p>
      )}

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
