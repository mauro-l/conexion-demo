'use client';

import { useState } from 'react';
import type { AvailabilityDay, AvailabilitySlot } from '~/types/booking';

/** Weekday labels indexed by the DTO's `day` field (`0=Sunday .. 6=Saturday`). */
const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function formatTime(localDateTime: string): string {
  const time = localDateTime.includes('T') ? localDateTime.split('T')[1] : localDateTime;
  return time.slice(0, 5);
}

/**
 * The DTO carries Buenos Aires local strings and a pre-computed weekday index,
 * so both the server and the browser format the exact same text. Building a
 * `Date` would re-interpret the value in the renderer's timezone and break
 * hydration.
 */
function formatDay(date: string, day: number): string {
  const [, month, dayOfMonth] = date.split('-');
  return `${WEEKDAYS[day] ?? ''} ${Number(dayOfMonth)}/${Number(month)}`;
}

/**
 * Read-only availability island: the only Client Component in the booking flow.
 *
 * It receives an already resolved, ID-free snapshot and owns nothing but local
 * selection state. Reaching the final state performs no fetch and no booking
 * mutation — it is deliberately a dead end until a later stage.
 */
export function AvailabilityCalendar({ days }: { days: AvailabilityDay[] }) {
  const [selected, setSelected] = useState<{ day: AvailabilityDay; slot: AvailabilitySlot } | null>(
    null
  );

  if (!days.some((day) => day.slots.length > 0)) {
    return (
      <p className="availability-empty" role="status">
        No hay horarios disponibles por el momento. Probá de nuevo más adelante.
      </p>
    );
  }

  if (selected) {
    return (
      <div className="availability-final" role="status">
        <p>
          Elegiste el {formatDay(selected.day.date, selected.day.day)} a las{' '}
          {formatTime(selected.slot.start)}.
        </p>
        <p>La reserva se completa en una próxima etapa: todavía no se reservó nada.</p>
        <button type="button" className="ticket-cta" onClick={() => setSelected(null)}>
          Elegir otro horario
        </button>
      </div>
    );
  }

  return (
    <div className="availability">
      {days.map((day) => (
        <section className="availability-day" key={day.date}>
          <h2 className="availability-day-title">{formatDay(day.date, day.day)}</h2>
          {day.slots.length === 0 ? (
            <p className="availability-day-empty">Sin horarios</p>
          ) : (
            <div className="availability-slots">
              {day.slots.map((slot) => (
                <button
                  key={slot.start}
                  type="button"
                  className="availability-slot"
                  onClick={() => setSelected({ day, slot })}
                >
                  {formatTime(slot.start)}
                </button>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
