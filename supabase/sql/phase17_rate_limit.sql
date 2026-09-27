-- Migration: phase17_rate_limit
-- Purpose: fixed-window per-IP counter (freno 1 — velocidad) for the three
--          anonymous public Edge Functions (`public-booking`,
--          `public-booking-lookup`, `public-availability`), so one IP cannot
--          burst dozens of bookings in seconds and burn the free quota.
--          See odd/tasks/rate-limit.md for thresholds (booking 5/min, lookup
--          10/min, availability 60/min, 60 s fixed windows).
-- Design: plain Postgres table first — free inside the free tier, no new
--         accounts. Migrate to Upstash only past ~10k req/day, keeping the
--         same `checkRateLimit` interface. The Edge never reads this table
--         directly: it calls `rate_limit_check`, which upserts and answers in
--         one round trip, and opportunistically deletes expired windows so the
--         table stays at most two windows deep per active IP.
-- Safety: SECURITY INVOKER and executable by service_role only (the Edge
--         calls with the service key). anon/authenticated get no access to
--         the table or the RPC, so the counter cannot be read or reset from
--         the browser.
-- Rollback: phase17_rate_limit_rollback.sql.

BEGIN;

CREATE TABLE IF NOT EXISTS public.rate_limit (
  ip text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 1 CHECK (count >= 1),
  CONSTRAINT rate_limit_pkey PRIMARY KEY (ip, window_start)
);

CREATE OR REPLACE FUNCTION public.rate_limit_check(
  p_ip text,
  p_limit integer,
  p_window_seconds integer DEFAULT 60
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_window timestamptz;
  v_count integer;
  v_allowed boolean;
  v_retry_after integer;
BEGIN
  -- 1. Fail closed on nonsense input: a caller bug must reject, never grant
  --    an unbounded bucket. The Edge maps any exception to a 500.
  IF p_ip IS NULL
     OR char_length(p_ip) < 1
     OR char_length(p_ip) > 64
     OR p_limit IS NULL
     OR p_limit < 1
     OR p_window_seconds IS NULL
     OR p_window_seconds < 1
     OR p_window_seconds > 3600
  THEN
    RAISE EXCEPTION 'INVALID_INPUT: rate_limit_check arguments out of range'
      USING ERRCODE = '22023';
  END IF;

  -- 2. Fixed window anchored on the Unix epoch, so every caller shares the
  --    same boundaries without coordination.
  v_window := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds)
    * p_window_seconds
  );

  -- 3. Opportunistic cleanup: drop windows older than the previous one. The
  --    table never holds more than two windows per active IP.
  DELETE FROM public.rate_limit
  WHERE window_start < v_window - make_interval(secs => p_window_seconds);

  -- 4. Count this hit atomically: one UPSERT, one round trip from the Edge.
  INSERT INTO public.rate_limit (ip, window_start, count)
  VALUES (p_ip, v_window, 1)
  ON CONFLICT (ip, window_start)
  DO UPDATE SET count = public.rate_limit.count + 1
  RETURNING public.rate_limit.count INTO v_count;

  -- 5. The first `p_limit` hits in a window pass; the rest wait for the next
  --    window. `retry_after` is the seconds left in the current window.
  v_allowed := v_count <= p_limit;
  IF v_allowed THEN
    v_retry_after := 0;
  ELSE
    v_retry_after := p_window_seconds
      - (floor(extract(epoch from clock_timestamp()))::integer % p_window_seconds);
  END IF;

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'count', v_count,
    'limit', p_limit,
    'retry_after_seconds', v_retry_after
  );
END;
$$;

-- 6. Keep the counter server-side only: the Edge calls with the service key,
--    and neither anon nor authenticated may invoke the RPC or touch the table.
REVOKE ALL ON TABLE public.rate_limit FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rate_limit_check(text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_limit_check(text, integer, integer)
  TO service_role;

-- Read-only probe: the counter RPC must be executable only by service_role.
SELECT p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS args,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'rate_limit_check'
ORDER BY p.proname;

COMMIT;
