-- Migration: phase15_public_cancellation
-- Purpose: mint an opaque management token with each public booking and expose
--          read and cancellation RPCs without granting anon table access.
-- Dependency: REQUIRES phase14_public_crear_turno_email_and_area.
-- Safety: all RPCs are SECURITY INVOKER and executable by service_role only;
--         Postgres receives only a token hash, and the management DTO has no PII.
-- Rollback: phase15_public_cancellation_rollback.sql.

BEGIN;

-- 1. Token hashes authorize management of one booking. used_at records the first
--    cancellation performed with a token; revoked_at is reserved for an
--    out-of-band operational revocation and stays NULL in the normal flow.
CREATE TABLE IF NOT EXISTS public."TurnoTokenGestion" (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  turno_id   bigint NOT NULL REFERENCES public."Turno"(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  tipo       text NOT NULL DEFAULT 'gestion',
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT turnotokengestion_token_hash_unique UNIQUE (token_hash)
);

ALTER TABLE public."TurnoTokenGestion" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."TurnoTokenGestion" FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public."TurnoTokenGestion" TO service_role;

-- The identity sequence is a separate integrity boundary: UPDATE permits
-- setval(), which could force duplicate ids and break booking inserts. Resolve
-- its generated name from the catalog, then reserve it for service_role.
DO $$
DECLARE
  v_seq text;
BEGIN
  v_seq := pg_get_serial_sequence('public."TurnoTokenGestion"', 'id');
  IF v_seq IS NOT NULL THEN
    EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated', v_seq);
    EXECUTE format('GRANT ALL ON SEQUENCE %s TO service_role', v_seq);
  END IF;
END $$;

-- 2. The ledger links a successful key to its booking so a replay can mint a
--    fresh token without repeating the booking or retaining any raw token.
ALTER TABLE public."BookingIdempotency"
  ADD COLUMN IF NOT EXISTS turno_id bigint REFERENCES public."Turno"(id) ON DELETE SET NULL;

-- 3. Replace the phase14 RPC with a 10-argument version. PostgreSQL does not
--    allow adding a parameter through CREATE OR REPLACE; leaving the old
--    overload would make PostgREST return PGRST203, so drop the 9-argument one.
DROP FUNCTION IF EXISTS public.public_crear_turno(text, text, timestamp, text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.public_crear_turno(
  p_slug                  text,
  p_service_token         text,
  p_inicio                timestamp,
  p_nombre                text,
  p_apellido              text,
  p_telefono              text,
  p_telefono_raw          text,
  p_email                 text,
  p_management_token_hash text,
  p_idempotency_key       text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Buenos Aires local clock anchors.
  v_now             timestamp;
  v_today           date;
  v_dow             integer;
  v_rec             record;
  v_duracion_min    smallint;
  v_duracion        numeric;
  v_eff_open        time;
  v_eff_close       time;
  v_cliente_id      bigint;
  v_turno_id        bigint;
  v_customer_name   text;
  v_email           text;
  v_area_ok         boolean;
  v_payload_hash    text;
  v_claim_id        bigint;
  v_prev_hash       text;
  v_prev_response   jsonb;
  v_prev_turno_id   bigint;
  v_response        jsonb;
  -- Anti-overlap constraint shape, discovered from the catalog, never assumed.
  v_xcount          integer;
  v_xdef            text;
BEGIN
  -- 3.1 Resolve the shop, service, and its active barber in one query. The area
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

  -- 3.2 Normalize the email before validating it: the dedupe identity is the
  --     lowercased value, so `Foo@Mail.com` and `foo@mail.com` are one customer.
  v_email := lower(btrim(coalesce(p_email, '')));

  -- 3.3 Validate all client-controlled values before using them.
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
     OR p_management_token_hash IS NULL
     OR p_management_token_hash !~ '^[a-f0-9]{64}$'
  THEN
    RETURN jsonb_build_object(
      'error', jsonb_build_object(
        'code', 'INVALID_INPUT',
        'message', 'Invalid input',
        'retryable', false
      )
    );
  END IF;

  -- 3.4 Enforce the configured commercial area rule. The Edge's copy is only UX;
  --     this prefix match remains the authority.
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

  -- 3.5 A service or barber with incomplete schedule data is not bookable.
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

  -- 3.6 Enforce the local lead-time and 14-day window using PostgreSQL time.
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

  -- 3.7 Both the barber and shop must work on the requested local weekday.
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

  -- 3.8 Revalidate effective hours and the real-slot grid.
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

  -- 3.9 Exclude full-day, overlapping partial, and half-defined blocks.
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

  -- 3.10 Verify the anti-overlap constraint is present and still covers the
  --      confirmed state this RPC writes. A missing or weakened constraint must
  --      fail closed before concurrent bookings can overlap silently.
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

  -- 3.11 Claim the key and create or reuse the customer, booking and management
  --      token atomically. The hash excludes the newly generated token: retries
  --      must replay the booking even when the Edge mints a fresh token.
  --      No WHEN OTHERS handler is used; unknown failures propagate.
  v_payload_hash := md5(concat_ws('|',
    p_slug, p_service_token, p_inicio::text,
    trim(p_nombre), trim(p_apellido), p_telefono, v_email));
  v_customer_name := trim(p_nombre) || ' ' || trim(p_apellido);

  BEGIN
    INSERT INTO public."BookingIdempotency" AS bi
           (barberia_id, idempotency_key, payload_hash, expires_at)
    VALUES (v_rec.barberia_id, p_idempotency_key, v_payload_hash,
            now() + interval '24 hours')
    ON CONFLICT (barberia_id, idempotency_key) DO UPDATE
      SET payload_hash = EXCLUDED.payload_hash,
          response     = NULL,
          turno_id     = NULL,
          created_at   = now(),
          expires_at   = EXCLUDED.expires_at
      WHERE bi.expires_at < now()
    RETURNING bi.id INTO v_claim_id;

    IF v_claim_id IS NULL THEN
      SELECT payload_hash, response, turno_id
        INTO v_prev_hash, v_prev_response, v_prev_turno_id
      FROM public."BookingIdempotency"
      WHERE barberia_id = v_rec.barberia_id
        AND idempotency_key = p_idempotency_key;

      IF v_prev_hash = v_payload_hash THEN
        IF v_prev_response IS NOT NULL THEN
          IF v_prev_turno_id IS NOT NULL THEN
            INSERT INTO public."TurnoTokenGestion" (turno_id, token_hash, tipo, expires_at)
            SELECT v_prev_turno_id, p_management_token_hash, 'gestion',
                   t.inicio AT TIME ZONE 'America/Argentina/Buenos_Aires'
            FROM public."Turno" t
            WHERE t.id = v_prev_turno_id;
            RETURN v_prev_response;
          END IF;
          -- Legacy successful rows predate the booking link and have no token.
          RETURN v_prev_response;
        END IF;
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

    INSERT INTO public."Turno"
           (cliente_id, servicio_id, inicio, barbero_id, estado, origen, duracion_minutos)
    VALUES (v_cliente_id, v_rec.servicio_id, p_inicio, v_rec.barbero_id,
            'confirmado', 'web', v_duracion_min)
    RETURNING id INTO v_turno_id;

    INSERT INTO public."TurnoTokenGestion" (turno_id, token_hash, expires_at)
    VALUES (v_turno_id, p_management_token_hash,
            p_inicio AT TIME ZONE 'America/Argentina/Buenos_Aires');

    v_response := jsonb_build_object(
      'booking', jsonb_build_object(
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
      ),
      'managementTokenRegistered', true
    );

    UPDATE public."BookingIdempotency"
       SET response = v_response, turno_id = v_turno_id
     WHERE id = v_claim_id;

    RETURN v_response;
  EXCEPTION
    WHEN exclusion_violation THEN
      RETURN jsonb_build_object('error', jsonb_build_object(
        'code', 'SLOT_UNAVAILABLE', 'message', 'Slot no longer available', 'retryable', false));
  END;
END;
$$;

-- 4. Resolve a valid management hash to the booking summary. The output has no
--    customer name, phone, email or internal identifier.
CREATE OR REPLACE FUNCTION public.public_gestionar_turno(p_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rec record;
  v_dur smallint;
  v_can_cancel boolean;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' THEN
    RETURN jsonb_build_object('error', jsonb_build_object(
      'code', 'INVALID_INPUT', 'message', 'Invalid input', 'retryable', false));
  END IF;

  SELECT tt.id AS token_id, tt.expires_at, tt.revoked_at,
         t.id AS turno_id, t.inicio, t.estado, t.origen, t.duracion_minutos,
         s.duracion, s.precio, s.nombre AS service_name,
         ba.nombre AS barber_name, b.nombre AS shop_name
    INTO v_rec
  FROM public."TurnoTokenGestion" tt
  JOIN public."Turno" t ON t.id = tt.turno_id
  JOIN public."Servicio" s ON s.id = t.servicio_id
  JOIN public."Barbero" ba ON ba.id = t.barbero_id
  JOIN public."Barberia" b ON b.id = ba.barberia_id
  WHERE tt.token_hash = p_token_hash;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', jsonb_build_object(
      'code', 'PUBLIC_RESOURCE_NOT_FOUND', 'message', 'Resource not found', 'retryable', false));
  END IF;
  IF v_rec.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('error', jsonb_build_object(
      'code', 'TOKEN_REVOKED', 'message', 'Management token revoked', 'retryable', false));
  END IF;
  IF now() >= v_rec.expires_at THEN
    RETURN jsonb_build_object('error', jsonb_build_object(
      'code', 'TOKEN_EXPIRED', 'message', 'Management token expired', 'retryable', false));
  END IF;

  v_dur := coalesce(v_rec.duracion_minutos, round(v_rec.duracion))::smallint;
  v_can_cancel := v_rec.estado IN ('pendiente', 'confirmado')
    AND v_rec.inicio >= (clock_timestamp() AT TIME ZONE 'America/Argentina/Buenos_Aires')
      + interval '5 minutes';

  RETURN jsonb_build_object('booking', jsonb_build_object(
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
  ));
END;
$$;

-- 5. Cancel once inside the same local five-minute boundary exposed by the read
--    DTO. Repeated cancellation succeeds before expiry/revocation checks.
CREATE OR REPLACE FUNCTION public.public_cancelar_turno(p_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rec record;
  v_dur smallint;
  v_can_cancel boolean;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' THEN
    RETURN jsonb_build_object('error', jsonb_build_object(
      'code', 'INVALID_INPUT', 'message', 'Invalid input', 'retryable', false));
  END IF;

  SELECT tt.id AS token_id, tt.expires_at, tt.revoked_at,
         t.id AS turno_id, t.inicio, t.estado, t.origen, t.duracion_minutos,
         s.duracion, s.precio, s.nombre AS service_name,
         ba.nombre AS barber_name, b.nombre AS shop_name
    INTO v_rec
  FROM public."TurnoTokenGestion" tt
  JOIN public."Turno" t ON t.id = tt.turno_id
  JOIN public."Servicio" s ON s.id = t.servicio_id
  JOIN public."Barbero" ba ON ba.id = t.barbero_id
  JOIN public."Barberia" b ON b.id = ba.barberia_id
  WHERE tt.token_hash = p_token_hash;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', jsonb_build_object(
      'code', 'PUBLIC_RESOURCE_NOT_FOUND', 'message', 'Resource not found', 'retryable', false));
  END IF;

  v_dur := coalesce(v_rec.duracion_minutos, round(v_rec.duracion))::smallint;
  IF v_rec.estado = 'cancelado' THEN
    v_can_cancel := false;
    RETURN jsonb_build_object('booking', jsonb_build_object(
      'start', to_char(v_rec.inicio, 'YYYY-MM-DD"T"HH24:MI:SS'),
      'end', to_char(v_rec.inicio + (v_dur * interval '1 minute'), 'YYYY-MM-DD"T"HH24:MI:SS'),
      'durationMinutes', v_dur,
      'price', v_rec.precio,
      'status', 'cancelado',
      'origin', v_rec.origen,
      'serviceName', v_rec.service_name,
      'barberName', v_rec.barber_name,
      'shopName', v_rec.shop_name,
      'canCancel', v_can_cancel
    ));
  END IF;

  IF v_rec.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('error', jsonb_build_object(
      'code', 'TOKEN_REVOKED', 'message', 'Management token revoked', 'retryable', false));
  END IF;
  IF now() >= v_rec.expires_at THEN
    RETURN jsonb_build_object('error', jsonb_build_object(
      'code', 'TOKEN_EXPIRED', 'message', 'Management token expired', 'retryable', false));
  END IF;
  IF v_rec.estado NOT IN ('pendiente', 'confirmado') THEN
    RETURN jsonb_build_object('error', jsonb_build_object(
      'code', 'NOT_CANCELLABLE', 'message', 'Booking cannot be cancelled', 'retryable', false));
  END IF;
  IF v_rec.inicio < (clock_timestamp() AT TIME ZONE 'America/Argentina/Buenos_Aires')
       + interval '5 minutes' THEN
    RETURN jsonb_build_object('error', jsonb_build_object(
      'code', 'CANCEL_TOO_LATE', 'message', 'Cancellation is too close to the start', 'retryable', false));
  END IF;

  UPDATE public."Turno" SET estado = 'cancelado', update_at = now()
  WHERE id = v_rec.turno_id;
  UPDATE public."TurnoTokenGestion"
     SET used_at = coalesce(used_at, now())
   WHERE id = v_rec.token_id;

  RETURN jsonb_build_object('booking', jsonb_build_object(
    'start', to_char(v_rec.inicio, 'YYYY-MM-DD"T"HH24:MI:SS'),
    'end', to_char(v_rec.inicio + (v_dur * interval '1 minute'), 'YYYY-MM-DD"T"HH24:MI:SS'),
    'durationMinutes', v_dur,
    'price', v_rec.precio,
    'status', 'cancelado',
    'origin', v_rec.origen,
    'serviceName', v_rec.service_name,
    'barberName', v_rec.barber_name,
    'shopName', v_rec.shop_name,
    'canCancel', false
  ));
END;
$$;

-- 6. Keep every public entry point server-side only.
REVOKE EXECUTE ON FUNCTION public.public_crear_turno(text, text, timestamp, text, text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_crear_turno(text, text, timestamp, text, text, text, text, text, text, text)
  TO service_role;
REVOKE EXECUTE ON FUNCTION public.public_gestionar_turno(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_gestionar_turno(text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.public_cancelar_turno(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_cancelar_turno(text) TO service_role;

-- Read-only probe: the three RPCs must be executable only by service_role.
SELECT p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS args,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('public_crear_turno', 'public_gestionar_turno', 'public_cancelar_turno')
ORDER BY p.proname;

-- Read-only probe: no untrusted role should read management-token rows.
SELECT 'TurnoTokenGestion' AS table_name,
       has_table_privilege('anon', 'public."TurnoTokenGestion"', 'SELECT') AS anon_can_select,
       has_table_privilege('authenticated', 'public."TurnoTokenGestion"', 'SELECT') AS authenticated_can_select,
       has_table_privilege('service_role', 'public."TurnoTokenGestion"', 'SELECT') AS service_role_can_select;

COMMIT;
