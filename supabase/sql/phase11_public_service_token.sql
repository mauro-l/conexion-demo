-- Migration: phase11_public_service_token
-- Purpose: add the opaque public service token to Servicio and expose it as
--          publicServiceToken in the public_catalog DTO, so the catalog can
--          resolve services without leaking internal ids.
-- Scope: token infrastructure + catalog DTO only. This migration deliberately
--        does NOT create public_availability, the BloqueoHorario CHECK, or any
--        availability grant; those live in phase12_public_availability.
-- Safety: additive DDL only; anon receives no table or function grants, and the
--         catalog RPC stays executable by service_role only.

BEGIN;

-- 1. Opaque public service token: random, non-NULL, unique, never an internal id.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public."Servicio"
  ADD COLUMN IF NOT EXISTS public_service_token text;

-- Backfill existing rows once, then let new rows default to a fresh random value.
UPDATE public."Servicio"
  SET public_service_token = encode(gen_random_bytes(16), 'hex')
  WHERE public_service_token IS NULL;

ALTER TABLE public."Servicio"
  ALTER COLUMN public_service_token
    SET DEFAULT encode(gen_random_bytes(16), 'hex'),
  ALTER COLUMN public_service_token SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_servicio_public_service_token
  ON public."Servicio" (public_service_token);

-- 2. Catalog DTO gains publicServiceToken. Resolution stays database-authoritative
--    through the published shop's active barbers; no internal ids are exposed.
CREATE OR REPLACE FUNCTION public.public_catalog(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'services', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'publicServiceToken', s.public_service_token,
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

-- 3. Lock down catalog RPC execution: only service_role (server-side Edge Functions) may invoke.
REVOKE EXECUTE ON FUNCTION public.public_catalog(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_catalog(text) TO service_role;

-- 4. Read-only probe (no schema effect): the effective grants must show
--    service_role = true and anon/authenticated = false for the catalog RPC.
SELECT p.proname AS function_name,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'public_catalog'
ORDER BY p.proname;

COMMIT;
