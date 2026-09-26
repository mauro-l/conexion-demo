-- Apply: phase17_public_fk_indexes
-- Adds covering indexes for foreign keys used by the public booking ledger.
-- The migration was applied to the hosted project before this file was added
-- so the repository now records the exact reproducible operation.
-- Rollback: phase17_public_fk_indexes_rollback.sql.

BEGIN;

CREATE INDEX IF NOT EXISTS bookingidempotency_turno_id_idx
  ON public."BookingIdempotency" (turno_id);

CREATE INDEX IF NOT EXISTS turnotokengestion_turno_id_idx
  ON public."TurnoTokenGestion" (turno_id);

COMMIT;
