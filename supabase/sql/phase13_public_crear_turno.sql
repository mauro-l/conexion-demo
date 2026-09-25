-- Migration: phase13_public_crear_turno
-- Purpose: create a public booking RPC that re-validates the requested slot and
--          inserts a customer and confirmed web appointment atomically.
-- Dependency: REQUIRES phase11_public_service_token and phase12_public_availability.
-- Safety: the function is SECURITY INVOKER and executable by service_role only;
--         it returns no internal identifiers and relies on turno_sin_solape as
--         the final authority when concurrent bookings race. This file also
--         creates the BookingIdempotency table.
-- Idempotency: the BookingIdempotency ledger atomically claims each tenant key,
--              replays the exact response for a matching request, and rejects
--              a live key reused with a different request.

BEGIN;

-- 1. Tenant-scoped idempotency ledger for public bookings.
--    The unique (barberia_id, idempotency_key) index is the concurrency mechanism:
--    a concurrent request with the same key blocks here until the winner's
--    transaction ends, so no advisory lock or retry loop is needed.
--    REVOKE is NOT optional: postgres default privileges in this project grant
--    authenticated ALL on every new public table. Without this revoke, any
--    logged-in user could read the ledger. This mirrors CodigoVerificacion, the
--    only existing table here already closed to authenticated.
--    RLS has no policies; service_role bypasses RLS and is the only caller because
--    the booking RPC is SECURITY INVOKER.
--    response stores the exact public DTO returned, so a replay returns the
--    identical booking without exposing internal identifiers.
--    Error code IDEMPOTENCY_KEY_REUSED means a live key was submitted with a
--    different request payload.
CREATE TABLE IF NOT EXISTS public."BookingIdempotency" (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  barberia_id     bigint NOT NULL REFERENCES public."Barberia"(id),
  idempotency_key text   NOT NULL,
  payload_hash    text   NOT NULL,
  response        jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  CONSTRAINT bookingidempotency_tenant_key_unique UNIQUE (barberia_id, idempotency_key)
);

ALTER TABLE public."BookingIdempotency" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."BookingIdempotency" FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public."BookingIdempotency" TO service_role;

-- 1.1 The identity sequence is a SEPARATE object: revoking on the table does not
--     touch it. postgres default privileges grant `authenticated` UPDATE on every
--     new public sequence, and UPDATE on a sequence IS setval(), so leaving it
--     open would let any logged-in user rewrite the id counter and manufacture
--     primary-key collisions. The generated name is resolved from the catalog
--     rather than hardcoded, because it is not quoted like the table name.
DO $$
DECLARE
  v_seq text;
BEGIN
  v_seq := pg_get_serial_sequence('public."BookingIdempotency"', 'id');
  IF v_seq IS NOT NULL THEN
    EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated', v_seq);
    EXECUTE format('GRANT ALL ON SEQUENCE %s TO service_role', v_seq);
  END IF;
END $$;

-- 2. Public booking RPC.
--    Contract: { booking: { start, end, durationMinutes, price, status, origin,
--    serviceName, barberName, shopName, customer: { name, phone } } }. No
--    internal identifiers are ever returned.
--
--    Time: Turno.inicio stores Buenos Aires wall time in a timestamp without time
--    zone, so PostgreSQL's Buenos Aires local clock is the sole authority.
--    The requested start must be at least 30 minutes ahead and inside the
--    [today, today+14 days) local-date window.
--
--    Availability: the requested start is revalidated against the intersection
--    of shop and barber working days and hours, and the effective-open-anchored
--    30-minute grid. Full-day and partial BloqueoHorario rows are honored; the
--    turno_sin_solape exclusion constraint is the final race-safe authority.
DROP FUNCTION IF EXISTS public.public_crear_turno(text, text, timestamp, text, text, text, text);

CREATE OR REPLACE FUNCTION public.public_crear_turno(
  p_slug            text,
  p_service_token   text,
  p_inicio          timestamp,
  p_nombre          text,
  p_apellido        text,
  p_telefono        text,
  p_telefono_raw    text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Buenos Aires local clock anchors.
  v_now          timestamp;
  v_today        date;
  v_dow          integer;
  v_rec          record;
  v_duracion_min smallint;
  v_duracion     numeric;
  v_eff_open     time;
  v_eff_close    time;
  v_cliente_id   bigint;
  v_customer_name text;
  v_payload_hash text;
  v_claim_id     bigint;
  v_prev_hash    text;
  v_prev_response jsonb;
  v_response     jsonb;
  -- Anti-overlap constraint shape, discovered from the catalog, never assumed.
  v_xcount       integer;
  v_xdef         text;
BEGIN
  -- 2.1 Resolve the shop, service, and its active barber in one query.
  SELECT b.id AS barberia_id,
         b.nombre AS barberia_nombre,
         b.dias_habiles AS barberia_dias,
         b.hora_apertura AS barberia_apertura,
         b.hora_cierre AS barberia_cierre,
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

  -- 2.2 Validate all client-controlled values before using them.
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
  THEN
    RETURN jsonb_build_object(
      'error', jsonb_build_object(
        'code', 'INVALID_INPUT',
        'message', 'Invalid input',
        'retryable', false
      )
    );
  END IF;

  -- 2.3 A service or barber with incomplete schedule data is not bookable.
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

  -- 2.4 Enforce the local lead-time and 14-day window using PostgreSQL time.
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

  -- 2.5 Both the barber and shop must work on the requested local weekday.
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

  -- 2.6 Revalidate effective hours and the real-slot grid.
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

  -- 2.7 Exclude full-day, overlapping partial, and half-defined blocks.
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

  -- 2.8 Verify the anti-overlap constraint is present and still covers the state
  --     this RPC writes. turno_sin_solape is the final authority against
  --     concurrent bookings, so a missing or weakened constraint must fail
  --     closed: without it the exclusion_violation handler below could never fire
  --     and overlapping confirmado bookings would be written silently. The
  --     definition is read from the catalog, never assumed by name, and only the
  --     occupying state this RPC actually writes ('confirmado') is required -
  --     that is exactly what protects this insert.
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

  -- 2.9 Claim the key and create the customer and booking atomically.
  --     The claim INSERT MUST stay inside this same BEGIN ... EXCEPTION block as
  --     both booking inserts. Otherwise SLOT_UNAVAILABLE would roll back the
  --     booking but commit the claim, poisoning a legitimate retry into
  --     IDEMPOTENCY_KEY_REUSED.
  --     ON CONFLICT ... DO UPDATE ... WHERE bi.expires_at < now() makes the key
  --     reusable after its 24-hour TTL. A live key returns no row, which detects
  --     an existing claim. A concurrent duplicate waits on the unique index,
  --     then replays the winner's committed response or becomes the winner if
  --     that transaction rolled back.
  --     Unknown failures must propagate: there is deliberately no WHEN OTHERS
  --     handler to mask them as a success-shaped jsonb response.
  --     Always create a new customer row, matching crear_turno; do not write the
  --     legacy numeric telefono column. Customer deduplication is out of scope.
  v_payload_hash := md5(concat_ws('|',
    p_slug, p_service_token, p_inicio::text,
    trim(p_nombre), trim(p_apellido), p_telefono));
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

    INSERT INTO public."Cliente" (barberia_id, nombre, telefono_raw, telefono_normalizado)
    VALUES (v_rec.barberia_id, v_customer_name, p_telefono_raw, p_telefono)
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
      'customer', jsonb_build_object('name', v_customer_name, 'phone', p_telefono)
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
REVOKE EXECUTE ON FUNCTION public.public_crear_turno(text, text, timestamp, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_crear_turno(text, text, timestamp, text, text, text, text, text)
  TO service_role;

-- 4. Read-only probe (no schema effect): the effective grants must show
--    service_role = true and anon/authenticated = false for the booking RPC.
SELECT p.proname AS function_name,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'public_crear_turno'
ORDER BY p.proname;

-- Read-only probe: only service_role should have table privileges.
SELECT 'BookingIdempotency' AS table_name,
       has_table_privilege('anon', 'public."BookingIdempotency"', 'SELECT') AS anon_can_select,
       has_table_privilege('authenticated', 'public."BookingIdempotency"', 'SELECT') AS authenticated_can_select,
       has_table_privilege('service_role', 'public."BookingIdempotency"', 'SELECT') AS service_role_can_select;

COMMIT;
