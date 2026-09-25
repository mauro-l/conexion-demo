-- Migration: phase14_public_crear_turno_email_and_area
-- Purpose: two additions to the public booking path, both owned by the server:
--          1. `p_email` on the booking RPC, with dedupe by (barberia_id, email).
--          2. the commercial area rule, enforced server-side against
--             `Barberia.codigos_area_permitidos`, plus the allow-list value for
--             the published shop.
-- Dependency: REQUIRES phase13_public_crear_turno (this file replaces the
--             function phase13 created), phase12_public_availability and
--             phase11_public_service_token.
-- Safety: the function stays SECURITY INVOKER and executable by service_role
--         only, and still returns no internal identifiers. The new email
--         parameter is required, matching the prototype's `required` email
--         input.
-- Rollback: phase14_public_crear_turno_email_and_area_rollback.sql.

BEGIN;

-- 1. Area allow-list for the published shop.
--    The form must not reject a customer the shop can actually serve. The
--    default is `{11}` (AMBA only), which would silently refuse La Plata and
--    everything outside Greater Buenos Aires. `areaPermitida` is a prefix match
--    against the canonical phone, so these values are compared as `+549` || area
--    prefixes. Adding a city later is one UPDATE, no deploy.
UPDATE public."Barberia"
   SET codigos_area_permitidos = ARRAY['11', '221']
 WHERE public_slug = 'conexion-barberia'
   AND publicado = true;

-- 2. Replace the booking RPC.
--    A new parameter cannot be added with CREATE OR REPLACE: it would leave the
--    eight-argument version in place as an overload and PostgREST would answer
--    PGRST203 for every call. The old signature has to be dropped explicitly.
DROP FUNCTION IF EXISTS public.public_crear_turno(text, text, timestamp, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.public_crear_turno(
  p_slug            text,
  p_service_token   text,
  p_inicio          timestamp,
  p_nombre          text,
  p_apellido        text,
  p_telefono        text,
  p_telefono_raw    text,
  p_email           text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Buenos Aires local clock anchors.
  v_now           timestamp;
  v_today         date;
  v_dow           integer;
  v_rec           record;
  v_duracion_min  smallint;
  v_duracion      numeric;
  v_eff_open      time;
  v_eff_close     time;
  v_cliente_id    bigint;
  v_customer_name text;
  v_email         text;
  v_area_ok       boolean;
  v_payload_hash  text;
  v_claim_id      bigint;
  v_prev_hash     text;
  v_prev_response jsonb;
  v_response      jsonb;
  -- Anti-overlap constraint shape, discovered from the catalog, never assumed.
  v_xcount        integer;
  v_xdef          text;
BEGIN
  -- 2.1 Resolve the shop, service, and its active barber in one query. The area
  --     allow-list travels with the shop so the rule below reads configuration,
  --     not a hardcoded list.
  SELECT b.id AS barberia_id,
         b.nombre AS barberia_nombre,
         b.dias_habiles AS barberia_dias,
         b.hora_apertura AS barberia_apertura,
         b.hora_cierre AS barberia_cierre,
         b.codigos_area_permitidos AS barberia_areas,
         ba.id AS barbero_id,
         ba.nombre AS barbero_nombre,
         ba.dias_habiles AS barbero_dias,
         ba.hora_apertura AS barbero_apertura,
         ba.hora_cierre AS barbero_cierre,
         s.id AS servicio_id,
         s.nombre AS servicio_nombre,
         s.duracion AS servicio_duracion,
         s.precio AS servicio_precio
    INTO v_rec
  FROM public."Servicio" s
  JOIN public."Barbero" ba ON ba.id = s.barbero_id AND ba.activo = true
  JOIN public."Barberia" b ON b.id = ba.barberia_id
  WHERE b.public_slug = p_slug
    AND b.publicado = true
    AND s.public_service_token = p_service_token;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'error', jsonb_build_object(
        'code', 'PUBLIC_RESOURCE_NOT_FOUND',
        'message', 'Resource not found',
        'retryable', false
      )
    );
  END IF;

  -- 2.2 Normalize the email before validating it: the dedupe identity is the
  --     lowercased value, so `Foo@Mail.com` and `foo@mail.com` must not create
  --     two customers.
  v_email := lower(btrim(coalesce(p_email, '')));

  -- 2.3 Validate all client-controlled values before using them.
  IF p_nombre IS NULL
     OR p_apellido IS NULL
     OR char_length(trim(p_nombre)) < 2
     OR char_length(trim(p_apellido)) < 2
     OR p_inicio IS NULL
     OR p_telefono IS NULL
     OR p_telefono !~ '^\+549(11[0-9]{8}|[23][0-9]{9})$'
     OR p_idempotency_key IS NULL
     OR char_length(btrim(p_idempotency_key)) = 0
     OR char_length(p_idempotency_key) > 255
     OR char_length(v_email) = 0
     OR char_length(v_email) > 254
     OR v_email !~ '^[^@]+@[^@]+\.[^@]+$'
     OR v_email ~ '\s'
  THEN
    RETURN jsonb_build_object(
      'error', jsonb_build_object(
        'code', 'INVALID_INPUT',
        'message', 'Invalid input',
        'retryable', false
      )
    );
  END IF;

  -- 2.4 Commercial area rule, mirrored from `areaPermitida` in lib/telefono.ts:
  --     the canonical phone must start with `+549` plus one of the allowed
  --     areas. A prefix match rather than a parsed area keeps the two
  --     implementations identical — note that a short configured area also
  --     accepts longer areas starting the same way, which for AMBA (`11`) cannot
  --     overlap anything else. Enforced here because the form's copy of this
  --     rule is a UX hint, never the authority.
  SELECT EXISTS (
           SELECT 1
           FROM unnest(coalesce(v_rec.barberia_areas, ARRAY[]::text[])) AS a
           WHERE p_telefono LIKE '+549' || a || '%'
         )
    INTO v_area_ok;

  IF NOT v_area_ok THEN
    RETURN jsonb_build_object(
      'error', jsonb_build_object(
        'code', 'AREA_NOT_ALLOWED',
        'message', 'Phone area is not served by this shop',
        'retryable', false
      )
    );
  END IF;

  -- 2.5 A service or barber with incomplete schedule data is not bookable.
  IF v_rec.servicio_duracion IS NULL
     OR v_rec.barberia_apertura IS NULL
     OR v_rec.barberia_cierre IS NULL
     OR v_rec.barbero_apertura IS NULL
     OR v_rec.barbero_cierre IS NULL
     OR v_rec.barbero_dias IS NULL
     OR v_rec.barberia_dias IS NULL
  THEN
    RETURN jsonb_build_object(
      'error', jsonb_build_object(
        'code', 'SERVICE_NOT_BOOKABLE',
        'message', 'Service is not bookable',
        'retryable', false
      )
    );
  END IF;

  v_duracion_min := GREATEST(1, LEAST(480, round(v_rec.servicio_duracion)))::smallint;
  v_duracion := v_duracion_min::numeric;

  -- 2.6 Enforce the local lead-time and 14-day window using PostgreSQL time.
  v_now := clock_timestamp() AT TIME ZONE 'America/Argentina/Buenos_Aires';
  v_today := v_now::date;

  IF p_inicio < v_now + interval '30 minutes'
     OR p_inicio::date < v_today
  THEN
    RETURN jsonb_build_object(
      'error', jsonb_build_object(
        'code', 'PAST_START',
        'message', 'Start time is in the past',
        'retryable', false
      )
    );
  END IF;

  IF p_inicio::date >= v_today + 14 THEN
    RETURN jsonb_build_object(
      'error', jsonb_build_object(
        'code', 'OUTSIDE_WORKING_HOURS',
        'message', 'Start time is outside working hours',
        'retryable', false
      )
    );
  END IF;

  -- 2.7 Both the barber and shop must work on the requested local weekday.
  v_dow := extract(dow FROM p_inicio)::int;
  IF NOT (v_dow = ANY (v_rec.barbero_dias)
          AND v_dow = ANY (v_rec.barberia_dias))
  THEN
    RETURN jsonb_build_object(
      'error', jsonb_build_object(
        'code', 'OUTSIDE_WORKING_HOURS',
        'message', 'Start time is outside working hours',
        'retryable', false
      )
    );
  END IF;

  -- 2.8 Revalidate effective hours and the real-slot grid.
  v_eff_open := greatest(v_rec.barberia_apertura, v_rec.barbero_apertura);
  v_eff_close := least(v_rec.barberia_cierre, v_rec.barbero_cierre);

  IF v_eff_open >= v_eff_close THEN
    RETURN jsonb_build_object(
      'error', jsonb_build_object(
        'code', 'OUTSIDE_WORKING_HOURS',
        'message', 'Start time is outside working hours',
        'retryable', false
      )
    );
  END IF;

  IF p_inicio < (p_inicio::date + v_eff_open)
     OR mod(extract(epoch FROM (p_inicio - (p_inicio::date + v_eff_open))), 1800) <> 0
     OR p_inicio + (v_duracion * interval '1 minute') > (p_inicio::date + v_eff_close)
  THEN
    RETURN jsonb_build_object(
      'error', jsonb_build_object(
        'code', 'OUTSIDE_WORKING_HOURS',
        'message', 'Start time is outside working hours',
        'retryable', false
      )
    );
  END IF;

  -- 2.9 Exclude full-day, overlapping partial, and half-defined blocks.
  --     The final branch fails closed as defense in depth even though the
  --     phase12 CHECK makes a half-defined row unrepresentable.
  IF EXISTS (
    SELECT 1 FROM public."BloqueoHorario" bl
    WHERE bl.barbero_id = v_rec.barbero_id
      AND bl.fecha = p_inicio::date
      AND (
        (bl.hora_inicio IS NULL AND bl.hora_fin IS NULL)
        OR (bl.hora_inicio IS NOT NULL AND bl.hora_fin IS NOT NULL
            AND tsrange(p_inicio::date + bl.hora_inicio, p_inicio::date + bl.hora_fin, '[)')
                && tsrange(p_inicio, p_inicio + (v_duracion * interval '1 minute'), '[)'))
        OR ((bl.hora_inicio IS NULL) <> (bl.hora_fin IS NULL))
      )
  ) THEN
    RETURN jsonb_build_object(
      'error', jsonb_build_object(
        'code', 'BLOCKED_SLOT',
        'message', 'Start time is blocked',
        'retryable', false
      )
    );
  END IF;

  -- 2.10 Verify the anti-overlap constraint is present and still covers the state
  --      this RPC writes. turno_sin_solape is the final authority against
  --      concurrent bookings, so a missing or weakened constraint must fail
  --      closed: without it the exclusion_violation handler below could never
  --      fire and overlapping confirmado bookings would be written silently.
  SELECT count(*), max(pg_get_constraintdef(c.oid))
    INTO v_xcount, v_xdef
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'Turno'
    AND c.contype = 'x';

  IF v_xcount IS DISTINCT FROM 1
     OR v_xdef IS NULL
     OR v_xdef !~ '\mbarbero_id\M'
     OR v_xdef !~ '\mtsrange\M'
     OR v_xdef !~ '&&'
     OR v_xdef !~ '\[\)'
     OR v_xdef !~ '\mconfirmado\M'
  THEN
    RETURN jsonb_build_object(
      'error', jsonb_build_object(
        'code', 'INTERNAL_ERROR',
        'message', 'Booking is temporarily unavailable',
        'retryable', true
      )
    );
  END IF;

  -- 2.11 Claim the key and create or reuse the customer, then the booking,
  --      atomically.
  --      The claim INSERT MUST stay inside this same BEGIN ... EXCEPTION block
  --      as the booking insert. Otherwise SLOT_UNAVAILABLE would roll back the
  --      booking but commit the claim, poisoning a legitimate retry into
  --      IDEMPOTENCY_KEY_REUSED.
  --      The email is part of the payload hash: a retry that changes it is a
  --      different request and must not silently replay the previous booking.
  --      Customer identity is the lowercased email, enforced by the partial
  --      unique index cliente_barberia_email_unique. ON CONFLICT rather than
  --      SELECT-then-INSERT is what makes concurrent first bookings with the
  --      same new email safe: both would find nothing, both would try to insert,
  --      and one would fail with a raw unique violation.
  --      Unknown failures must propagate: there is deliberately no WHEN OTHERS
  --      handler to mask them as a success-shaped jsonb response.
  --      Do not write the legacy numeric telefono column.
  v_payload_hash := md5(concat_ws('|',
    p_slug, p_service_token, p_inicio::text,
    trim(p_nombre), trim(p_apellido), p_telefono, v_email));
  v_customer_name := trim(p_nombre) || ' ' || trim(p_apellido);

  BEGIN
    -- Claiming inside this subtransaction ensures a failed booking also rolls
    -- back the key, so the caller can retry without leaving a poisoned claim.
    INSERT INTO public."BookingIdempotency" AS bi
           (barberia_id, idempotency_key, payload_hash, expires_at)
    VALUES (v_rec.barberia_id, p_idempotency_key, v_payload_hash,
            now() + interval '24 hours')
    ON CONFLICT (barberia_id, idempotency_key) DO UPDATE
      SET payload_hash = EXCLUDED.payload_hash,
          response     = NULL,
          created_at   = now(),
          expires_at   = EXCLUDED.expires_at
      WHERE bi.expires_at < now()
    RETURNING bi.id INTO v_claim_id;

    IF v_claim_id IS NULL THEN
      -- The key is already claimed and still live.
      SELECT payload_hash, response
        INTO v_prev_hash, v_prev_response
      FROM public."BookingIdempotency"
      WHERE barberia_id = v_rec.barberia_id
        AND idempotency_key = p_idempotency_key;

      IF v_prev_hash = v_payload_hash THEN
        IF v_prev_response IS NOT NULL THEN
          RETURN v_prev_response;   -- Identical request already succeeded.
        END IF;
        -- Unreachable by construction: claim and response commit together.
        RETURN jsonb_build_object('error', jsonb_build_object(
          'code', 'INTERNAL_ERROR',
          'message', 'Booking is temporarily unavailable',
          'retryable', true));
      END IF;

      RETURN jsonb_build_object('error', jsonb_build_object(
        'code', 'IDEMPOTENCY_KEY_REUSED',
        'message', 'Idempotency key was reused with a different request',
        'retryable', false));
    END IF;

    INSERT INTO public."Cliente"
           (barberia_id, nombre, telefono_raw, telefono_normalizado, email)
    VALUES (v_rec.barberia_id, v_customer_name, p_telefono_raw, p_telefono, v_email)
    ON CONFLICT (barberia_id, email) WHERE email IS NOT NULL DO UPDATE
      SET nombre               = EXCLUDED.nombre,
          telefono_raw         = EXCLUDED.telefono_raw,
          telefono_normalizado = EXCLUDED.telefono_normalizado
    RETURNING id INTO v_cliente_id;

    INSERT INTO public."Turno" (cliente_id, servicio_id, inicio, barbero_id, estado, origen, duracion_minutos)
    VALUES (v_cliente_id, v_rec.servicio_id, p_inicio, v_rec.barbero_id, 'confirmado', 'web', v_duracion_min);

    v_response := jsonb_build_object('booking', jsonb_build_object(
      'start', to_char(p_inicio, 'YYYY-MM-DD"T"HH24:MI:SS'),
      'end', to_char(p_inicio + (v_duracion * interval '1 minute'), 'YYYY-MM-DD"T"HH24:MI:SS'),
      'durationMinutes', to_jsonb(v_duracion_min),
      'price', to_jsonb(v_rec.servicio_precio),
      'status', 'confirmado',
      'origin', 'web',
      'serviceName', v_rec.servicio_nombre,
      'barberName', v_rec.barbero_nombre,
      'shopName', v_rec.barberia_nombre,
      'customer', jsonb_build_object('name', v_customer_name, 'phone', p_telefono, 'email', v_email)
    ));

    UPDATE public."BookingIdempotency" SET response = v_response WHERE id = v_claim_id;

    RETURN v_response;
  EXCEPTION
    WHEN exclusion_violation THEN
      RETURN jsonb_build_object('error', jsonb_build_object(
        'code', 'SLOT_UNAVAILABLE', 'message', 'Slot no longer available', 'retryable', false));
  END;
END;
$$;

-- 3. Lock down booking RPC execution: only service_role (server-side Edge Functions) may invoke.
REVOKE EXECUTE ON FUNCTION public.public_crear_turno(text, text, timestamp, text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_crear_turno(text, text, timestamp, text, text, text, text, text, text)
  TO service_role;

-- 4. Read-only probes (no schema effect).
SELECT p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS args,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'public_crear_turno'
ORDER BY p.proname;

SELECT id, nombre, codigos_area_permitidos
FROM public."Barberia"
WHERE public_slug = 'conexion-barberia' AND publicado = true;

COMMIT;
