'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { normalizarCelularAR } from '~/lib/telefono';

/**
 * The public lookup entry point lives in the footer, so the module-level
 * endpoint is a same-origin Next route: the browser never learns the Supabase
 * URL or the shop slug, both of which stay server-side in the route.
 */
const LOOKUP_ENDPOINT = '/api/booking-lookup';

/**
 * Customer-facing messages. Mirrors `BookingForm`'s map: the API's codes are a
 * stable contract but never shown to a customer, and the not-found copy is
 * deliberately generic so it cannot confirm whether a given person has a
 * booking. "Revisá los datos" is the input message; the not-found code covers
 * both "no such shop" and "no matching booking" by contract.
 */
const MESSAGE_BY_CODE: Record<string, string> = {
  INVALID_INPUT: 'Revisá los datos: hay algo que no está bien.',
  PUBLIC_RESOURCE_NOT_FOUND:
    'No encontramos ningún turno con esos datos. Revisalos y probá de nuevo.',
  METHOD_NOT_ALLOWED: 'Algo salió mal. Recargá la página.',
  INTERNAL_ERROR: 'No pudimos buscar tu turno. Probá de nuevo en un momento.',
  NETWORK: 'No pudimos conectarnos. Revisá la conexión y probá de nuevo.',
};

const PHONE_MESSAGE = 'Revisá el teléfono: ingresalo con código de área, sin el 0 y sin el 15.';

/**
 * Footer entry point that recovers a booking the visitor can no longer manage.
 *
 * The modal is a hand-rolled overlay rather than a `<dialog>` because jsdom does
 * not implement `showModal`, which would make this island untestable. The
 * overlay owns the interaction contract: Escape and a click on the backdrop
 * close it, the first field takes focus on open, and focus returns to the
 * trigger on close.
 */
export function ManageBookingLookup() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [nombre, setNombre] = useState('');
  const [apellido, setApellido] = useState('');
  const [telefono, setTelefono] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  const closeDialog = useCallback(() => {
    setOpen(false);
    // Restoring focus to the trigger keeps keyboard users where they were; the
    // node is always mounted, so this is safe even after the panel unmounts.
    triggerRef.current?.focus();
  }, []);

  function openDialog() {
    setError(null);
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    firstFieldRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDialog();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, closeDialog]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    setError(null);

    // The route forwards whatever it receives and the RPC owns the phone
    // format, so the browser sends the canonical `+549...` value — the same
    // rule `BookingForm` applies. A local invalid-phone message avoids a round
    // trip that would only come back as the generic INVALID_INPUT copy.
    const canonicalPhone = normalizarCelularAR(telefono);
    if (!canonicalPhone) {
      setError(PHONE_MESSAGE);
      return;
    }

    setSending(true);
    try {
      const response = await fetch(LOOKUP_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, apellido, telefono: canonicalPhone }),
      });

      const payload: unknown = await response.json().catch(() => null);
      const management = (payload as { management?: { token?: unknown } } | null)?.management;
      const token = management?.token;

      if (response.ok && typeof token === 'string' && token.length > 0) {
        router.push('/reserva/gestionar?token=' + encodeURIComponent(token));
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

  return (
    <>
      <button ref={triggerRef} type="button" className="footer-link" onClick={openDialog}>
        Cancelar turno
      </button>

      {open ? (
        // The backdrop closes on a click that lands on it; clicks inside the
        // panel target a descendant, so they never match `currentTarget`.
        <div
          className="modal-overlay"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeDialog();
          }}
        >
          <div
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="booking-lookup-title"
          >
            <div className="modal-panel-head">
              <h2 id="booking-lookup-title" className="modal-title">
                Cancelar turno
              </h2>
              <button type="button" className="icon-btn" aria-label="Cerrar" onClick={closeDialog}>
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
              </button>
            </div>
            <p className="modal-subtitle">
              Ingresá los datos con los que reservaste y te llevamos a tu turno.
            </p>

            {/*
             * The modal reuses the `.booking-form` class so its fields inherit the
             * booking form's input, label and error styles instead of a second,
             * drifting copy of those rules. `noValidate` leaves every visible
             * message to the map above.
             */}
            <form className="booking-form" onSubmit={submit} noValidate>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="lookup-nombre">
                    Nombre <span className="req">*</span>
                  </label>
                  <input
                    id="lookup-nombre"
                    ref={firstFieldRef}
                    type="text"
                    value={nombre}
                    onChange={(event) => setNombre(event.target.value)}
                    autoComplete="given-name"
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="lookup-apellido">
                    Apellido <span className="req">*</span>
                  </label>
                  <input
                    id="lookup-apellido"
                    type="text"
                    value={apellido}
                    onChange={(event) => setApellido(event.target.value)}
                    autoComplete="family-name"
                    required
                  />
                </div>
              </div>

              <div className="field">
                <label htmlFor="lookup-telefono">
                  Teléfono <span className="req">*</span>
                </label>
                {/*
                 * Same raw-text phone field as `BookingForm`: no mask, no
                 * formatting on change, `+54` shown as a standing prefix beside
                 * the field, and `autoComplete` deliberately absent so the
                 * browser never fills a different number than the booking's.
                 */}
                <div className="phone-field">
                  <span className="phone-prefix">🇦🇷 +54</span>
                  <input
                    id="lookup-telefono"
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
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={closeDialog}
                  disabled={sending}
                >
                  Volver
                </button>
                <button type="submit" className="ticket-cta" disabled={sending}>
                  {sending ? 'Buscando…' : 'Buscar turno'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
