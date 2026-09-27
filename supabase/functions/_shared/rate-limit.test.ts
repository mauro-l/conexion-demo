// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { RateLimitCounter } from '~/supabase/functions/_shared/rate-limit';

// `rate-limit.ts` imports `http.ts`, which reads the origin allowlist from
// `Deno.env` at module load. Same stub trick as `http.test.ts`: the module
// under test only needs the global to exist.
(globalThis as { Deno?: unknown }).Deno = { env: { get: () => undefined } };

const {
  RATE_LIMIT_WINDOW_SECONDS,
  UNKNOWN_CLIENT_IP,
  checkRateLimit,
  extractClientIp,
  rateLimitResponse,
} = await import('~/supabase/functions/_shared/rate-limit');

// W4 (rate-limit): the served functions are proven over real HTTP by
// `npm run test:edge`. These unit cases pin the helper contract — IP
// extraction, fail-closed verdicts, and the 429 shape — so a regression is
// caught even without the stack running.

function headersOf(values: Record<string, string>): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(values)) headers.set(name, value);
  return headers;
}

function okCounter(data: unknown): RateLimitCounter {
  return { rpc: async () => ({ data, error: null }) };
}

describe('extractClientIp', () => {
  it('takes the first x-forwarded-for entry, the client-facing hop', () => {
    expect(
      extractClientIp(headersOf({ 'x-forwarded-for': '203.0.113.7, 70.41.3.18' }))
    ).toBe('203.0.113.7');
  });

  it('prefers x-forwarded-for over cf-connecting-ip', () => {
    expect(
      extractClientIp(
        headersOf({ 'x-forwarded-for': '203.0.113.7', 'cf-connecting-ip': '198.51.100.9' })
      )
    ).toBe('203.0.113.7');
  });

  it('falls back to cf-connecting-ip when there is no forwarded chain', () => {
    expect(extractClientIp(headersOf({ 'cf-connecting-ip': '198.51.100.9' }))).toBe(
      '198.51.100.9'
    );
  });

  it('degrades to the shared unknown bucket instead of bypassing', () => {
    expect(extractClientIp(headersOf({}))).toBe(UNKNOWN_CLIENT_IP);
    expect(extractClientIp(headersOf({ 'x-forwarded-for': '  ' }))).toBe(UNKNOWN_CLIENT_IP);
  });
});

describe('checkRateLimit', () => {
  it('admits a hit the counter allows and forwards the call shape', async () => {
    let seenFn = '';
    let seenArgs: Record<string, unknown> = {};
    const counter: RateLimitCounter = {
      rpc: async (fn, args) => {
        seenFn = fn;
        seenArgs = args;
        return { data: { allowed: true, count: 3, limit: 5 }, error: null };
      },
    };
    const verdict = await checkRateLimit(counter, '203.0.113.7', 5);
    expect(verdict).toEqual({ allowed: true, count: 3 });
    expect(seenFn).toBe('rate_limit_check');
    expect(seenArgs).toEqual({
      p_ip: '203.0.113.7',
      p_limit: 5,
      p_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
    });
  });

  it('marks an overflowing window as limited with the 60 s retry', async () => {
    const verdict = await checkRateLimit(
      okCounter({ allowed: false, count: 6, limit: 5 }),
      '203.0.113.7',
      5
    );
    expect(verdict).toEqual({ allowed: false, limited: true, retryAfterSeconds: 60 });
  });

  it.each([
    ['rpc error', { rpc: async () => ({ data: null, error: new Error('db down') }) }],
    ['thrown transport', { rpc: async () => { throw new Error('timeout'); } }],
    ['malformed answer', okCounter({ allowed: 'yes', count: 1 })],
    ['null answer', okCounter(null)],
  ])('fails closed (never admits blind) on %s', async (_label, counter) => {
    const verdict = await checkRateLimit(counter as RateLimitCounter, '203.0.113.7', 5);
    expect(verdict).toEqual({ allowed: false, limited: false, retryAfterSeconds: 0 });
  });
});

describe('rateLimitResponse', () => {
  it('returns null when the request may proceed', () => {
    expect(rateLimitResponse({ allowed: true, count: 1 }, null, 'POST, OPTIONS')).toBeNull();
  });

  it('answers 429 with the stable code and Retry-After on an overflowing window', async () => {
    const response = rateLimitResponse(
      { allowed: false, limited: true, retryAfterSeconds: 60 },
      null,
      'POST, OPTIONS'
    );
    expect(response).not.toBeNull();
    expect(response!.status).toBe(429);
    expect(response!.headers.get('Retry-After')).toBe('60');
    expect(response!.headers.get('Cache-Control')).toBe('no-store');
    await expect(response!.json()).resolves.toEqual({
      error: { code: 'RATE_LIMITED', message: 'Too many requests', retryable: true },
    });
  });

  it('answers 500 with no Retry-After when the counter is broken', async () => {
    const response = rateLimitResponse(
      { allowed: false, limited: false, retryAfterSeconds: 0 },
      null,
      'POST, OPTIONS'
    );
    expect(response).not.toBeNull();
    expect(response!.status).toBe(500);
    expect(response!.headers.get('Retry-After')).toBeNull();
    await expect(response!.json()).resolves.toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal error', retryable: false },
    });
  });
});
