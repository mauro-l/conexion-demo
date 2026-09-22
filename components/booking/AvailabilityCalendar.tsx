'use client';

import { useState } from 'react';
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

function formatTime(localDateTime: string): string {
  const time = localDateTime.includes('T') ? localDateTime.split('T')[1] : localDateTime;
  return time.slice(0, 5);
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
 * Read-only availability island: the only Client Component in the booking flow.
 *
 * It receives an already resolved, ID-free snapshot and owns nothing but local
 * selection state. Reaching the final state performs no fetch and no booking
 * mutation — it is deliberately a dead end until a later stage.
 *
 * The initial selection is computed in the `useState` initializer from props, so
 * the server and the client agree before hydration: the first day with slots is
 * selected, or `-1` when the whole window is empty. No `Date` is constructed and
 * no effect runs after mount, so the rendered output is deterministic.
 */
export function AvailabilityCalendar({ days }: { days: AvailabilityDay[] }) {
  const [selected, setSelected] = useState<CalendarSelection>(() => ({
    dayIndex: days.findIndex((day) => day.slots.length > 0),
    slot: null,
  }));

  const selectedDay = selected.dayIndex >= 0 ? days[selected.dayIndex] : undefined;

  if (!selectedDay) {
    return (
      <p className="availability-empty" role="status">
        No hay horarios disponibles por el momento. Probá de nuevo más adelante.
      </p>
    );
  }

  return (
    <div className="availability">
      <p className="date-label">Elegí una fecha</p>
      <div className="date-scroller">
        {days.map((day, index) => {
          const { month, dayOfMonth } = dateParts(day.date);
          const disabled = day.slots.length === 0;
          const isSelected = index === selected.dayIndex;

          return (
            <button
              key={day.date}
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
        <div className="availability-final" role="status">
          <p>
            Elegiste el {formatDay(selectedDay.date, selectedDay.day)} a las{' '}
            {formatTime(selected.slot.start)}.
          </p>
          <p>La reserva se completa en una próxima etapa: todavía no se reservó nada.</p>
          <button
            type="button"
            className="ticket-cta"
            onClick={() => setSelected({ dayIndex: selected.dayIndex, slot: null })}
          >
            Elegir otro horario
          </button>
        </div>
      ) : (
        <div className="availability-slots">
          {selectedDay.slots.map((slot) => (
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
      )}
    </div>
  );
}
