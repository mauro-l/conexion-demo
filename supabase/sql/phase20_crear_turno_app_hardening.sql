-- Migration: phase20_crear_turno_app_hardening
-- Purpose: harden public.crear_turno (the ONLY RPC executable by
--          `authenticated`; the app booking surface) with the five F3 points
--          agreed on 2026-09-26, mirroring the fail-closed guards 3.5/3.7-3.9
--          of public_crear_turno (phase19):
--          1. Schedule + blocks mirror: NULL barber/shop schedule field
--             (dias_habiles, hora_apertura, hora_cierre of either side)
--             -> HORARIO_NO_CONFIGURADO; weekday must be positively worked by
--             BOTH barber and shop (`IS NOT TRUE`, NULL-unsafe ANY made safe)
--             -> FUERA_DE_HORARIO; effective window greatest/least with
--             NULL/empty check plus start/end containment (no grid: the app has
--             no 30-minute grid) -> FUERA_DE_HORARIO; BloqueoHorario EXISTS
--             with the same 3-branch predicate as phase19 3.9 (full-day,
--             overlapping partial, half-defined) -> HORARIO_BLOQUEADO.
--          2. Mandatory phone: NULL/blank p_telefono -> TELEFONO_INVALIDO, and
--             the same pattern the CHECK enforces
--             ('^\+549(11[0-9]{8}|[23][0-9]{9})$', identical to
--             cliente_telefono_formato_chk). The CHECK itself allows NULL;
--             this RPC is stricter on purpose (product decision 2026-09-26:
--             phone mandatory on both surfaces; production already holds
--             phone-less Cliente rows).
--          3. Origen whitelist narrowed to ('presencial','whatsapp'): 'web' is
--             dropped -> ORIGEN_INVALIDO. Verified 2026-09-26 that no legit app
--             caller sends 'web' (proyecto-final-rn OrigenTurno is
--             'presencial' | 'whatsapp'; confirmar.tsx only offers those two).
--          4. NULL Servicio.duracion -> SERVICIO_NO_RESERVABLE instead of the
--             old COALESCE(...,30) invention.
--          5. Barber resolution is deterministic (ORDER BY id LIMIT 1).
--          Explicitly NOT added: 30-minute lead time, 14-day window, 30-minute
--          grid, Cliente dedupe/upsert (out of scope per F3).
-- New codes (all UPPER_SNAKE, ERRCODE P0001, same style as the existing ones):
--   HORARIO_NO_CONFIGURADO -- barber or shop schedule field is NULL.
--   FUERA_DE_HORARIO       -- weekday not worked by both sides, or effective
--                            window NULL/empty, or slot outside it.
--   HORARIO_BLOQUEADO      -- BloqueoHorario covers the slot.
--   TELEFONO_INVALIDO      -- phone NULL/blank or off the canonical pattern.
--   SERVICIO_NO_RESERVABLE -- Servicio.duracion IS NULL.
-- Dependency: none beyond the existing schema. Rewrites crear_turno, which
--             lives OUTSIDE the phase9..phase19 chain (app surface, not the
--             public web booking flow), so no phase REQUIRES line applies.
-- Safety: same 7-argument signature, CREATE OR REPLACE (no DROP: arity is
--         unchanged, so the authenticated grant survives untouched). The live
--         DEFAULT NULL on p_telefono/p_telefono_raw is preserved verbatim:
--         dropping a default via CREATE OR REPLACE is rejected by Postgres
--         ("cannot remove parameter defaults"), and removing it would break
--         any caller that omits the phone arguments. Grants,
--         RLS, tables, FKs and every other function are untouched.
-- Rollback: phase20_crear_turno_app_hardening_rollback.sql restores the live
--           2026-09-26 body verbatim.

BEGIN;

CREATE OR REPLACE FUNCTION public.crear_turno(
  p_servicio_id bigint,
  p_inicio timestamp without time zone,
  p_origen text,
  p_nombre text,
  p_apellido text,
  p_telefono text DEFAULT NULL,
  p_telefono_raw text DEFAULT NULL
)
RETURNS public."Turno"
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_barbero_id bigint;
  v_barberia_id bigint;
  v_duracion numeric;
  v_duracion_min smallint;
  v_cliente_id bigint;
  v_turno public."Turno";
  -- Schedule mirror (phase19 guards 3.5/3.7/3.8, adapted to RAISE).
  v_barbero_dias smallint[];
  v_barbero_apertura time;
  v_barbero_cierre time;
  v_barberia_dias smallint[];
  v_barberia_apertura time;
  v_barberia_cierre time;
  v_dow integer;
  v_eff_open time;
  v_eff_close time;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'SESION_INVALIDA' USING ERRCODE = 'P0001';
  END IF;

  -- Point 5: deterministic barber resolution.
  SELECT id, barberia_id INTO v_barbero_id, v_barberia_id
  FROM public."Barbero" WHERE users_id = auth.uid()
  ORDER BY id LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CUENTA_NO_VINCULADA' USING ERRCODE = 'P0001';
  END IF;

  SELECT duracion INTO v_duracion
  FROM public."Servicio" WHERE id = p_servicio_id AND barbero_id = v_barbero_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SERVICIO_INVALIDO' USING ERRCODE = 'P0001';
  END IF;

  -- Point 4: a service with NULL duration is not bookable (was COALESCE 30).
  IF v_duracion IS NULL THEN
    RAISE EXCEPTION 'SERVICIO_NO_RESERVABLE' USING ERRCODE = 'P0001';
  END IF;

  IF p_nombre IS NULL OR length(trim(p_nombre)) < 2 OR p_apellido IS NULL OR length(trim(p_apellido)) < 2 THEN
    RAISE EXCEPTION 'DATOS_CLIENTE_INVALIDOS' USING ERRCODE = 'P0001';
  END IF;

  -- Point 2: phone is mandatory and must match the canonical pattern the
  -- cliente_telefono_formato_chk CHECK enforces (the CHECK allows NULL; this
  -- RPC does not, by product decision). NULL/blank is rejected before the
  -- regex because `NULL !~ ...` yields NULL, not true.
  IF p_telefono IS NULL
     OR btrim(p_telefono) = ''
     OR p_telefono !~ '^\+549(11[0-9]{8}|[23][0-9]{9})$' THEN
    RAISE EXCEPTION 'TELEFONO_INVALIDO' USING ERRCODE = 'P0001';
  END IF;

  -- Point 3: app origins only; 'web' belongs to the public web RPC.
  IF p_origen IS NULL OR p_origen NOT IN ('presencial','whatsapp') THEN
    RAISE EXCEPTION 'ORIGEN_INVALIDO' USING ERRCODE = 'P0001';
  END IF;

  -- Point 1a: fetch both schedules.
  SELECT dias_habiles, hora_apertura, hora_cierre
    INTO v_barbero_dias, v_barbero_apertura, v_barbero_cierre
  FROM public."Barbero" WHERE id = v_barbero_id;

  SELECT dias_habiles, hora_apertura, hora_cierre
    INTO v_barberia_dias, v_barberia_apertura, v_barberia_cierre
  FROM public."Barberia" WHERE id = v_barberia_id;

  -- Point 1b (mirror of phase19 3.5): a NULL schedule field is not bookable.
  -- No fallback to the other side's hours: inventing a schedule was
  -- explicitly rejected in review.
  IF v_barbero_dias IS NULL
     OR v_barbero_apertura IS NULL
     OR v_barbero_cierre IS NULL
     OR v_barberia_dias IS NULL
     OR v_barberia_apertura IS NULL
     OR v_barberia_cierre IS NULL
  THEN
    RAISE EXCEPTION 'HORARIO_NO_CONFIGURADO' USING ERRCODE = 'P0001';
  END IF;

  v_duracion_min := GREATEST(1, LEAST(480, v_duracion))::smallint;

  -- Point 1c (mirror of phase19 3.7): both sides must positively work the
  -- requested weekday. `IS NOT TRUE` rejects false AND NULL alike (an array
  -- holding a NULL element yields NULL from ANY, which `IF NULL` would skip
  -- silently). A NULL p_inicio also lands here and fails closed.
  v_dow := extract(dow FROM p_inicio)::int;
  IF (v_dow = ANY (v_barbero_dias)
      AND v_dow = ANY (v_barberia_dias)) IS NOT TRUE
  THEN
    RAISE EXCEPTION 'FUERA_DE_HORARIO' USING ERRCODE = 'P0001';
  END IF;

  -- Point 1d (mirror of phase19 3.8): effective window from both sides.
  -- greatest/least ignore NULL inputs in Postgres, hence the explicit
  -- NULL/empty check (unreachable NULLs after 1b, but defense in depth).
  -- No 30-minute grid: the app has none, so only containment is enforced.
  v_eff_open := greatest(v_barberia_apertura, v_barbero_apertura);
  v_eff_close := least(v_barberia_cierre, v_barbero_cierre);

  IF v_eff_open IS NULL OR v_eff_close IS NULL OR v_eff_open >= v_eff_close THEN
    RAISE EXCEPTION 'FUERA_DE_HORARIO' USING ERRCODE = 'P0001';
  END IF;

  IF p_inicio < (p_inicio::date + v_eff_open)
     OR p_inicio + (v_duracion_min * interval '1 minute') > (p_inicio::date + v_eff_close)
  THEN
    RAISE EXCEPTION 'FUERA_DE_HORARIO' USING ERRCODE = 'P0001';
  END IF;

  -- Point 1e (mirror of phase19 3.9): full-day, overlapping partial, and
  -- half-defined blocks all reject. The CHECK
  -- bloqueohorario_horas_completas makes the half-defined state
  -- unrepresentable; the third branch is defense in depth.
  IF EXISTS (
    SELECT 1 FROM public."BloqueoHorario" bl
    WHERE bl.barbero_id = v_barbero_id
      AND bl.fecha = p_inicio::date
      AND (
        (bl.hora_inicio IS NULL AND bl.hora_fin IS NULL)
        OR (bl.hora_inicio IS NOT NULL AND bl.hora_fin IS NOT NULL
            AND tsrange(p_inicio::date + bl.hora_inicio, p_inicio::date + bl.hora_fin, '[)')
                && tsrange(p_inicio, p_inicio + (v_duracion_min * interval '1 minute'), '[)'))
        OR ((bl.hora_inicio IS NULL) <> (bl.hora_fin IS NULL))
      )
  ) THEN
    RAISE EXCEPTION 'HORARIO_BLOQUEADO' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public."Cliente" (barberia_id, nombre, telefono_raw, telefono_normalizado)
  VALUES (v_barberia_id, trim(p_nombre) || ' ' || trim(p_apellido), p_telefono_raw, p_telefono)
  RETURNING id INTO v_cliente_id;

  INSERT INTO public."Turno" (cliente_id, servicio_id, inicio, barbero_id, estado, origen, duracion_minutos)
  VALUES (v_cliente_id, p_servicio_id, p_inicio, v_barbero_id, 'confirmado', p_origen, v_duracion_min)
  RETURNING * INTO v_turno;

  RETURN v_turno;
END;
$$;

-- Read-only probe: exactly one crear_turno overload (the 7-argument app
-- signature) must exist; a leftover overload would make PostgREST answer
-- PGRST203.
SELECT count(*) AS overloads,
       bool_and(p.pronargs = 7) AS single_7_arg_overload
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'crear_turno';

-- Read-only probe: the app surface must stay executable by authenticated.
SELECT has_function_privilege(
         'authenticated',
         'public.crear_turno(bigint, timestamp without time zone, text, text, text, text, text)',
         'EXECUTE'
       ) AS authenticated_can_execute;

COMMIT;
