-- Migration: phase10_public_landing_details
-- Purpose: expose only the public profile and service details needed by the landing.

BEGIN;

ALTER TABLE public."Barberia"
  ADD COLUMN IF NOT EXISTS direccion text,
  ADD COLUMN IF NOT EXISTS horario_publico text,
  ADD COLUMN IF NOT EXISTS whatsapp_url text,
  ADD COLUMN IF NOT EXISTS instagram_handle text,
  ADD COLUMN IF NOT EXISTS instagram_url text;

ALTER TABLE public."Servicio"
  ADD COLUMN IF NOT EXISTS descripcion text;

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
      'description', coalesce(b.description, ''),
      'address', b.direccion,
      'hours', b.horario_publico,
      'whatsappUrl', b.whatsapp_url,
      'instagramHandle', b.instagram_handle,
      'instagramUrl', b.instagram_url
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
    ON ba.barberia_id = b.id AND ba.activo = true
  WHERE b.public_slug = p_slug AND b.publicado = true
  GROUP BY b.id, b.nombre, b.description, b.direccion, b.horario_publico,
    b.whatsapp_url, b.instagram_handle, b.instagram_url;

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

REVOKE EXECUTE ON FUNCTION public.public_context(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_context(text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.public_catalog(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_catalog(text) TO service_role;

COMMIT;
