-- Migration: phase9_public_barberia_discovery
-- Target project: vcgyiyrboumimwgdsitf
-- Purpose: Add public discovery columns to Barberia and create narrow RPCs
--          public_context / public_catalog, executable only by service_role.
-- Safety: additive DDL only; no existing RLS policy or table grant is changed.
--         anon receives no table or function grants.

BEGIN;

-- 1. Public discovery columns on Barberia.
ALTER TABLE public."Barberia"
  ADD COLUMN IF NOT EXISTS public_slug text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS publicado boolean NOT NULL DEFAULT false;

-- Enforce uniqueness of public_slug (multiple NULLs are allowed).
CREATE UNIQUE INDEX IF NOT EXISTS idx_barberia_public_slug_unique
  ON public."Barberia"(public_slug);

-- 2. RPC: resolve a published barbershop and its active barbers.
--    Returns { barberia: { name, description }, barbers: [...] }.
--    Unknown slug and unpublished slug return the identical not-found body.
CREATE OR REPLACE FUNCTION public.public_context(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'barberia', jsonb_build_object(
      'name', b.nombre,
      'description', coalesce(b.description, '')
    ),
    'barbers', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'name', ba.nombre,
          'alias', to_jsonb(ba.alias),
          'description', coalesce(ba.descripcion, ''),
          'photoUrl', to_jsonb(ba.foto_url)
        )
        ORDER BY ba.nombre
      ) FILTER (WHERE ba.id IS NOT NULL),
      '[]'::jsonb
    )
  )
  INTO v_result
  FROM public."Barberia" b
  LEFT JOIN public."Barbero" ba
    ON ba.barberia_id = b.id
   AND ba.activo = true
  WHERE b.public_slug = p_slug
    AND b.publicado = true
  GROUP BY b.id, b.nombre, b.description;

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

-- 3. RPC: resolve the catalog of services for a published barbershop.
--    Returns { services: [ { name, durationMinutes, price } ] }.
--    durationMinutes and price are projected as JSON numbers from numeric columns.
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
          'name', s.nombre,
          'durationMinutes', to_jsonb(s.duracion),
          'price', to_jsonb(s.precio)
        )
        ORDER BY s.nombre
      ) FILTER (WHERE s.id IS NOT NULL),
      '[]'::jsonb
    )
  )
  INTO v_result
  FROM public."Barberia" b
  JOIN public."Barbero" ba
    ON ba.barberia_id = b.id
   AND ba.activo = true
  LEFT JOIN public."Servicio" s
    ON s.barbero_id = ba.id
  WHERE b.public_slug = p_slug
    AND b.publicado = true
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

-- 4. Lock down RPC execution: only service_role (server-side Edge Functions) may invoke.
REVOKE EXECUTE ON FUNCTION public.public_context(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_context(text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.public_catalog(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_catalog(text) TO service_role;

COMMIT;
