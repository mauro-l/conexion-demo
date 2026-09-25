import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BookingForm, type Booking } from '~/components/booking/BookingForm';

const endpoint = 'https://example.supabase.co/functions/v1/public-booking';
const booking: Booking = {
  start: '2026-10-21T09:00',
  end: '2026-10-21T09:40',
  durationMinutes: 40,
  price: 8000,
  status: 'confirmado',
  origin: 'web',
  serviceName: 'Corte clásico',
  barberName: 'Tero Jr',
  shopName: 'Conexión Barbería',
  customer: { name: 'Mauro Cliente', phone: '+5491123456789', email: 'customer@example.com' },
};

function renderForm() {
  return render(
    <BookingForm
      endpoint={endpoint}
      token="availability-token"
      shopAddress={null}
      recap={<p>Booking recap</p>}
      onBack={vi.fn()}
      onRestart={vi.fn()}
    />
  );
}

async function submitValidForm() {
  fireEvent.change(screen.getByLabelText(/Nombre/), { target: { value: 'Mauro' } });
  fireEvent.change(screen.getByLabelText(/Apellido/), { target: { value: 'Cliente' } });
  fireEvent.change(screen.getByLabelText(/Email/), { target: { value: 'customer@example.com' } });
  fireEvent.change(screen.getByLabelText(/Teléfono/), { target: { value: '1123456789' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar turno' }));
  await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
}

beforeEach(() => {
  vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'booking-idempotency-key') });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('BookingForm management confirmation link', () => {
  it('links to booking management when the successful response grants a token', async () => {
    const token = 'management /token?value';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        booking,
        management: { token, expiresAt: booking.start },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderForm();

    await submitValidForm();

    expect(screen.getByRole('link', { name: 'gestionar tu turno' })).toHaveAttribute(
      'href',
      `/reserva/gestionar?token=${encodeURIComponent(token)}`
    );
    expect(fetchMock).toHaveBeenCalledWith(
      endpoint,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Idempotency-Key': 'booking-idempotency-key' }),
      })
    );
  });

  it('does not render a management link when the successful response has no grant', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ booking }) }));
    renderForm();

    await submitValidForm();

    expect(screen.queryByRole('link', { name: 'gestionar tu turno' })).toBeNull();
  });
});
