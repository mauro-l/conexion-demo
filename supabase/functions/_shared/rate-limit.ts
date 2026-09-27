import { errorResponse } from './http.ts';

/**
 * Edge rate-limit (freno 1 — velocidad): fixed-window per-IP counter shared
 * by the three anonymous public functions.
 *
 * The module is runtime-agnostic on purpose — no `Deno` reference — so the
 * same code runs under Vitest on Node (see `rate-limit.test.ts`). It uses
 * only cross-runtime globals (`Headers`, `Response`).
 *
 * Fail-closed contract: any counter failure (RPC error, thrown transport,
 * malformed answer, misconfigured client) yields `allowed: false` with
 * `limited: false`, and the caller must answer 500 — never let the request
 * through blind. Only a counter answer that explicitly overflows the limit
 * yields `limited: true`, answered with 429 + `Retry-After`.
 */

/** Seconds in a fixed window. Thresholds change per function; the window does not. */
export const RATE_LIMIT_WINDOW_SECONDS = 60;

/** Header carrying the window length on every 429, so clients know when to retry. */
export const RETRY_AFTER_SECONDS = RATE_LIMIT_WINDOW_SECONDS;

/** Code the browser keys its backoff on; stable like every other Edge code. */
export const RATE_LIMITED_CODE = 'RATE_LIMITED';

/** The `unknown` bucket: requests with no forwarding header share one budget. */
export const UNKNOWN_CLIENT_IP = 'unknown';

export type RateLimitVerdict =
  | { allowed: true; count: number }
  | { allowed: false; limited: boolean; retryAfterSeconds: number };

/** Minimal shape of the counter caller: structurally satisfied by supabase-js. */
export interface RateLimitCounter {
  rpc(
    fn: string,
    args: Record<string, unknown>
  ): Promise<{ data: unknown; error: unknown }>;
}

/**
 * Client IP for the counter bucket. Trusts `x-forwarded-for` (first entry,
 * the client-facing hop set by the platform proxy) then `cf-connecting-ip`.
 * With neither header the request still gets a bucket — `unknown` — shared
 * by all headerless callers, so a missing header throttles instead of
 * bypassing. Never throws: an unparsable header degrades to `unknown`.
 */
export function extractClientIp(headers: Headers): string {
  const firstForwarded = (headers.get('x-forwarded-for') ?? '').split(',')[0].trim();
  if (firstForwarded !== '') return firstForwarded.slice(0, 64);
  const connectingIp = (headers.get('cf-connecting-ip') ?? '').trim();
  if (connectingIp !== '') return connectingIp.slice(0, 64);
  return UNKNOWN_CLIENT_IP;
}

function parseCounterAnswer(data: unknown): { count: number; allowed: boolean } | null {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
  const payload = data as Record<string, unknown>;
  if (typeof payload.count !== 'number' || !Number.isInteger(payload.count)) return null;
  if (typeof payload.allowed !== 'boolean') return null;
  return { count: payload.count, allowed: payload.allowed };
}

/**
 * One fixed-window hit against `rate_limit_check`. `limit` is the hits the
 * window admits (booking 5, lookup 10, availability 60). Any failure rejects
 * with `limited: false` — the caller answers 500, never admits blind.
 */
export async function checkRateLimit(
  counter: RateLimitCounter,
  ip: string,
  limit: number
): Promise<RateLimitVerdict> {
  const rejected: RateLimitVerdict = {
    allowed: false,
    limited: false,
    retryAfterSeconds: 0,
  };
  try {
    const { data, error } = await counter.rpc('rate_limit_check', {
      p_ip: ip,
      p_limit: limit,
      p_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
    });
    if (error) return rejected;
    const answer = parseCounterAnswer(data);
    if (!answer) return rejected;
    if (answer.allowed) return { allowed: true, count: answer.count };
    return { allowed: false, limited: true, retryAfterSeconds: RETRY_AFTER_SECONDS };
  } catch {
    return rejected;
  }
}

/**
 * Maps a denying verdict to its HTTP answer, or `null` when the request may
 * proceed. Over-limit is 429 (`retryable: true` — the client may retry once
 * the window lapses) with `Retry-After`; a broken counter is 500 with no
 * `Retry-After`, because there is no window to wait for.
 */
export function rateLimitResponse(
  verdict: RateLimitVerdict,
  origin: string | null,
  methods: string
): Response | null {
  if (verdict.allowed) return null;
  if (!verdict.limited) {
    return errorResponse('INTERNAL_ERROR', 'Internal error', 500, false, origin, true, methods);
  }
  const response = errorResponse(
    RATE_LIMITED_CODE,
    'Too many requests',
    429,
    true,
    origin,
    true,
    methods
  );
  response.headers.set('Retry-After', String(verdict.retryAfterSeconds));
  return response;
}
