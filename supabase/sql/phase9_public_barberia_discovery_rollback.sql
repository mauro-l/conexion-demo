-- Rollback: phase9_public_barberia_discovery_rollback
-- Reverses phase9_public_barberia_discovery.sql.
-- Safe: drops only the artifacts created by that migration.

BEGIN;

DROP FUNCTION IF EXISTS public.public_context(text);
DROP FUNCTION IF EXISTS public.public_catalog(text);

ALTER TABLE public."Barberia"
  DROP COLUMN IF EXISTS publicado,
  DROP COLUMN IF EXISTS description,
  DROP COLUMN IF EXISTS public_slug;

COMMIT;
