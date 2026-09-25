import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useRouter } from 'next/navigation';
import { ManageBooking } from '~/components/booking/ManageBooking';
import type { ManagedBooking } from '~/types/booking';

vi.mock('next/navigation', () => ({ useRouter: vi.fn() }));

const refresh = vi.fn();
const cancelEndpoint = 'https://example.supabase.co/functions/v1/public-booking-cancel';
const booking: ManagedBooking = {
  start: '2026-09-21T09:30',
  end: '2026-09-21T11:00',
  durationMinutes: 90,
  price: 12500,
  status: 'confirmado',
  origin: 'web',
  serviceName: 'Corte clásico',
  barberName: 'Tero Jr',
  shopName: 'Conexión Barbería',
  canCancel: true,
};

function renderBooking(overrides: Partial<ManagedBooking> = {}) {
  return render(
    <ManageBooking
      booking={{ ...booking, ...overrides }}
      token="management-token"
      cancelEndpoint={cancelEndpoint}
    />
  );
}

beforeEach(() => {
  refresh.mockClear();
  vi.mocked(useRouter).mockReturnValue({ refresh } as unknown as ReturnType<typeof useRouter>);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ManageBooking', () => {
  it('renders the summary fields and Spanish status label', () => {
    renderBooking();

    expect(screen.getByText('Corte clásico')).toBeInTheDocument();
    expect(screen.getByText('21/9 a las 09:30')).toBeInTheDocument();
    expect(screen.getByText(/1 h 30 min/)).toHaveTextContent('$12.500');
    expect(screen.getByText('Tero Jr')).toBeInTheDocument();
    expect(screen.getByText('Confirmado')).toBeInTheDocument();
  });

  it('uses the two-step cancellation flow, posts the token, and refreshes on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ booking: { status: 'cancelado' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderBooking();

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar turno' }));
    expect(
      screen.getByText('¿Seguro que querés cancelar este turno? Esta acción no se puede deshacer.')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'No, mantener' }));
    expect(screen.getByRole('button', { name: 'Cancelar turno' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar turno' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sí, cancelar' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(cancelEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'management-token' }),
    });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it('shows the mapped too-late message without refreshing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ error: { code: 'CANCEL_TOO_LATE' } }),
      })
    );
    renderBooking();

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar turno' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sí, cancelar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ya no se puede cancelar este turno porque está muy cerca del horario.'
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it('shows the cancelled badge and note, a rebook link, and no cancel button', () => {
    renderBooking({ status: 'cancelado', canCancel: false });

    expect(screen.queryByRole('button', { name: 'Cancelar turno' })).toBeNull();
    expect(screen.getByText('Cancelado').closest('.status-badge')).toHaveClass(
      'status-badge',
      'cancelled'
    );
    expect(
      screen.getByText('Este turno fue cancelado. Podés reservar uno nuevo cuando quieras.')
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Reservar otro turno' })).toHaveAttribute('href', '/');
  });

  it('shows the too-close note without a cancel button when cancellation is unavailable', () => {
    renderBooking({ canCancel: false });

    expect(screen.queryByRole('button', { name: 'Cancelar turno' })).toBeNull();
    expect(
      screen.getByText(/Este turno ya no se puede cancelar porque está muy cerca del horario/)
    ).toBeInTheDocument();
  });

  it('maps a thrown fetch to the network message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    renderBooking();

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar turno' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sí, cancelar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No pudimos conectarnos. Revisá la conexión y probá de nuevo.'
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it('offers a text link back home unless the booking is cancelled', () => {
    const view = renderBooking();
    expect(screen.getByRole('link', { name: 'Volver al inicio' })).toHaveAttribute('href', '/');

    view.rerender(
      <ManageBooking
        booking={{ ...booking, status: 'cancelado', canCancel: false }}
        token="management-token"
        cancelEndpoint={cancelEndpoint}
      />
    );
    expect(screen.queryByRole('link', { name: 'Volver al inicio' })).toBeNull();
  });
});
