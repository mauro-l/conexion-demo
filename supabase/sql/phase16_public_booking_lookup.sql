-- Migration: phase16_public_booking_lookup
-- Purpose: re-establish access to a booking the visitor can no longer reach,
--          because the management token is stored only as a SHA-256 hash and
--          the original can never be recovered. Recognition comes from the
--          identity the visitor gave when booking; a fresh token is minted for
--          that booking. See odd/tasks/booking-lookup.md for the accepted,
--          explicit weakening of the token-only model.
-- Dependency: REQUIRES phase15_public_cancellation (this file inserts into
--             "TurnoTokenGestion" and mirrors its expiry rule and DTO).
-- Safety: SECURITY INVOKER and executable by service_role only. Postgres
--         receives only a token hash; the returned DTO carries no customer PII.
-- Rollback: phase16_public_booking_lookup_rollback.sql.

BEGIN;

CREATE OR REPLACE FUNCTION public.public_recuperar_turno(
  p_slug       text,
  p_nombre     text,
  p_apellido   text,
  p_telefono   text,
  p_token_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_barberia_id bigint;
  v_rec         record;
  v_dur         smallint;
  v_can_cancel  boolean;
BEGIN
  -- 1. Validate every client-controlled value. The trimmed name bounds are the
  --    same ones `public_crear_turno` enforces, so the lookup accepts exactly
  --    what the write stored. The slug and hash patterns are copied from the
  --    other public RPCs so a malformed value can never reach a query.
  IF p_slug IS NULL
     OR p_slug !~ '^[a-z0-9-]{1,63}$'
     OR p_nombre IS NULL
     OR p_apellido IS NULL
     OR char_length(trim(p_nombre)) < 2
     OR char_length(trim(p_nombre)) > 80
     OR char_length(trim(p_apellido)) < 2
     OR char_length(trim(p_apellido)) > 80
     OR p_telefono IS NULL
     OR p_telefono !~ '^\+549(11[0-9]{8}|[23][0-9]{9})$'
     OR p_token_hash IS NULL
     OR p_token_hash !~ '^[a-f0-9]{64}$'
  THEN
    RETURN jsonb_build_object(
      'error', jsonb_build_object(
        'code', 'INVALID_INPUT',
        'message', 'Invalid input',
        'retryable', false
      )
    );
  END IF;

  -- 2. Resolve the shop. An unknown or unpublished slug is indistinguishable
  --    from a booking that was not found: both answer with the one generic
  --    PUBLIC_RESOURCE_NOT_FOUND, so the endpoint is not a slug oracle.
  SELECT b.id INTO v_barberia_id
  FROM public."Barberia" b
  WHERE b.public_slug = p_slug
    AND b.publicado = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'error', jsonb_build_object(
        'code', 'PUBLIC_RESOURCE_NOT_FOUND',
        'message', 'Resource not found',
        'retryable', false
      )
    );
  END IF;

  -- 3. Pick the nearest upcoming booking that matches identity.
  --    `public_crear_turno` stores `Cliente.nombre` as exactly
  --    `trim(nombre) || ' ' || trim(apellido)`, so comparing the lowercased,
  --    trimmed full name is the faithful inverse of the write. `Turno.inicio`
  --    is `timestamp without time zone`, so the local clock is the only
  --    correct "now" for the upcoming test — comparing against server `now()`
  --    would shift the boundary by the timezone offset.
  SELECT t.id AS turno_id, t.inicio, t.estado, t.origen, t.duracion_minutos,
         s.duracion, s.precio, s.nombre AS service_name,
         ba.nombre AS barber_name, b.nombre AS shop_name
    INTO v_rec
  FROM public."Turno" t
  JOIN public."Cliente" c ON c.id = t.cliente_id
  JOIN public."Servicio" s ON s.id = t.servicio_id
  JOIN public."Barbero" ba ON ba.id = t.barbero_id
  JOIN public."Barberia" b ON b.id = ba.barberia_id
  WHERE c.barberia_id = v_barberia_id
    AND lower(btrim(c.nombre)) = lower(btrim(p_nombre) || ' ' || btrim(p_apellido))
    AND c.telefono_normalizado = p_telefono
    AND t.estado IN ('pendiente', 'confirmado')
    AND t.inicio >= (clock_timestamp() AT TIME ZONE 'America/Argentina/Buenos_Aires')
  ORDER BY t.inicio
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'error', jsonb_build_object(
        'code', 'PUBLIC_RESOURCE_NOT_FOUND',
        'message', 'Resource not found',
        'retryable', false
      )
    );
  END IF;

  -- 4. Mint a fresh management token for the recovered booking. Same lifetime
  --    rule as phase15: the token dies when the booking starts. `AT TIME ZONE`
  --    converts the naive local `inicio` into the timestamptz `expires_at`.
  INSERT INTO public."TurnoTokenGestion" (turno_id, token_hash, tipo, expires_at)
  VALUES (v_rec.turno_id, p_token_hash, 'gestion',
          v_rec.inicio AT TIME ZONE 'America/Argentina/Buenos_Aires');

  -- 5. Return the same 10-field management DTO `public_gestionar_turno` uses,
  --    with no customer name, phone, email or internal identifier.
  v_dur := coalesce(v_rec.duracion_minutos, round(v_rec.duracion))::smallint;
  v_can_cancel := v_rec.estado IN ('pendiente', 'confirmado')
    AND v_rec.inicio >= (clock_timestamp() AT TIME ZONE 'America/Argentina/Buenos_Aires')
      + interval '5 minutes';

  RETURN jsonb_build_object(
    'booking', jsonb_build_object(
      'start', to_char(v_rec.inicio, 'YYYY-MM-DD"T"HH24:MI:SS'),
      'end', to_char(v_rec.inicio + (v_dur * interval '1 minute'), 'YYYY-MM-DD"T"HH24:MI:SS'),
      'durationMinutes', v_dur,
      'price', v_rec.precio,
      'status', v_rec.estado,
      'origin', v_rec.origen,
      'serviceName', v_rec.service_name,
      'barberName', v_rec.barber_name,
      'shopName', v_rec.shop_name,
      'canCancel', v_can_cancel
    ),
    'managementTokenRegistered', true
  );
END;
$$;

-- 6. Keep the lookup server-side only: the Next route calls the Edge with the
--    service role, and neither anon nor authenticated may invoke the RPC.
REVOKE EXECUTE ON FUNCTION public.public_recuperar_turno(text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_recuperar_turno(text, text, text, text, text)
  TO service_role;

-- Read-only probe: the lookup must be executable only by service_role.
SELECT p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS args,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'public_recuperar_turno'
ORDER BY p.proname;

-- Read-only probe: the lookup writes management-token rows, so the same table
-- privilege contract as phase15 is reasserted here.
SELECT 'TurnoTokenGestion' AS table_name,
       has_table_privilege('anon', 'public."TurnoTokenGestion"', 'SELECT') AS anon_can_select,
       has_table_privilege('authenticated', 'public."TurnoTokenGestion"', 'SELECT') AS authenticated_can_select,
       has_table_privilege('service_role', 'public."TurnoTokenGestion"', 'SELECT') AS service_role_can_select;

COMMIT;
