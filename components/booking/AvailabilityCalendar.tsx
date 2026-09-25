'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { BookingForm } from '~/components/booking/BookingForm';
import type { AvailabilityDay, AvailabilitySlot } from '~/types/booking';
import type { Barber } from '~/types/public';

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

/** Full month labels, indexed the same way as the short ones. */
const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** Time-of-day groups, in the order the prototype renders them. */
export type TimeBucket = 'Mañana' | 'Tarde' | 'Noche';

const TIME_BUCKETS: readonly TimeBucket[] = ['Mañana', 'Tarde', 'Noche'];

/** The no-selection label; also the first option of the professional listbox. */
const ANY_PROFESSIONAL = 'Cualquier profesional';

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
  return `${WEEKDAYS[day] ?? ''} ${dayOfMonth} de ${MONTHS[month - 1] ?? ''}`;
}

/**
 * Local selection: an indexed day, the slot staged on it, and whether the flow
 * has moved on to the form. A staged slot is not a booking yet — the footer's
 * call to action is what opens the form, so the visitor sees which time they are
 * about to confirm before they type anything into it.
 */
type CalendarSelection = {
  dayIndex: number;
  slot: AvailabilitySlot | null;
  formOpen: boolean;
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
  barbers,
  bookingEndpoint,
  shopAddress,
}: {
  days: AvailabilityDay[];
  barbers: Barber[];
  bookingEndpoint: string;
  shopAddress: string | null;
}) {
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();
  const [selected, setSelected] = useState<CalendarSelection>(() => ({
    dayIndex: -1,
    slot: null,
    formOpen: false,
  }));
  const selectedCardRef = useRef<HTMLButtonElement | null>(null);

  /**
   * Professional selection. `null` is "Cualquier profesional". The list is
   * server-owned, so the index is the stable identity here; the booking RPC
   * still resolves the barber from the chosen service.
   */
  const [professional, setProfessional] = useState<number | null>(null);
  const [professionalOpen, setProfessionalOpen] = useState(false);
  const professionalWrapRef = useRef<HTMLDivElement | null>(null);
  const professionalListId = useId();
  const selectedBarber = professional === null ? null : (barbers[professional] ?? null);

  useEffect(() => {
    if (!professionalOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!professionalWrapRef.current?.contains(event.target as Node)) {
        setProfessionalOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setProfessionalOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [professionalOpen]);

  /**
   * Resolved against the CURRENT `days` on every render, where `-1` means "no
   * explicit pick yet". Both the first paint and the state a finished booking
   * leaves behind land on the first day that still has slots. That matters
   * because a booking can empty the day the visitor was looking at — they took
   * its last slot — and the refreshed prop arrives with that day at zero slots.
   */
  const selectedDayIndex =
    (days[selected.dayIndex]?.slots.length ?? 0) > 0
      ? selected.dayIndex
      : days.findIndex((day) => day.slots.length > 0);

  const selectedDay = selectedDayIndex >= 0 ? days[selectedDayIndex] : undefined;

  if (!selectedDay) {
    return (
      <p className="availability-empty" role="status">
        No hay horarios disponibles por el momento. Probá de nuevo más adelante.
      </p>
    );
  }

  const groups = bucketSlots(selectedDay.slots);

  /** The form is only reachable through the footer's call to action. */
  const formOpen = selected.formOpen && selected.slot !== null;

  /**
   * Starts a fresh booking. The slots on screen were rendered before this
   * visitor booked, so they still list the slot that was just taken — and that
   * slot's signed token is still valid, which turns a stale click into a
   * confusing "that slot is gone" error. Ask the server for the current window
   * instead of trusting the prop already in hand, and keep the island inert
   * until it answers, so nothing on screen can be clicked while it is a lie.
   */
  function restartBooking() {
    setSelected({ dayIndex: -1, slot: null, formOpen: false });
    startRefresh(() => router.refresh());
  }

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
    <div className={`availability${formOpen ? '' : ' has-sticky-bar'}`}>
      <div className="prof-row">
        <div className="prof-select-wrap" ref={professionalWrapRef}>
          <button
            type="button"
            className="prof-select"
            aria-haspopup="listbox"
            aria-expanded={professionalOpen}
            aria-controls={professionalListId}
            onClick={() => setProfessionalOpen((current) => !current)}
          >
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
            <span className="prof-select-value">{selectedBarber?.name ?? ANY_PROFESSIONAL}</span>
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
          </button>
          {professionalOpen ? (
            <div
              className="prof-menu"
              role="listbox"
              id={professionalListId}
              aria-label="Profesional"
            >
              <button
                type="button"
                role="option"
                aria-selected={professional === null}
                className="prof-option"
                onClick={() => {
                  setProfessional(null);
                  setProfessionalOpen(false);
                }}
              >
                {ANY_PROFESSIONAL}
              </button>
              {barbers.map((barber, index) => (
                <button
                  key={`${barber.name}-${index}`}
                  type="button"
                  role="option"
                  aria-selected={professional === index}
                  className="prof-option"
                  onClick={() => {
                    setProfessional(index);
                    setProfessionalOpen(false);
                  }}
                >
                  {barber.name}
                  {barber.alias ? <span className="prof-option-alias">{barber.alias}</span> : null}
                </button>
              ))}
            </div>
          ) : null}
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
          const isSelected = index === selectedDayIndex;

          return (
            <button
              key={day.date}
              ref={isSelected ? selectedCardRef : null}
              type="button"
              className={`date-card${isSelected ? ' selected' : ''}`}
              aria-pressed={isSelected}
              disabled={disabled || isRefreshing}
              onClick={() => setSelected({ dayIndex: index, slot: null, formOpen: false })}
              data-testid={`date-card-${day.date}`}
            >
              <span className="dow">{WEEKDAYS_SHORT[day.day] ?? ''}</span>
              <span className="dnum">{dayOfMonth}</span>
              <span className="mon">{MONTHS_SHORT[month - 1] ?? ''}</span>
            </button>
          );
        })}
      </div>

      {/*
       * `onBack` restores the staged slot rather than clearing it, so leaving the
       * form returns the visitor to a footer that still names the time.
       */}
      {formOpen && selected.slot ? (
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
          onBack={() =>
            setSelected({ dayIndex: selectedDayIndex, slot: selected.slot, formOpen: false })
          }
          onRestart={restartBooking}
        />
      ) : isRefreshing ? (
        // The replaced list is still the pre-booking one; say so instead of
        // offering slots the server has already taken.
        <p className="availability-empty" role="status">
          Actualizando horarios…
        </p>
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
                    {slots.map((slot) => {
                      const staged = selected.slot?.start === slot.start;
                      return (
                        <button
                          key={slot.start}
                          type="button"
                          className={`availability-slot${staged ? ' selected' : ''}`}
                          aria-pressed={staged}
                          onClick={() =>
                            setSelected({ dayIndex: selectedDayIndex, slot, formOpen: false })
                          }
                        >
                          {formatTime(slot.start)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/*
       * The staged choice and the step's only call to action, the way the
       * prototype holds them: fixed to the bottom, disabled copy until a time is
       * staged, and gone once the form is open so it cannot be pressed twice.
       */}
      {formOpen ? null : (
        <div className="sticky-bar">
          <p className="sticky-summary" role="status">
            {selected.slot ? (
              <>
                <strong>{formatDay(selectedDay.date, selectedDay.day)}</strong>
                {formatTime(selected.slot.start)} hs
              </>
            ) : (
              'Elegí fecha y hora para continuar'
            )}
          </p>
          <button
            type="button"
            className="btn-primary"
            disabled={selected.slot === null}
            onClick={() =>
              setSelected({ dayIndex: selectedDayIndex, slot: selected.slot, formOpen: true })
            }
          >
            Siguiente
          </button>
        </div>
      )}
    </div>
  );
}
