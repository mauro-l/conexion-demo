const ALLOWED_ORIGINS = new Set<string>(['http://localhost:4321']);
const configured = Deno.env.get('PUBLIC_SITE_ORIGIN');
if (configured) ALLOWED_ORIGINS.add(configured);

export function isAllowedOrigin(origin: string | null): origin is string {
  return !!origin && ALLOWED_ORIGINS.has(origin);
}

export function corsHeaders(origin: string): Headers {
  const h = new Headers();
  h.set('Access-Control-Allow-Origin', origin);
  h.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Content-Type, Accept');
  h.set('Vary', 'Origin');
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
  origin?: string | null
): Response {
  const headers = mergeHeaders(
    securityHeaders(),
    new Headers({ 'Content-Type': 'application/json' })
  );
  if (origin && isAllowedOrigin(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Accept');
    headers.set('Vary', 'Origin');
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export function errorResponse(
  code: string,
  message: string,
  status: number,
  retryable = false,
  origin?: string | null
): Response {
  return jsonResponse({ error: { code, message, retryable } }, status, origin);
}

export function handleOptions(origin: string | null): Response {
  const headers = mergeHeaders(securityHeaders(), new Headers());
  if (origin && isAllowedOrigin(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Accept');
    headers.set('Access-Control-Max-Age', '86400');
    headers.set('Vary', 'Origin');
  }
  return new Response(null, { status: 204, headers });
}
