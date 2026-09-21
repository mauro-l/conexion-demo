import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AvailabilityCalendar } from '~/components/booking/AvailabilityCalendar';
import type { AvailabilityDay } from '~/types/booking';

const twoDays: AvailabilityDay[] = [
  {
    date: '2026-09-21',
    day: 1,
    slots: [
      { start: '2026-09-21T09:00', end: '2026-09-21T09:40', availabilityToken: 'tok.one.sig' },
      { start: '2026-09-21T09:30', end: '2026-09-21T10:10', availabilityToken: 'tok.two.sig' },
    ],
  },
  { date: '2026-09-22', day: 2, slots: [] },
];

const emptyDays: AvailabilityDay[] = [
  { date: '2026-09-21', day: 1, slots: [] },
  { date: '2026-09-22', day: 2, slots: [] },
];

describe('AvailabilityCalendar', () => {
  it('renders every day, formats the weekday in Buenos Aires local time, and marks empty days', () => {
    render(<AvailabilityCalendar days={twoDays} />);

    expect(screen.getByRole('heading', { name: 'Lunes 21/9' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Martes 22/9' })).toBeInTheDocument();
    expect(screen.getByText('Sin horarios')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '09:00' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '09:30' })).toBeInTheDocument();
  });

  it('shows the empty-calendar success state when no day has slots', () => {
    render(<AvailabilityCalendar days={emptyDays} />);

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('No hay horarios disponibles por el momento');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('treats an empty day list as the same empty-calendar success state', () => {
    render(<AvailabilityCalendar days={[]} />);

    expect(screen.getByRole('status')).toHaveTextContent(
      'No hay horarios disponibles por el momento'
    );
  });

  it('selecting a slot reveals the end-of-flow state naming the day and time', () => {
    render(<AvailabilityCalendar days={twoDays} />);

    fireEvent.click(screen.getByRole('button', { name: '09:30' }));

    expect(screen.getByRole('status')).toHaveTextContent('Elegiste el Lunes 21/9 a las 09:30.');
    expect(screen.getByText('La reserva se completa en una próxima etapa: todavía no se reservó nada.')).toBeInTheDocument();
  });

  it('reaching the final state performs no fetch and no booking mutation', () => {
    const fetchSpy: typeof globalThis.fetch = (() => {
      throw new Error('the read-only island must not call fetch');
    }) as unknown as typeof globalThis.fetch;
    const original = globalThis.fetch;
    globalThis.fetch = fetchSpy;

    try {
      render(<AvailabilityCalendar days={twoDays} />);
      fireEvent.click(screen.getByRole('button', { name: '09:00' }));
      fireEvent.click(screen.getByRole('button', { name: 'Elegir otro horario' }));
      fireEvent.click(screen.getByRole('button', { name: '09:00' }));
    } finally {
      globalThis.fetch = original;
    }

    expect(screen.getByRole('status')).toHaveTextContent('Elegiste el Lunes 21/9 a las 09:00.');
  });

  it('lets the visitor go back to the slot grid after reaching the final state', () => {
    render(<AvailabilityCalendar days={twoDays} />);

    fireEvent.click(screen.getByRole('button', { name: '09:00' }));
    fireEvent.click(screen.getByRole('button', { name: 'Elegir otro horario' }));

    expect(screen.getByRole('button', { name: '09:30' })).toBeInTheDocument();
    expect(screen.queryByText(/Elegiste el/)).toBeNull();
  });

  it('never renders an internal identifier or the raw availability token', () => {
    render(<AvailabilityCalendar days={twoDays} />);

    const html = document.body.innerHTML;
    expect(html).not.toContain('tok.one.sig');
    expect(html).not.toContain('tok.two.sig');
    expect(html).not.toContain('publicServiceToken');
  });
});
