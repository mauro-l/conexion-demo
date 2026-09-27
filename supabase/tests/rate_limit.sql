-- pgTAP integration battery for public.rate_limit_check (ODD rate-limit RL-4).
--
-- Run from the repository root:
--   npm run test:db -- supabase/tests/rate_limit.sql
--
-- The target database must already carry the phase17_rate_limit migration.
-- The whole battery runs in a single transaction that is rolled back at the
-- end, so it never mutates ambient rows: every counter row is fixture data
-- created here and discarded with the rollback.
--
-- Determinism: windows are anchored on the Unix epoch by the RPC itself, so
-- no assertion depends on the wall clock — five hits from one IP pass, the
-- sixth is denied, and a second IP is unaffected. The fail-closed case (an
-- out-of-range limit raising instead of granting) is pinned with throws_ok.

begin;
\set ON_ERROR_STOP on

select plan(10);

-- 1. Five hits from one IP pass with the running count echoed back.
select is((public.rate_limit_check('198.51.100.7', 5)->>'allowed')::boolean, true,
          'window: hit 1 of 5 is allowed');
select is((public.rate_limit_check('198.51.100.7', 5)->>'allowed')::boolean, true,
          'window: hit 2 of 5 is allowed');
select is((public.rate_limit_check('198.51.100.7', 5)->>'allowed')::boolean, true,
          'window: hit 3 of 5 is allowed');
select is((public.rate_limit_check('198.51.100.7', 5)->>'allowed')::boolean, true,
          'window: hit 4 of 5 is allowed');
select is((public.rate_limit_check('198.51.100.7', 5)->>'count')::int, 5,
          'window: hit 5 of 5 is allowed and counted');

-- 2. The sixth hit in the same window is denied with a positive retry.
select is((public.rate_limit_check('198.51.100.7', 5)->>'allowed')::boolean, false,
          'window: hit 6 of 5 is denied');
select ok((public.rate_limit_check('198.51.100.7', 5)->>'retry_after_seconds')::int > 0,
          'window: the denial carries a positive retry_after_seconds');

-- 3. Buckets are per IP: a second IP starts its own window.
select is((public.rate_limit_check('203.0.113.9', 5)->>'allowed')::boolean, true,
          'isolation: a second IP is unaffected by the first bucket');

-- 4. Fail closed: nonsense input raises instead of granting a bucket.
select throws_ok($$select public.rate_limit_check('198.51.100.7', 0)$$,
                 '22023', null, 'fail-closed: a zero limit raises');
select throws_ok($$select public.rate_limit_check('198.51.100.7', 5, 0)$$,
                 '22023', null, 'fail-closed: a zero window raises');

select * from finish();
rollback;
