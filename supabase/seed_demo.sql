-- Seed: supabase/seed_demo.sql
-- Purpose: idempotent demo data for one published barbershop, one active barber,
--          and the four services shown in the HTML prototypes.
--
-- PREREQUISITE / BLOCKER:
--   Barbero.users_id is uuid NOT NULL and references auth.users(id).
--   This seed therefore requires an auth.users row for the demo barber.
--   The block below tries to create a deterministic demo user idempotently.
--   If your Supabase project forbids direct auth.users inserts (schema drift,
--   least-privilege roles, etc.), create the user via the Supabase Dashboard
--   or Auth Admin API first, note its UUID, and replace the email references
--   below before running this seed.
--   The orchestrator must verify the demo user exists before the Barbero insert
--   can succeed; the second DO block fails loudly if it does not.

DO $$
DECLARE
  demo_user_id uuid := 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
BEGIN
  -- Best-effort idempotent demo auth user. No login is intended; the password
  -- column is omitted because Supabase auth accepts NULL for magic-link/OAuth
  -- users. If your project requires a value, create the user externally.
  INSERT INTO auth.users (
    id,
    email,
    email_confirmed_at,
    created_at,
    updated_at
  ) VALUES (
    demo_user_id,
    'demo.barbero@example.com',
    now(),
    now(),
    now()
  )
  ON CONFLICT (email) DO NOTHING;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not create demo auth user: %. '
    'Create the user via Supabase Dashboard or Auth Admin API, then re-run this seed.',
    SQLERRM;
END $$;

-- Fail loudly if the prerequisite auth user is missing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM auth.users WHERE email = 'demo.barbero@example.com'
  ) THEN
    RAISE EXCEPTION
      'Demo auth user demo.barbero@example.com does not exist. '
      'Create it via Supabase Dashboard or Auth Admin API and re-run this seed.';
  END IF;
END $$;

-- 1. Demo barbershop.
INSERT INTO public."Barberia" (
  nombre,
  public_slug,
  description,
  direccion,
  horario_publico,
  whatsapp_url,
  instagram_handle,
  instagram_url,
  publicado,
  dias_habiles,
  hora_apertura,
  hora_cierre
) VALUES (
  'Conexión Barbería',
  'conexion-barberia',
  'Barbería de demostración para la web pública.',
  'Av. Gral. Mosconi 3429, C1419, CABA',
  'Hoy 10:00–20:00',
  '#',
  '@conexion.barber',
  'https://instagram.com/conexion.barber',
  true,
  ARRAY[1,2,3,4,5,6]::int2[],
  '09:00'::time,
  '20:00'::time
)
ON CONFLICT (public_slug) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  description = EXCLUDED.description,
  direccion = EXCLUDED.direccion,
  horario_publico = EXCLUDED.horario_publico,
  whatsapp_url = EXCLUDED.whatsapp_url,
  instagram_handle = EXCLUDED.instagram_handle,
  instagram_url = EXCLUDED.instagram_url,
  publicado = EXCLUDED.publicado,
  dias_habiles = EXCLUDED.dias_habiles,
  hora_apertura = EXCLUDED.hora_apertura,
  hora_cierre = EXCLUDED.hora_cierre;

-- 2. Demo active barber.
WITH barberia_row AS (
  SELECT id FROM public."Barberia" WHERE public_slug = 'conexion-barberia'
)
INSERT INTO public."Barbero" (
  nombre,
  alias,
  descripcion,
  duracion_default,
  precio_base,
  foto_url,
  activo,
  barberia_id,
  users_id,
  dias_habiles,
  hora_apertura,
  hora_cierre
)
SELECT
  'Juan Pérez',
  'Juan',
  'Especialista en cortes clásicos y modernos.',
  30,
  1000,
  'https://picsum.photos/seed/conexionbarber/900/675',
  true,
  b.id,
  u.id,
  ARRAY[1,2,3,4,5,6]::int2[],
  '09:00'::time,
  '20:00'::time
FROM barberia_row b
CROSS JOIN auth.users u
WHERE u.email = 'demo.barbero@example.com'
  AND NOT EXISTS (
    SELECT 1 FROM public."Barbero" existing
    WHERE existing.barberia_id = b.id AND existing.users_id = u.id
  );

-- 3. Demo services (matching the HTML prototypes).
WITH demo_barber AS (
  SELECT ba.id AS barbero_id
  FROM public."Barbero" ba
  JOIN public."Barberia" b ON b.id = ba.barberia_id
  JOIN auth.users u ON u.id = ba.users_id
  WHERE b.public_slug = 'conexion-barberia'
    AND u.email = 'demo.barbero@example.com'
)
INSERT INTO public."Servicio" (nombre, duracion, precio, descripcion, barbero_id)
SELECT s.nombre, s.duracion, s.precio, s.descripcion, db.barbero_id
FROM demo_barber db
CROSS JOIN (
  VALUES
    ('Corte de pelo', 40, 23000, 'Incluye asesoría en visagismo, corte de cabello, gaseosa de cortesía y lavado post corte.'),
    ('Corte y barba + toalla caliente', 60, 32000, 'Incluye asesoría en visagismo, corte de cabello, arreglo de barba a máquina, afeitado con toalla caliente y fría, gaseosa y lavado de cabello.'),
    ('Corte y arreglo de barba', 50, 28000, 'Incluye asesoría en visagismo, corte de cabello y arreglo de barba con máquina y afeitado.'),
    ('Barba + toalla caliente', 30, 21000, 'Incluye asesoría en visagismo y afeitado con toallas caliente y fría, más gaseosa de cortesía.')
) AS s(nombre, duracion, precio, descripcion)
WHERE NOT EXISTS (
  SELECT 1
  FROM public."Servicio" existing
  WHERE existing.barbero_id = db.barbero_id
    AND existing.nombre = s.nombre
);
