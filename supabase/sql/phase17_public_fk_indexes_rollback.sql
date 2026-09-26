-- Rollback: phase17_public_fk_indexes

BEGIN;

DROP INDEX IF EXISTS public.bookingidempotency_turno_id_idx;
DROP INDEX IF EXISTS public.turnotokengestion_turno_id_idx;

COMMIT;
