// @vitest-environment node
import { describe, it, expect } from 'vitest';

// `http.ts` reads the origin allowlist from `Deno.env` at module load. The
// module under test only needs the global to exist; Node is not Deno, so the
// stub is installed before the import below is evaluated.
(globalThis as { Deno?: unknown }).Deno = { env: { get: () => undefined } };

const { errorResponse, handleOptions, jsonResponse, securityHeaders } = await import(
  '~/supabase/functions/_shared/http'
);

// W1, supplement: the served function is proven over real HTTP by
// `npm run test:edge`. These unit cases pin the response factory so a
// regression is caught even without the stack running.

describe('jsonResponse', () => {
  it('omits Cache-Control by default so callers must opt into no-store', () => {
    const response = jsonResponse({ ok: true });
    expect(response.headers.get('Cache-Control')).toBeNull();
  });

  it('sets Cache-Control: no-store when asked, on success and on error statuses', () => {
    expect(jsonResponse({ ok: true }, 200, null, true).headers.get('Cache-Control')).toBe('no-store');
    expect(jsonResponse({ ok: false }, 500, null, true).headers.get('Cache-Control')).toBe(
      'no-store'
    );
  });

  it('always applies the security headers', () => {
    const headers = jsonResponse({ ok: true }).headers;
    for (const [name, value] of securityHeaders()) {
      expect(headers.get(name)).toBe(value);
    }
  });

  it('echoes an allowed origin and ignores an unlisted one', () => {
    expect(jsonResponse({}, 200, 'http://localhost:3000').headers.get('Access-Control-Allow-Origin')).toBe(
      'http://localhost:3000'
    );
    expect(jsonResponse({}, 200, 'https://evil.example').headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('advertises the methods of the function being served', () => {
    // The reads are GET-only and the booking writer is POST-only. A single shared
    // list would get one of the two blocked at the browser preflight.
    expect(
      jsonResponse({}, 200, 'http://localhost:3000', true, 'POST, OPTIONS').headers.get(
        'Access-Control-Allow-Methods'
      )
    ).toBe('POST, OPTIONS');
    expect(
      jsonResponse({}, 200, 'http://localhost:3000').headers.get('Access-Control-Allow-Methods')
    ).toBe('GET, OPTIONS');
  });
});

describe('errorResponse', () => {
  it('shapes the stable error body and keeps no-store on every branch', () => {
    const response = errorResponse('INVALID_INPUT', 'Invalid date', 400, false, null, true);
    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    return response.json().then((body) => {
      expect(body).toEqual({
        error: { code: 'INVALID_INPUT', message: 'Invalid date', retryable: false },
      });
    });
  });
});

describe('handleOptions', () => {
  it('answers 204 with no-store, without a body', () => {
    const response = handleOptions(null, true);
    expect(response.status).toBe(204);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});
