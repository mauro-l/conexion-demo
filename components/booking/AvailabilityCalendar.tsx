'use client';

import { useRef, useState } from 'react';
import { BookingForm } from '~/components/booking/BookingForm';
import type { AvailabilityDay, AvailabilitySlot } from '~/types/booking';

/** Weekday labels indexed by the DTO's `day` field (`0=Sunday .. 6=Saturday`). */
const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

/**
 * Short weekday labels for the date cards, indexed by the same DTO `day` field.
 * The prototype capitalizes them with CSS (`text-transform: capitalize`), so the
 * stored value stays lowercase and the accent survives.
 */
const WEEKDAYS_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

/** Short month labels, indexed by the 1-based month embedded in the `date` string. */
const MONTHS_SHORT = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
];

/** Time-of-day groups, in the order the prototype renders them. */
export type TimeBucket = 'Mañana' | 'Tarde' | 'Noche';

const TIME_BUCKETS: readonly TimeBucket[] = ['Mañana', 'Tarde', 'Noche'];

/** The local time part of a DTO date-time string, without constructing a `Date`. */
function timePart(localDateTime: string): string {
  return localDateTime.includes('T') ? localDateTime.split('T')[1] : localDateTime;
}

function formatTime(localDateTime: string): string {
  return timePart(localDateTime).slice(0, 5);
}

/**
 * The hour of a slot, read straight from its local time string (`HH:MM` or the
 * part after `T`). String parsing keeps bucketing deterministic on the server
 * and the browser: constructing a `Date` would re-interpret the value in the
 * renderer's timezone and break hydration.
 */
function slotHour(localDateTime: string): number {
  return Number(timePart(localDateTime).slice(0, 2));
}

/**
 * Buckets a day's slots into the prototype's three time-of-day groups:
 * `hour < 12` -> Mañana, `< 18` -> Tarde, otherwise Noche. Empty groups stay
 * empty; the renderer omits their heading.
 */
export function bucketSlots(slots: AvailabilitySlot[]): Record<TimeBucket, AvailabilitySlot[]> {
  const groups: Record<TimeBucket, AvailabilitySlot[]> = {
    Mañana: [],
    Tarde: [],
    Noche: [],
  };

  for (const slot of slots) {
    const hour = slotHour(slot.start);
    groups[hour < 12 ? 'Mañana' : hour < 18 ? 'Tarde' : 'Noche'].push(slot);
  }

  return groups;
}

/** Splits a DTO date string (`YYYY-MM-DD`) into its numeric parts, without a `Date`. */
function dateParts(date: string): { month: number; dayOfMonth: number } {
  const [, month, dayOfMonth] = date.split('-');
  return { month: Number(month), dayOfMonth: Number(dayOfMonth) };
}

/**
 * The DTO carries Buenos Aires local strings and a pre-computed weekday index,
 * so both the server and the browser format the exact same text. Building a
 * `Date` would re-interpret the value in the renderer's timezone and break
 * hydration.
 */
function formatDay(date: string, day: number): string {
  const { month, dayOfMonth } = dateParts(date);
  return `${WEEKDAYS[day] ?? ''} ${dayOfMonth}/${month}`;
}

/** Local selection: an indexed day plus its chosen slot, or `null` until a slot is picked. */
type CalendarSelection = {
  dayIndex: number;
  slot: AvailabilitySlot | null;
};

/**
 * Availability island: the only Client Component in the booking flow.
 *
 * It receives an already resolved, ID-free snapshot and owns the local selection
 * state. Once a slot is chosen it hands the flow to `BookingForm`, which owns the
 * customer fields, the POST and the inline result. The island itself still
 * fetches nothing: the one browser-to-Edge call lives in the form.
 *
 * The initial selection is computed in the `useState` initializer from props, so
 * the server and the client agree before hydration: the first day with slots is
 * selected, or `-1` when the whole window is empty. No `Date` is constructed and
 * no effect runs after mount, so the rendered output is deterministic.
 */
export function AvailabilityCalendar({
  days,
  bookingEndpoint,
  shopAddress,
}: {
  days: AvailabilityDay[];
  bookingEndpoint: string;
  shopAddress: string | null;
}) {
  const [selected, setSelected] = useState<CalendarSelection>(() => ({
    dayIndex: days.findIndex((day) => day.slots.length > 0),
    slot: null,
  }));
  const selectedCardRef = useRef<HTMLButtonElement | null>(null);

  const selectedDay = selected.dayIndex >= 0 ? days[selected.dayIndex] : undefined;

  if (!selectedDay) {
    return (
      <p className="availability-empty" role="status">
        No hay horarios disponibles por el momento. Probá de nuevo más adelante.
      </p>
    );
  }

  const groups = bucketSlots(selectedDay.slots);

  /**
   * Static calendar-jump affordance: it only brings the selected card into view
   * and focuses it. It never opens a date dialog, fetches, or navigates.
   */
  function jumpToSelectedDate() {
    const card = selectedCardRef.current;
    if (!card) return;
    card.scrollIntoView?.({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    card.focus?.();
  }

  return (
    <div className="availability">
      <div className="prof-row">
        {/*
         * Exactly one professional affordance, always "Cualquier profesional".
         * Per-barber selection is out of scope, so it stays a static pill with
         * no handler and no internal id.
         */}
        <div className="prof-select">
          <span className="prof-avatar" aria-hidden="true">
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M20 21a8 8 0 1 0-16 0" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </span>
          <span className="prof-select-value">Cualquier profesional</span>
          <svg
            className="prof-chevron"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
        <button
          type="button"
          className="cal-jump-btn"
          aria-label="Ir a una fecha específica"
          onClick={jumpToSelectedDate}
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M3 10h18M8 3v4M16 3v4" />
          </svg>
        </button>
      </div>

      <p className="date-label">Elegí una fecha</p>
      <div className="date-scroller">
        {days.map((day, index) => {
          const { month, dayOfMonth } = dateParts(day.date);
          const disabled = day.slots.length === 0;
          const isSelected = index === selected.dayIndex;

          return (
            <button
              key={day.date}
              ref={isSelected ? selectedCardRef : null}
              type="button"
              className={`date-card${isSelected ? ' selected' : ''}`}
              aria-pressed={isSelected}
              disabled={disabled}
              onClick={() => setSelected({ dayIndex: index, slot: null })}
              data-testid={`date-card-${day.date}`}
            >
              <span className="dow">{WEEKDAYS_SHORT[day.day] ?? ''}</span>
              <span className="dnum">{dayOfMonth}</span>
              <span className="mon">{MONTHS_SHORT[month - 1] ?? ''}</span>
            </button>
          );
        })}
      </div>

      {selected.slot ? (
        <BookingForm
          endpoint={bookingEndpoint}
          token={selected.slot.availabilityToken}
          shopAddress={shopAddress}
          recap={
            <p className="booking-recap" role="status">
              Elegiste el {formatDay(selectedDay.date, selectedDay.day)} a las{' '}
              {formatTime(selected.slot.start)}.
            </p>
          }
          onBack={() => setSelected({ dayIndex: selected.dayIndex, slot: null })}
        />
      ) : (
        <>
          <p className="date-label">Elegí un horario</p>
          <div className="availability-slots">
            {TIME_BUCKETS.map((bucket) => {
              const slots = groups[bucket];
              // A group with no slots must not render its heading.
              if (slots.length === 0) return null;

              return (
                <div className="time-group" key={bucket}>
                  <p className="group-label">{bucket}</p>
                  <div className="time-group-slots">
                    {slots.map((slot) => (
                      <button
                        key={slot.start}
                        type="button"
                        className="availability-slot"
                        onClick={() => setSelected({ dayIndex: selected.dayIndex, slot })}
                      >
                        {formatTime(slot.start)}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
