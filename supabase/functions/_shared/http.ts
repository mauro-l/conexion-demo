// The Next dev server owns 3000. The previous value here was 4321, the Astro dev
// port, which stopped existing when the app migrated to Next — so a browser
// calling these functions during local development was silently not allowed.
const ALLOWED_ORIGINS = new Set<string>(['http://localhost:3000']);
const configured = Deno.env.get('PUBLIC_SITE_ORIGIN');
if (configured) ALLOWED_ORIGINS.add(configured);

/** Methods advertised by the read-only public functions. */
export const READ_METHODS = 'GET, OPTIONS';
/**
 * Methods advertised by the public booking writer. The browser POSTs to it
 * directly, so the preflight has to allow POST or every request is blocked
 * before it leaves the browser.
 */
export const WRITE_METHODS = 'POST, OPTIONS';

/**
 * `Idempotency-Key` is listed for every function rather than only the writer.
 * This list is a browser hint, not an authorization boundary: each function
 * still rejects an unexpected method and body. Keeping one constant stops the
 * two lists from drifting apart, which is how a preflight starts failing with
 * no visible cause.
 */
const ALLOWED_HEADERS = 'Content-Type, Accept, Idempotency-Key';

export function isAllowedOrigin(origin: string | null): origin is string {
  return !!origin && ALLOWED_ORIGINS.has(origin);
}

function applyCors(headers: Headers, origin: string, methods: string): void {
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Methods', methods);
  headers.set('Access-Control-Allow-Headers', ALLOWED_HEADERS);
  headers.set('Vary', 'Origin');
}

export function corsHeaders(origin: string, methods: string = READ_METHODS): Headers {
  const h = new Headers();
  applyCors(h, origin, methods);
  return h;
}

export function securityHeaders(): Headers {
  const h = new Headers();
  h.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  h.set('Referrer-Policy', 'no-referrer');
  h.set('X-Content-Type-Options', 'nosniff');
  h.set(
    'Permissions-Policy',
    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()'
  );
  return h;
}

export function mergeHeaders(...sources: Headers[]): Headers {
  const out = new Headers();
  for (const src of sources) {
    src.forEach((value, key) => out.set(key, value));
  }
  return out;
}

export function jsonResponse(
  body: unknown,
  status = 200,
  origin?: string | null,
  noStore = false,
  methods: string = READ_METHODS
): Response {
  const headers = mergeHeaders(
    securityHeaders(),
    new Headers({ 'Content-Type': 'application/json' })
  );
  if (noStore) headers.set('Cache-Control', 'no-store');
  if (origin && isAllowedOrigin(origin)) applyCors(headers, origin, methods);
  return new Response(JSON.stringify(body), { status, headers });
}

export function errorResponse(
  code: string,
  message: string,
  status: number,
  retryable = false,
  origin?: string | null,
  noStore = false,
  methods: string = READ_METHODS
): Response {
  return jsonResponse({ error: { code, message, retryable } }, status, origin, noStore, methods);
}

export function handleOptions(
  origin: string | null,
  noStore = false,
  methods: string = READ_METHODS
): Response {
  const headers = mergeHeaders(securityHeaders(), new Headers());
  if (noStore) headers.set('Cache-Control', 'no-store');
  if (origin && isAllowedOrigin(origin)) {
    applyCors(headers, origin, methods);
    headers.set('Access-Control-Max-Age', '86400');
  }
  return new Response(null, { status: 204, headers });
}
