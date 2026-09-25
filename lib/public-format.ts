/**
 * Shared public-UI formatters.
 *
 * Both the landing service catalog and the booking step's service chip render
 * the same `duration · price` treatment, so the formatting lives here once
 * instead of being copied per surface.
 */

/** Formats a service duration in minutes into the UI's short label. */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (remainder === 0) return `${hours} h`;
  return `${hours} h ${remainder} min`;
}

/** Formats an integer price with the Argentine thousands separator. */
export function formatPrice(price: number): string {
  return `$${price.toLocaleString('es-AR')}`;
}

/** Formats a local-naive DTO date-time without constructing a `Date`. */
export function formatLocalDateTime(localDateTime: string): string {
  const [date, time = ''] = localDateTime.split('T');
  const [, month, day] = date.split('-');
  return `${Number(day)}/${Number(month)} a las ${time.slice(0, 5)}`;
}
