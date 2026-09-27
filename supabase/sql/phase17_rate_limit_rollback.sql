-- Rollback: phase17_rate_limit
-- Drops the counter RPC and table. The table holds only ephemeral
-- per-IP window counts (no business data), so dropping it loses nothing
-- the next window would not rebuild. No anon/authenticated grants are
-- reopened.

BEGIN;

DROP FUNCTION IF EXISTS public.rate_limit_check(text, integer, integer);
DROP TABLE IF EXISTS public.rate_limit;

COMMIT;
