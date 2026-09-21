/**
 * Server-only site configuration for the public landing.
 *
 * The configured barbershop slug and the site origin are read from the server
 * environment. They are never placed in a URL, rendered into HTML, or imported
 * by client code.
 */

const SLUG_RE = /^[a-z0-9-]{1,63}$/;
const DEV_ORIGIN = 'http://localhost:3000';

/**
 * Resolve the server-only slug used by the landing at `/`.
 *
 * The value comes from `BARBERSHOP_PUBLIC_SLUG` and must be a well-formed
 * public slug. Unknown or unpublished slugs are not an error here; the read
 * boundary turns them into the public not-found experience.
 */
export function getConfiguredSlug(): string {
  const raw = process.env.BARBERSHOP_PUBLIC_SLUG?.trim();
  if (!raw) {
    throw new Error('BARBERSHOP_PUBLIC_SLUG is required to render the public landing.');
  }
  if (!SLUG_RE.test(raw)) {
    throw new Error('BARBERSHOP_PUBLIC_SLUG must match ^[a-z0-9-]{1,63}$.');
  }
  return raw;
}

/**
 * Resolve the public site origin used by `metadataBase` and generated links.
 *
 * Development may fall back to `http://localhost:3000`. Production fails
 * clearly when `PUBLIC_SITE_ORIGIN` is missing or malformed, so a deployment
 * can never silently advertise the wrong domain.
 */
export function getSiteOrigin(): URL {
  const raw = process.env.PUBLIC_SITE_ORIGIN?.trim();

  if (raw) {
    try {
      return new URL(raw);
    } catch {
      throw new Error('PUBLIC_SITE_ORIGIN must be an absolute URL, for example https://example.com.');
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    return new URL(DEV_ORIGIN);
  }

  throw new Error('PUBLIC_SITE_ORIGIN is required in production.');
}
