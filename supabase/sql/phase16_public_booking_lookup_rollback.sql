-- Rollback: phase16_public_booking_lookup
-- Drops the lookup RPC. It created no table, no column and no sequence, so
-- nothing else was added to undo. No anon/authenticated grants are reopened.

BEGIN;

DROP FUNCTION IF EXISTS public.public_recuperar_turno(text, text, text, text, text);

COMMIT;
