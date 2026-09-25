-- Rollback: phase13_public_crear_turno
-- Drops the public_crear_turno RPC and its BookingIdempotency ledger.
-- Dropping the ledger discards replay protection for bookings already recorded.
-- Deliberately CANNOT un-create bookings already written; booking rows are not reversed.

BEGIN;

DROP FUNCTION IF EXISTS public.public_crear_turno(text, text, timestamp, text, text, text, text, text);
DROP TABLE IF EXISTS public."BookingIdempotency";

COMMIT;
