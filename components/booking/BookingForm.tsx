'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { formatDuration, formatPrice } from '~/lib/public-format';
import { normalizarCelularAR } from '~/lib/telefono';
import type { ManagementGrant } from '~/types/booking';

/** The public booking DTO the Edge returns. Deliberately free of internal ids. */
export type Booking = {
  start: string;
  end: string;
  durationMinutes: number;
  price: number;
  status: string;
  origin: string;
  serviceName: string;
  barberName: string;
  shopName: string;
  customer: { name: string; phone: string; email: string };
};

/**
 * Customer-facing messages. The API's codes are a stable contract but they are
 * not something to put in front of a customer, so every code that can reach the
 * browser is mapped here and anything unmapped falls back to the generic message
 * rather than leaking. The register matches the rest of the public copy.
 */
const MESSAGE_BY_CODE: Record<string, string> = {
  INVALID_INPUT: 'Revisá los datos: hay algo que no está bien.',
  AREA_NOT_ALLOWED: 'Por ahora no atendemos números de esa zona. Escribinos y lo vemos.',
  SLOT_UNAVAILABLE: 'Ese horario se acaba de ocupar. Elegí otro.',
  PAST_START: 'Ese horario ya pasó. Elegí otro.',
  OUTSIDE_WORKING_HOURS: 'Ese horario quedó fuera de la atención. Elegí otro.',
  BLOCKED_SLOT: 'Ese horario no está disponible. Elegí otro.',
  SERVICE_NOT_BOOKABLE: 'Ese servicio no se puede reservar por acá. Escribinos.',
  PUBLIC_RESOURCE_NOT_FOUND: 'No encontramos el servicio. Volvé a empezar.',
  IDEMPOTENCY_KEY_REUSED: 'Ya usamos estos datos. Recargá la página y probá de nuevo.',
  TOKEN_EXPIRED: 'La disponibilidad venció. Recargá la página para ver los horarios de nuevo.',
  TOKEN_INVALID_SIGNATURE: 'La disponibilidad no es válida. Recargá la página.',
  TOKEN_MALFORMED: 'La disponibilidad no es válida. Recargá la página.',
  TOKEN_UNSUPPORTED_ALGORITHM: 'La disponibilidad no es válida. Recargá la página.',
  TOKEN_NOT_YET_VALID: 'La disponibilidad no es válida. Recargá la página.',
  METHOD_NOT_ALLOWED: 'Algo salió mal. Recargá la página.',
  INTERNAL_ERROR: 'No pudimos confirmar el turno. Probá de nuevo en un momento.',
  NETWORK: 'No pudimos conectarnos. Revisá la conexión y probá de nuevo.',
};

const PHONE_MESSAGE = 'Revisá el teléfono: ingresalo con código de área, sin el 0 y sin el 15.';

/** `2026-09-25T09:00:00` -> `25/9 a las 09:00`, without constructing a `Date`. */
function formatStart(localDateTime: string): string {
  const [date, time = ''] = localDateTime.split('T');
  const [, month, day] = date.split('-');
  return `${Number(day)}/${Number(month)} a las ${time.slice(0, 5)}`;
}

/**
 * The customer step: name, surname, email and phone, then the inline result.
 *
 * `telefono` is normalized before it leaves the browser, because the server
 * stores the canonical `+549` value and rejects anything else — the form's copy
 * of the rule is a hint, never the authority, so the canonical value is what the
 * server gets.
 *
 * The idempotency key is generated once, lazily, and never re-rendered: it is
 * never part of the markup, so a client-only value cannot break hydration, and a
 * retry after a lost response reuses it so the server replays the original
 * booking instead of creating a second one or answering SLOT_UNAVAILABLE.
 */
export function BookingForm({
  endpoint,
  token,
  shopAddress,
  recap,
  onBack,
  onRestart,
}: {
  endpoint: string;
  token: string;
  shopAddress: string | null;
  recap: ReactNode;
  /** Backs out before booking: nothing changed, so nothing needs re-reading. */
  onBack: () => void;
  /**
   * Leaves a finished booking. Separate from `onBack` because this visitor's
   * booking just changed availability, so the slot list has to be re-read rather
   * than restored.
   */
  onRestart: () => void;
}) {
  const [nombre, setNombre] = useState('');
  const [apellido, setApellido] = useState('');
  const [email, setEmail] = useState('');
  const [telefono, setTelefono] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [management, setManagement] = useState<ManagementGrant | null>(null);

  const [idempotencyKey] = useState(() =>
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `bk-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    setError(null);

    const canonicalPhone = normalizarCelularAR(telefono);
    if (!canonicalPhone) {
      setError(PHONE_MESSAGE);
      return;
    }

    setSending(true);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          token,
          nombre,
          apellido,
          telefono: canonicalPhone,
          telefonoRaw: telefono,
          email,
        }),
      });

      const payload: unknown = await response.json().catch(() => null);
      const bookingPayload = (payload as { booking?: Booking } | null)?.booking;
      if (response.ok && bookingPayload) {
        const managementGrant = (payload as { management?: ManagementGrant } | null)?.management;
        setBooking(bookingPayload);
        setManagement(managementGrant ?? null);
        return;
      }

      const code =
        (payload as { error?: { code?: string } } | null)?.error?.code ?? 'INTERNAL_ERROR';
      setError(MESSAGE_BY_CODE[code] ?? MESSAGE_BY_CODE.INTERNAL_ERROR);
    } catch {
      setError(MESSAGE_BY_CODE.NETWORK);
    } finally {
      setSending(false);
    }
  }

  if (booking) {
    return (
      <div className="booking-confirm" role="status">
        <div className="check-circle" aria-hidden="true">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </div>
        <h2 className="confirm-title">¡Gracias por agendar en {booking.shopName}!</h2>
        <div className="confirm-card">
          <div className="recap-row">
            <div>
              <span className="label">Servicio</span>
              <span className="value">{booking.serviceName}</span>
            </div>
          </div>
          <div className="recap-row">
            <div>
              <span className="label">Fecha y hora</span>
              <span className="value">{formatStart(booking.start)}</span>
            </div>
          </div>
          {shopAddress ? (
            <div className="recap-row">
              <div>
                <span className="label">Ubicación</span>
                <span className="value">{shopAddress}</span>
              </div>
            </div>
          ) : null}
          <div className="recap-row">
            <div>
              <span className="label">Profesional</span>
              <span className="value">{booking.barberName}</span>
            </div>
          </div>
          <div className="recap-row">
            <div>
              <span className="label">Precio</span>
              <span className="value">
                {formatDuration(booking.durationMinutes)}
                <span className="dot"> · </span>
                {formatPrice(booking.price)}
              </span>
            </div>
          </div>
        </div>
        {/*
         * Deliberately factual. The prototype says a confirmation email was sent,
         * but nothing sends email in this stage, and the shop's channel is
         * WhatsApp — so the note states what is true instead of promising a
         * delivery that will not arrive.
         */}
        <p className="confirm-note">
          Tu turno quedó registrado a nombre de <strong>{booking.customer.name}</strong>.{' '}
          {management ? (
            <>
              Podés{' '}
              <Link href={`/reserva/gestionar?token=${encodeURIComponent(management.token)}`}>
                gestionar tu turno
              </Link>
              .{' '}
            </>
          ) : null}
          Si necesitás cambiarlo, escribinos por WhatsApp.
        </p>
        <button type="button" className="btn-outline-wide" onClick={onRestart}>
          Agendar otra cita
        </button>
      </div>
    );
  }

  return (
    <div className="booking-form">
      {recap}

      <h2 className="form-title">Tus datos</h2>
      {/*
       * The prototype's subtitle promises a confirmation code by email. That is
       * the verification step this stage deliberately leaves out, so the copy
       * cannot claim it.
       */}
      <p className="form-subtitle">Completá tus datos y confirmamos el turno.</p>

      <form onSubmit={submit} noValidate>
        <div className="field-row">
          <div className="field">
            <label htmlFor="booking-nombre">
              Nombre <span className="req">*</span>
            </label>
            <input
              id="booking-nombre"
              type="text"
              value={nombre}
              onChange={(event) => setNombre(event.target.value)}
              autoComplete="given-name"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="booking-apellido">
              Apellido <span className="req">*</span>
            </label>
            <input
              id="booking-apellido"
              type="text"
              value={apellido}
              onChange={(event) => setApellido(event.target.value)}
              autoComplete="family-name"
              required
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="booking-email">
            Email <span className="req">*</span>
          </label>
          <input
            id="booking-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="juan@mail.com"
            autoComplete="email"
            required
          />
        </div>

        <div className="field">
          <label htmlFor="booking-telefono">
            Teléfono <span className="req">*</span>
          </label>
          {/*
           * The input takes raw text on purpose: no mask, no maxLength, no
           * formatting on change. All three mangle a pasted `+54 9 221 681-9377`
           * before normalization can read it, and pasting from WhatsApp is the
           * normal way this number arrives. `inputMode="tel"` gives a keypad with
           * `+`; `autoComplete="tel"` is deliberately absent because the browser
           * would then fill in the visitor's own number.
           *
           * The country code is a standing prefix beside the input, the way the
           * prototype shows it, so the field itself holds only the digits. That is
           * also why nothing rewrites the value on blur: a `+54 9` rewrite would
           * now render twice, once in the prefix and once inside the field.
           */}
          <div className="phone-field">
            <span className="phone-prefix">🇦🇷 +54</span>
            <input
              id="booking-telefono"
              type="tel"
              inputMode="tel"
              value={telefono}
              onChange={(event) => setTelefono(event.target.value)}
              placeholder="1123456789"
              required
            />
          </div>
          <p className="hint">Con código de área, sin el 0 y sin el 15. Ej: 1123456789</p>
        </div>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="form-actions">
          <button type="button" className="btn-secondary" onClick={onBack} disabled={sending}>
            Elegir otro horario
          </button>
          <button type="submit" className="ticket-cta" disabled={sending}>
            {sending ? 'Confirmando…' : 'Confirmar turno'}
          </button>
        </div>
      </form>
    </div>
  );
}
