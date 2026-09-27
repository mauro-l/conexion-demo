import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useRouter } from 'next/navigation';
import { ManageBookingLookup } from '~/components/booking/ManageBookingLookup';

vi.mock('next/navigation', () => ({ useRouter: vi.fn() }));

const push = vi.fn();

function renderLookup(props?: { shopWhatsappUrl?: string | null }) {
  return render(<ManageBookingLookup {...props} />);
}

function openDialog() {
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar turno' }));
}

function fillIdentity() {
  fireEvent.change(screen.getByLabelText(/Nombre/), { target: { value: 'Mauro' } });
  fireEvent.change(screen.getByLabelText(/Apellido/), { target: { value: 'Cliente' } });
  fireEvent.change(screen.getByLabelText(/Teléfono/), { target: { value: '1123456789' } });
}

beforeEach(() => {
  push.mockClear();
  vi.mocked(useRouter).mockReturnValue({ push } as unknown as ReturnType<typeof useRouter>);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ManageBookingLookup', () => {
  it('opens the dialog from the trigger and focuses the first field', () => {
    renderLookup();

    expect(screen.queryByRole('dialog')).toBeNull();
    openDialog();

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'booking-lookup-title');
    expect(screen.getByLabelText(/Nombre/)).toHaveFocus();
  });

  it('blocks the POST and shows the phone message for an invalid phone', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderLookup();
    openDialog();
    fillIdentity();
    fireEvent.change(screen.getByLabelText(/Teléfono/), { target: { value: '123' } });

    fireEvent.click(screen.getByRole('button', { name: 'Buscar turno' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Revisá el teléfono: ingresalo con código de área, sin el 0 y sin el 15.'
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('normalizes the phone, posts the identity, and navigates with the URI-encoded token', async () => {
    const token = 'management /token?value';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ management: { token, expiresAt: '2026-10-02T10:00' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderLookup();
    openDialog();
    fillIdentity();

    fireEvent.click(screen.getByRole('button', { name: 'Buscar turno' }));

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(`/reserva/gestionar?token=${encodeURIComponent(token)}`)
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/booking-lookup',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          nombre: 'Mauro',
          apellido: 'Cliente',
          telefono: '+5491123456789',
        }),
      })
    );
  });

  it('shows the generic not-found copy for a 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: { code: 'PUBLIC_RESOURCE_NOT_FOUND' } }),
      })
    );
    renderLookup();
    openDialog();
    fillIdentity();

    fireEvent.click(screen.getByRole('button', { name: 'Buscar turno' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No encontramos ningún turno con esos datos. Revisalos y probá de nuevo.'
    );
    expect(push).not.toHaveBeenCalled();
  });

  it('maps a thrown fetch to the network message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    renderLookup();
    openDialog();
    fillIdentity();

    fireEvent.click(screen.getByRole('button', { name: 'Buscar turno' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No pudimos conectarnos. Revisá la conexión y probá de nuevo.'
    );
  });

  /**
   * Booking-ux-fixes: only not-found/invalid-input answers count toward the
   * WhatsApp help. Each submit is awaited through the fetch call count so a
   * click never lands while `sending` is still true and gets swallowed.
   */
  async function failSearchMore(fetchMock: ReturnType<typeof vi.fn>, times: number) {
    const seen = fetchMock.mock.calls.length;
    for (let next = 1; next <= times; next++) {
      fireEvent.click(screen.getByRole('button', { name: 'Buscar turno' }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(seen + next));
      await screen.findByRole('alert');
    }
  }

  function notFoundFetch() {
    return vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: { code: 'PUBLIC_RESOURCE_NOT_FOUND' } }),
    });
  }

  it('shows plain-text help from the third not-found lookup when there is no WhatsApp URL', async () => {
    const fetchMock = notFoundFetch();
    vi.stubGlobal('fetch', fetchMock);
    renderLookup();
    openDialog();
    fillIdentity();

    await failSearchMore(fetchMock, 2);
    expect(screen.queryByText(/¿Necesitás ayuda\?/)).toBeNull();

    await failSearchMore(fetchMock, 1);
    expect(screen.getByText(/¿Necesitás ayuda\?/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Escribinos por WhatsApp.' })).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });

  it('links the WhatsApp help when the shop URL is provided', async () => {
    const fetchMock = notFoundFetch();
    vi.stubGlobal('fetch', fetchMock);
    renderLookup({ shopWhatsappUrl: 'https://wa.me/5491100000000' });
    openDialog();
    fillIdentity();

    await failSearchMore(fetchMock, 3);

    const help = screen.getByRole('link', { name: 'Escribinos por WhatsApp.' });
    expect(help).toHaveAttribute('href', 'https://wa.me/5491100000000');
    expect(help).toHaveAttribute('target', '_blank');
  });

  it('does not count network errors toward the WhatsApp help', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);
    renderLookup({ shopWhatsappUrl: 'https://wa.me/5491100000000' });
    openDialog();
    fillIdentity();

    await failSearchMore(fetchMock, 3);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No pudimos conectarnos. Revisá la conexión y probá de nuevo.'
    );
    expect(screen.queryByText(/¿Necesitás ayuda\?/)).toBeNull();
  });

  it('does not count server errors toward the WhatsApp help', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: { code: 'INTERNAL_ERROR' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderLookup();
    openDialog();
    fillIdentity();

    await failSearchMore(fetchMock, 3);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No pudimos buscar tu turno. Probá de nuevo en un momento.'
    );
    expect(screen.queryByText(/¿Necesitás ayuda\?/)).toBeNull();
  });

  it('closes on Escape and restores focus to the trigger', () => {
    renderLookup();
    const trigger = screen.getByRole('button', { name: 'Cancelar turno' });
    fireEvent.click(trigger);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('closes on an overlay click', () => {
    const { container } = renderLookup();
    openDialog();

    const overlay = container.querySelector('.modal-overlay');
    expect(overlay).not.toBeNull();
    if (!overlay) throw new Error('overlay missing');
    fireEvent.click(overlay);

    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
