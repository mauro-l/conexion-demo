-- Rollback: phase11_public_availability
-- Reverses phase11_public_availability.sql.
-- Drops only the artifacts phase11 created: public_availability(text, text), the
-- unique index idx_servicio_public_service_token, the
-- Servicio.public_service_token column, and the BloqueoHorario CHECK
-- bloqueohorario_horas_completas.
-- Restores the function phase11 replaced: public_catalog returns to its
-- pre-phase11 four-field definition. The drop-instead-of-restore convention from
-- phase9/phase10 applies to functions those migrations created; phase11 only
-- replaced public_catalog, and the public-catalog Edge Function calls
-- sb.rpc('public_catalog'), so dropping it would break the public catalog.

BEGIN;

-- 1. Remove what phase11 created.
DROP FUNCTION IF EXISTS public.public_availability(text, text);

DROP INDEX IF EXISTS public.idx_servicio_public_service_token;

ALTER TABLE public."Servicio"
  DROP COLUMN IF EXISTS public_service_token;

ALTER TABLE public."BloqueoHorario"
  DROP CONSTRAINT IF EXISTS bloqueohorario_horas_completas;

-- 2. Restore the pre-phase11 public_catalog (no publicServiceToken field).
CREATE OR REPLACE FUNCTION public.public_catalog(p_slug text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'services', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'name', s.nombre,
          'durationMinutes', to_jsonb(s.duracion),
          'price', to_jsonb(s.precio),
          'description', s.descripcion
        ) ORDER BY s.nombre
      ) FILTER (WHERE s.id IS NOT NULL),
      '[]'::jsonb
    )
  )
  INTO v_result
  FROM public."Barberia" b
  JOIN public."Barbero" ba ON ba.barberia_id = b.id AND ba.activo = true
  LEFT JOIN public."Servicio" s ON s.barbero_id = ba.id
  WHERE b.public_slug = p_slug AND b.publicado = true
  GROUP BY b.id;

  IF v_result IS NULL THEN
    RETURN jsonb_build_object(
      'error', jsonb_build_object(
        'code', 'PUBLIC_RESOURCE_NOT_FOUND',
        'message', 'Resource not found',
        'retryable', false
      )
    );
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.public_catalog(text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.public_catalog(text) TO service_role;

COMMIT;
