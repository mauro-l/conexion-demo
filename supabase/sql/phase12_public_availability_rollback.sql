-- Rollback: phase12_public_availability
-- Reverses phase12_public_availability.sql only. Drops the
-- public_availability(text, text) RPC and the BloqueoHorario CHECK
-- bloqueohorario_horas_completas.
-- Deliberately does NOT touch public_catalog or the
-- Servicio.public_service_token column; those belong to
-- phase11_public_service_token_rollback.
-- Rollback order is the reverse of apply order: run this before
-- phase11_public_service_token_rollback.

BEGIN;

-- 1. Remove what this phase created.
DROP FUNCTION IF EXISTS public.public_availability(text, text);

ALTER TABLE public."BloqueoHorario"
  DROP CONSTRAINT IF EXISTS bloqueohorario_horas_completas;

COMMIT;
