import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AvailabilityCalendar, bucketSlots } from '~/components/booking/AvailabilityCalendar';
import type { AvailabilityDay, AvailabilitySlot } from '~/types/booking';

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

/**
 * The closed-leading-day window from the spec: 14 returned days, the first with
 * zero slots, the third open, and a later day (`day 3`) also open so selecting it
 * replaces both the selection and the rendered slots.
 */
const windowWithClosedLeadingDay: AvailabilityDay[] = [
  { date: '2026-09-06', day: 0, slots: [] },
  { date: '2026-09-07', day: 1, slots: [] },
  {
    date: '2026-09-08',
    day: 2,
    slots: [
      { start: '2026-09-08T09:00', end: '2026-09-08T09:40', availabilityToken: 'tok.day2.sig' },
    ],
  },
  {
    date: '2026-09-09',
    day: 3,
    slots: [
      { start: '2026-09-09T11:00', end: '2026-09-09T11:40', availabilityToken: 'tok.day3.sig' },
      { start: '2026-09-09T15:30', end: '2026-09-09T16:10', availabilityToken: 'tok.day3b.sig' },
    ],
  },
  ...Array.from({ length: 10 }, (_, index) => ({
    date: `2026-09-${String(10 + index).padStart(2, '0')}`,
    day: ((index + 4) % 7) as number,
    slots: [],
  })),
];

/**
 * The spec's boundary slots: each one sits exactly on a bucket edge so a wrong
 * comparison operator (`<=` instead of `<`) would land it in the wrong group.
 */
const boundarySlots: AvailabilitySlot[] = [
  { start: '2026-09-21T11:59', end: '2026-09-21T12:39', availabilityToken: 'tok.am.sig' },
  { start: '2026-09-21T12:00', end: '2026-09-21T12:40', availabilityToken: 'tok.noon.sig' },
  { start: '2026-09-21T17:59', end: '2026-09-21T18:39', availabilityToken: 'tok.pm.sig' },
  { start: '2026-09-21T18:00', end: '2026-09-21T18:40', availabilityToken: 'tok.night.sig' },
];

const boundaryDay: AvailabilityDay[] = [{ date: '2026-09-21', day: 1, slots: boundarySlots }];

/** A day with slots in one bucket only, to prove the other headings are omitted. */
const morningOnlyDay: AvailabilityDay[] = [
  {
    date: '2026-09-21',
    day: 1,
    slots: [
      { start: '2026-09-21T09:00', end: '2026-09-21T09:40', availabilityToken: 'tok.solo.sig' },
    ],
  },
];

describe('AvailabilityCalendar', () => {
  it('renders one date card per returned day with DTO-derived weekday, day and month labels', () => {
    render(<AvailabilityCalendar days={windowWithClosedLeadingDay} />);

    // 14 returned days must produce 14 cards (never assume a fixed window size).
    expect(screen.getAllByRole('button', { name: /^[a-záéíóú]{3} \d{1,2} [a-z]{3}$/ })).toHaveLength(
      14
    );

    const first = screen.getByTestId('date-card-2026-09-06');
    expect(first).toHaveTextContent('dom');
    expect(first).toHaveTextContent('6');
    expect(first).toHaveTextContent('sep');

    const third = screen.getByTestId('date-card-2026-09-08');
    expect(third).toHaveTextContent('mar');
    expect(third).toHaveTextContent('8');
    expect(third).toHaveTextContent('sep');
  });

  it('precedes the scroller with the literal Elegí una fecha label', () => {
    render(<AvailabilityCalendar days={twoDays} />);

    expect(screen.getByText('Elegí una fecha')).toBeInTheDocument();
  });

  it('disables exactly the days with zero slots and leaves open days enabled', () => {
    render(<AvailabilityCalendar days={windowWithClosedLeadingDay} />);

    expect(screen.getByTestId('date-card-2026-09-06')).toBeDisabled();
    expect(screen.getByTestId('date-card-2026-09-07')).toBeDisabled();
    expect(screen.getByTestId('date-card-2026-09-08')).not.toBeDisabled();
    expect(screen.getByTestId('date-card-2026-09-09')).not.toBeDisabled();
  });

  it('selects the first open day when the window starts with a closed day', () => {
    render(<AvailabilityCalendar days={windowWithClosedLeadingDay} />);

    expect(screen.getByTestId('date-card-2026-09-06')).not.toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByTestId('date-card-2026-09-08')).toHaveAttribute('aria-pressed', 'true');
    // Exactly one card is selected.
    expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(1);
    // The rendered slots belong to the selected (third) day.
    expect(screen.getByRole('button', { name: '09:00' })).toBeInTheDocument();
  });

  it('activates another open card and replaces both the selection and the rendered slots', () => {
    render(<AvailabilityCalendar days={windowWithClosedLeadingDay} />);

    // Default selection is the third day (index 2); switch to the fourth (index 3).
    expect(screen.getByRole('button', { name: '09:00' })).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('date-card-2026-09-09'));

    expect(screen.getByTestId('date-card-2026-09-09')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('date-card-2026-09-08')).not.toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(1);
    // The time content changed to day 3's slots.
    expect(screen.getByRole('button', { name: '11:00' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '15:30' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '09:00' })).toBeNull();
  });

  it('does not select a disabled card when it is activated', () => {
    render(<AvailabilityCalendar days={windowWithClosedLeadingDay} />);

    fireEvent.click(screen.getByTestId('date-card-2026-09-06'));

    expect(screen.getByTestId('date-card-2026-09-06')).not.toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByTestId('date-card-2026-09-08')).toHaveAttribute('aria-pressed', 'true');
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
    expect(
      screen.getByText('La reserva se completa en una próxima etapa: todavía no se reservó nada.')
    ).toBeInTheDocument();
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

  it('places the 11:59/12:00/17:59/18:00 boundary slots in Mañana, Tarde, Tarde and Noche', () => {
    const groups = bucketSlots(boundarySlots);

    expect(groups.Mañana.map((slot) => slot.start)).toEqual(['2026-09-21T11:59']);
    expect(groups.Tarde.map((slot) => slot.start)).toEqual([
      '2026-09-21T12:00',
      '2026-09-21T17:59',
    ]);
    expect(groups.Noche.map((slot) => slot.start)).toEqual(['2026-09-21T18:00']);
  });

  it('buckets a bare HH:MM start string without constructing a Date', () => {
    const groups = bucketSlots([
      { start: '09:00', end: '09:40', availabilityToken: 'tok.bare.sig' },
      { start: '19:00', end: '19:40', availabilityToken: 'tok.bare.pm.sig' },
    ]);

    expect(groups.Mañana.map((slot) => slot.start)).toEqual(['09:00']);
    expect(groups.Tarde).toHaveLength(0);
    expect(groups.Noche.map((slot) => slot.start)).toEqual(['19:00']);
  });

  it('renders the selected day slots under Mañana, Tarde and Noche with the literal label above', () => {
    render(<AvailabilityCalendar days={boundaryDay} />);

    expect(screen.getByText('Elegí un horario', { exact: true })).toBeInTheDocument();
    expect(screen.getAllByText(/^(Mañana|Tarde|Noche)$/).map((node) => node.textContent)).toEqual([
      'Mañana',
      'Tarde',
      'Noche',
    ]);
    expect(screen.getByRole('button', { name: '11:59' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '12:00' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '17:59' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '18:00' })).toBeInTheDocument();
  });

  it('omits a group heading when that bucket has no slots', () => {
    render(<AvailabilityCalendar days={morningOnlyDay} />);

    expect(screen.getByText('Mañana')).toBeInTheDocument();
    expect(screen.queryByText('Tarde')).toBeNull();
    expect(screen.queryByText('Noche')).toBeNull();
  });
});
