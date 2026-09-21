-- Rollback: phase10_public_landing_details

BEGIN;

DROP FUNCTION IF EXISTS public.public_context(text);
DROP FUNCTION IF EXISTS public.public_catalog(text);

ALTER TABLE public."Barberia"
  DROP COLUMN IF EXISTS direccion,
  DROP COLUMN IF EXISTS horario_publico,
  DROP COLUMN IF EXISTS whatsapp_url,
  DROP COLUMN IF EXISTS instagram_handle,
  DROP COLUMN IF EXISTS instagram_url;

ALTER TABLE public."Servicio"
  DROP COLUMN IF EXISTS descripcion;

COMMIT;
