-- Rollback: phase20_crear_turno_app_hardening
-- Reverses phase20_crear_turno_app_hardening.sql only. Restores the live
-- 2026-09-26 body of public.crear_turno VERBATIM (same 7-argument signature,
-- so no GRANT/REVOKE is needed: the authenticated grant survives).
-- Deliberately does NOT touch any other function, grant, table, or FK.

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
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'SESION_INVALIDA' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, barberia_id INTO v_barbero_id, v_barberia_id
  FROM public."Barbero" WHERE users_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CUENTA_NO_VINCULADA' USING ERRCODE = 'P0001';
  END IF;

  SELECT duracion INTO v_duracion
  FROM public."Servicio" WHERE id = p_servicio_id AND barbero_id = v_barbero_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SERVICIO_INVALIDO' USING ERRCODE = 'P0001';
  END IF;

  IF p_nombre IS NULL OR length(trim(p_nombre)) < 2 OR p_apellido IS NULL OR length(trim(p_apellido)) < 2 THEN
    RAISE EXCEPTION 'DATOS_CLIENTE_INVALIDOS' USING ERRCODE = 'P0001';
  END IF;

  IF p_origen IS NULL OR p_origen NOT IN ('presencial','whatsapp','web') THEN
    RAISE EXCEPTION 'ORIGEN_INVALIDO' USING ERRCODE = 'P0001';
  END IF;

  v_duracion_min := GREATEST(1, LEAST(480, COALESCE(v_duracion, 30)))::smallint;

  INSERT INTO public."Cliente" (barberia_id, nombre, telefono_raw, telefono_normalizado)
  VALUES (v_barberia_id, trim(p_nombre) || ' ' || trim(p_apellido), p_telefono_raw, p_telefono)
  RETURNING id INTO v_cliente_id;

  INSERT INTO public."Turno" (cliente_id, servicio_id, inicio, barbero_id, estado, origen, duracion_minutos)
  VALUES (v_cliente_id, p_servicio_id, p_inicio, v_barbero_id, 'confirmado', p_origen, v_duracion_min)
  RETURNING * INTO v_turno;

  RETURN v_turno;
END;
$$;

COMMIT;
