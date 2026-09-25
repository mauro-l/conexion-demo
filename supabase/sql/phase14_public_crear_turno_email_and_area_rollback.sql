-- Rollback: phase14_public_crear_turno_email_and_area
-- Reverses phase14 only. Drops the nine-argument booking RPC and restores the
-- area allow-list this phase widened.
--
-- The eight-argument version phase14 replaced is deliberately NOT restated here.
-- Duplicating its ~280-line body would create a second copy that can drift from
-- the one under version control. Re-running `phase13_public_crear_turno.sql`
-- recreates it exactly, and that file is idempotent: CREATE TABLE IF NOT EXISTS,
-- CREATE OR REPLACE FUNCTION, and a catalog-resolved sequence revoke.
--
-- Rollback order is the reverse of apply order: this file first, then phase13's.
-- That is why this one must not touch `"BookingIdempotency"` — phase13 owns it.

BEGIN;

DROP FUNCTION IF EXISTS public.public_crear_turno(text, text, timestamp, text, text, text, text, text, text);

UPDATE public."Barberia"
   SET codigos_area_permitidos = ARRAY['11']
 WHERE public_slug = 'conexion-barberia'
   AND publicado = true;

COMMIT;
