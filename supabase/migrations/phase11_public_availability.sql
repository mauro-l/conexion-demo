-- Migration: phase11_public_availability
-- Purpose: add an opaque public service token to Servicio and a read-only
--          public_availability RPC that computes Buenos Aires local slots.
--          Also replaces public_catalog so the catalog DTO exposes the token.
-- Safety: additive DDL only; anon receives no table or function grants. The new
--         RPC is executable by service_role only and performs no mutation.

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

-- 3. Read-only availability RPC.
--    Contract: { service: { publicServiceToken, name, durationMinutes, price,
--    description }, days: [ { date, day, slots: [ { start, end,
--    availabilityToken } ] } ] }. No internal identifiers are ever returned.
--
--    Time: Turno.inicio stores Buenos Aires wall time in a timestamp without time
--    zone, so every boundary is computed as naive local time in
--    America/Argentina/Buenos_Aires with PostgreSQL as the sole authority.
--
--    Window: the local date interval [today, today+14 days); today is day 0 and
--    today+13 is the last included date. day is 0=Sunday ... 6=Saturday.
--
--    Slots: 30-minute starts inside the intersection of shop and barber working
--    days and hours, starting at or after local now + 30 minutes, bounded by the
--    service duration as [start, end), and finishing before the exclusive window
--    end. A barber with any NULL day/hour field contributes no slots and never
--    falls back to shop hours. Occupying states come from the live anti-overlap
--    constraint; partial/full-day blocks are excluded and starts are unioned
--    across eligible barbers. A NULL service duration yields an empty days array.
CREATE OR REPLACE FUNCTION public.public_availability(
  p_slug text,
  p_service_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Buenos Aires local clock anchors.
  v_now     timestamp;
  v_today   date;
  v_win_end timestamp;  -- exclusive bound: local midnight starting today+14
  v_service record;
  -- Catalog-derived anti-overlap state predicate; no constraint name is assumed.
  v_xcount  integer;
  v_xdef    text;
  v_pred    text;
  -- Dynamic slot query and its result.
  v_sql     text;
  v_days    jsonb;
BEGIN
  -- 3.1 Resolve the service inside a published shop through its active barbers.
  SELECT s.nombre, s.duracion, s.precio, s.descripcion
    INTO v_service
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

  -- 3.2 Fixed local clock and window.
  v_now     := clock_timestamp() AT TIME ZONE 'America/Argentina/Buenos_Aires';
  v_today   := v_now::date;
  v_win_end := (v_today + 14)::timestamp;

  -- 3.3 The service DTO is always returned, but a NULL duration is not
  --     computable: the contract answers with an empty days array.
  IF v_service.duracion IS NULL THEN
    RETURN jsonb_build_object(
      'service', jsonb_build_object(
        'publicServiceToken', p_service_token,
        'name', v_service.nombre,
        'durationMinutes', to_jsonb(v_service.duracion),
        'price', to_jsonb(v_service.precio),
        'description', v_service.descripcion
      ),
      'days', '[]'::jsonb
    );
  END IF;

  -- 3.4 Discover the live anti-overlap constraint instead of assuming its name.
  --     The partial predicate (occupying states) is read from the linked index
  --     and the constraint definition; any shape drift fails closed.
  SELECT count(*),
         max(pg_get_constraintdef(c.oid)),
         max(pg_get_expr(i.indpred, i.indrelid))
    INTO v_xcount, v_xdef, v_pred
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  LEFT JOIN pg_index i ON i.indexrelid = c.conindid
  WHERE n.nspname = 'public'
    AND t.relname = 'Turno'
    AND c.contype = 'x';

  IF v_xcount IS DISTINCT FROM 1
     OR v_xdef IS NULL
     OR v_xdef !~ '\mbarbero_id\M'
     OR v_xdef !~ '\mtsrange\M'
     OR v_xdef !~ '&&'
     OR v_xdef !~ '\[\)'
     OR v_xdef !~ '\mpendiente\M'
     OR v_xdef !~ '\mconfirmado\M'
     OR v_xdef !~ '\mcompletado\M'
  THEN
    RETURN jsonb_build_object(
      'error', jsonb_build_object(
        'code', 'INTERNAL_ERROR',
        'message', 'Availability is temporarily unavailable',
        'retryable', true
      )
    );
  END IF;

  v_pred := nullif(btrim(coalesce(v_pred, '')), '');
  IF v_pred IS NULL THEN
    v_pred := substring(v_xdef from '\mWHERE\M\s+(.+)$');
  END IF;
  IF v_pred IS NULL OR btrim(v_pred) = '' THEN
    RETURN jsonb_build_object(
      'error', jsonb_build_object(
        'code', 'INTERNAL_ERROR',
        'message', 'Availability is temporarily unavailable',
        'retryable', true
      )
    );
  END IF;

  -- 3.5 Slot computation. The catalog-derived predicate is spliced into a
  --     parameterized statement ($1..$5 are values, never catalog text).
  v_sql := format($slot$
    WITH shop AS (
      SELECT b.id, b.dias_habiles, b.hora_apertura, b.hora_cierre
      FROM public."Barberia" b
      WHERE b.public_slug = $4 AND b.publicado = true
    ),
    barbers AS (
      SELECT ba.id AS barbero_id,
             ba.dias_habiles, ba.hora_apertura, ba.hora_cierre
      FROM public."Barbero" ba
      JOIN shop sh ON sh.id = ba.barberia_id
      WHERE ba.activo = true
        AND ba.dias_habiles IS NOT NULL
        AND ba.hora_apertura IS NOT NULL
        AND ba.hora_cierre IS NOT NULL
    ),
    win AS (
      SELECT (generate_series(
                $5::timestamp,
                $5::timestamp + interval '13 days',
                interval '1 day'
              ))::date AS d
    ),
    sched AS (
      SELECT w.d,
             extract(dow FROM w.d)::int AS dow,
             bb.barbero_id,
             greatest(sh.hora_apertura, bb.hora_apertura) AS eff_open,
             least(sh.hora_cierre, bb.hora_cierre) AS eff_close
      FROM win w
      CROSS JOIN shop sh
      JOIN barbers bb ON extract(dow FROM w.d)::int = ANY (bb.dias_habiles)
      WHERE sh.dias_habiles IS NOT NULL
        AND sh.hora_apertura IS NOT NULL
        AND sh.hora_cierre IS NOT NULL
        AND extract(dow FROM w.d)::int = ANY (sh.dias_habiles)
    ),
    cand AS (
      SELECT sc.d, sc.dow, sc.barbero_id,
             gs AS start_ts,
             gs + ($3::numeric * interval '1 minute') AS end_ts
      FROM sched sc
      CROSS JOIN LATERAL generate_series(
        sc.d + sc.eff_open,
        sc.d + sc.eff_close - ($3::numeric * interval '1 minute'),
        interval '30 minutes'
      ) AS gs
      WHERE gs >= $1::timestamp + interval '30 minutes'
        AND gs + ($3::numeric * interval '1 minute') < $2::timestamp
    ),
    free AS (
      SELECT DISTINCT c.d, c.dow, c.start_ts, c.end_ts
      FROM cand c
      WHERE NOT EXISTS (
              SELECT 1
              FROM public."BloqueoHorario" bl
              WHERE bl.barbero_id = c.barbero_id
                AND bl.fecha = c.d
                AND (
                  -- Full-day block: both boundaries NULL excludes the whole date.
                  (bl.hora_inicio IS NULL AND bl.hora_fin IS NULL)
                  -- Partial block: both boundaries present, half-open [start, end).
                  OR (
                    bl.hora_inicio IS NOT NULL
                    AND bl.hora_fin IS NOT NULL
                    AND tsrange(c.d + bl.hora_inicio, c.d + bl.hora_fin, '[)')
                        && tsrange(c.start_ts, c.end_ts, '[)')
                  )
                  -- Defense in depth: exactly one NULL boundary is half-defined.
                  -- Failing closed (excluding the date) is intentional: silently
                  -- under-suppressing availability causes double bookings, which
                  -- is worse than over-suppressing. The CHECK below makes this
                  -- state unrepresentable.
                  OR ((bl.hora_inicio IS NULL) <> (bl.hora_fin IS NULL))
                )
            )
        AND NOT EXISTS (
              SELECT 1
              FROM public."Turno" tt
              WHERE tt.barbero_id = c.barbero_id
                AND (%s)
                AND tsrange(
                      tt.inicio,
                      tt.inicio + (tt.duracion_minutos::double precision * '00:01:00'::interval),
                      '[)'
                    ) && tsrange(c.start_ts, c.end_ts, '[)')
            )
    )
    SELECT coalesce(
             jsonb_agg(
               jsonb_build_object(
                 'date', to_char(w.d, 'YYYY-MM-DD'),
                 'day', extract(dow FROM w.d)::int,
                 'slots', coalesce(
                   (
                     SELECT jsonb_agg(
                              jsonb_build_object(
                                'start', to_char(f.start_ts, 'YYYY-MM-DD"T"HH24:MI:SS'),
                                'end', to_char(f.end_ts, 'YYYY-MM-DD"T"HH24:MI:SS'),
                                -- Signed by the Edge Function after the RPC; never persisted.
                                'availabilityToken', ''
                              ) ORDER BY f.start_ts
                            )
                     FROM free f
                     WHERE f.d = w.d
                   ),
                   '[]'::jsonb
                 )
               ) ORDER BY w.d
             ),
             '[]'::jsonb
           )
    FROM win w
  $slot$, v_pred);

  EXECUTE v_sql
    INTO v_days
    USING v_now, v_win_end, v_service.duracion, p_slug, v_today;

  -- 3.6 ID-free response: the resolved service plus the 14-day window.
  RETURN jsonb_build_object(
    'service', jsonb_build_object(
      'publicServiceToken', p_service_token,
      'name', v_service.nombre,
      'durationMinutes', to_jsonb(v_service.duracion),
      'price', to_jsonb(v_service.precio),
      'description', v_service.descripcion
    ),
    'days', v_days
  );
END;
$$;

-- 4. BloqueoHorario boundaries are both-or-neither: a full-day block has both
--    times NULL and a partial block has both present. The availability predicate
--    above fails closed on a half-defined row; this CHECK is defense-in-depth
--    that makes that invalid state unrepresentable. Safe on current data:
--    production holds only full-day and partial rows.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'bloqueohorario_horas_completas'
      AND conrelid = 'public."BloqueoHorario"'::regclass
  ) THEN
    ALTER TABLE public."BloqueoHorario"
      ADD CONSTRAINT bloqueohorario_horas_completas
      CHECK ((hora_inicio IS NULL) = (hora_fin IS NULL));
  END IF;
END $$;

-- 5. Lock down RPC execution: only service_role (server-side Edge Functions) may invoke.
REVOKE EXECUTE ON FUNCTION public.public_catalog(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_catalog(text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.public_availability(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_availability(text, text) TO service_role;

-- 6. Read-only probe (no schema effect): the effective grants must show
--    service_role = true and anon/authenticated = false for both RPCs.
SELECT p.proname AS function_name,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('public_catalog', 'public_availability')
ORDER BY p.proname;

COMMIT;
