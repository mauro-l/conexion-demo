-- pgTAP battery for the phase19 fail-closed hardening of
-- public.public_crear_turno (ODD task F2).
--
-- Run from the repository root:
--   npm run test:db -- supabase/tests/public_crear_turno_fail_closed.sql
--
-- Prerequisite: the target database must already carry the phase19 migration
-- (phase19_crear_turno_fail_closed.sql) on top of phase15. The assertions
-- below pin the HARDENED behavior, so case (a) fails against an unpatched
-- phase15 body -- that failure is the point: it proves the guard was open.
--
-- The whole battery runs in a single transaction that is rolled back at the
-- end, so it never mutates ambient rows: the shop, barbers, services, clients
-- and appointments are fixtures created here and discarded with the rollback.
--
-- Determinism: the slot under test is today+7 at 10:00 local time -- inside
-- the 14-day window, past the 30-minute lead time, on the :00/:30 grid -- and
-- every barber/shop fixture works all seven days, so no assertion depends on
-- what weekday the suite happens to run.

begin;
\set ON_ERROR_STOP on

-- 1. One RPC caller for the 10-argument booking signature.
create function pg_temp.crear(
  p_slug text, p_token text, p_inicio timestamp, p_ikey text, p_email text,
  p_mhash text, p_phone text
) returns jsonb
language sql as $$
  select public.public_crear_turno(
    p_slug, p_token, p_inicio,
    'Falla', 'Cerrada', p_phone, p_phone, p_email, p_mhash, p_ikey)
$$;

-- 2. Clock anchor, then fixtures.
select (clock_timestamp() at time zone 'America/Argentina/Buenos_Aires')::date as today,
       (clock_timestamp() at time zone 'America/Argentina/Buenos_Aires')::date + 7 as target,
       -- Per-run 64-hex management token hashes. token_hash is globally unique,
       -- so fixed literals could collide with ambient rows in a shared local
       -- stack; md5 pairs are hex and always match ^[a-f0-9]{64}$.
       md5('f19a' || random()::text) || md5('f19b' || clock_timestamp()::text) as h_nulldias,
       md5('f19c' || random()::text) || md5('f19d' || clock_timestamp()::text) as h_ok,
       md5('f19e' || random()::text) || md5('f19f' || clock_timestamp()::text) as h_nullopen
\gset

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
values ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'pgtap-fail-closed@example.com', now(), now(), now())
on conflict (id) do nothing;

-- Shop works every day, 09:00-20:00, serving area 11 only.
insert into public."Barberia" (nombre, public_slug, publicado, dias_habiles, hora_apertura, hora_cierre,
                               codigos_area_permitidos)
values ('PgTAP FailClosed', 'pgtap-fail-closed', true, '{0,1,2,3,4,5,6}', '09:00', '20:00', ARRAY['11'])
returning id as f_shop \gset

-- Healthy barber: full schedule, the control case.
insert into public."Barbero" (nombre, users_id, activo, barberia_id, dias_habiles, hora_apertura, hora_cierre)
values ('PgTAP Healthy', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', true, :f_shop,
        '{0,1,2,3,4,5,6}', '09:00', '20:00')
returning id as f_barber_ok \gset

-- Hardening target: days array holding a NULL element. The array itself is NOT
-- NULL, so guard 3.5 passes and only the hardened 3.7 can reject the booking.
insert into public."Barbero" (nombre, users_id, activo, barberia_id, dias_habiles, hora_apertura, hora_cierre)
values ('PgTAP NullDay', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', true, :f_shop,
        '{NULL}', '09:00', '20:00')
returning id as f_barber_nulldias \gset

-- Pre-existing 3.5 behavior: NULL opening time is not bookable.
insert into public."Barbero" (nombre, users_id, activo, barberia_id, dias_habiles, hora_apertura, hora_cierre)
values ('PgTAP NullOpen', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', true, :f_shop,
        '{0,1,2,3,4,5,6}', NULL, '20:00')
returning id as f_barber_nullopen \gset

insert into public."Servicio" (nombre, duracion, precio, descripcion, barbero_id)
values ('PgTAP FC 30 ok', 30, 1000, 'fc-ok', :f_barber_ok)
returning public_service_token as f_tok_ok \gset

insert into public."Servicio" (nombre, duracion, precio, descripcion, barbero_id)
values ('PgTAP FC 30 nullday', 30, 1000, 'fc-nullday', :f_barber_nulldias)
returning public_service_token as f_tok_nulldias \gset

insert into public."Servicio" (nombre, duracion, precio, descripcion, barbero_id)
values ('PgTAP FC 30 nullopen', 30, 1000, 'fc-nullopen', :f_barber_nullopen)
returning public_service_token as f_tok_nullopen \gset

select plan(7);

-- 3a. Days array with a NULL element: guard 3.5 passes (array is not NULL),
--     the hardened 3.7 must reject with OUTSIDE_WORKING_HOURS and insert
--     nothing. Against the unpatched phase15 body this booking SUCCEEDS, so a
--     failure here means the hardening is missing, not that the test is wrong.
select pg_temp.crear('pgtap-fail-closed', :'f_tok_nulldias',
                     ((:'target' || 'T10:00:00')::timestamp),
                     'f19-nulldias-1', 'f19-nulldias@example.com',
                     :'h_nulldias', '+5491155550011') as r_nulldias \gset
select is(:'r_nulldias'::jsonb->'error'->>'code', 'OUTSIDE_WORKING_HOURS',
          'null-element days: rejected with OUTSIDE_WORKING_HOURS');
select is((select count(*) from public."Turno" where barbero_id = :f_barber_nulldias)::int, 0,
          'null-element days: no Turno row was created');

-- 3b. Happy path with a complete schedule and a valid in-window slot: the
--     hardening must not over-block.
select pg_temp.crear('pgtap-fail-closed', :'f_tok_ok',
                     ((:'target' || 'T10:00:00')::timestamp),
                     'f19-happy-1', 'f19-happy@example.com',
                     :'h_ok', '+5491155550022') as r_ok \gset
select is(:'r_ok'::jsonb->'booking'->>'status', 'confirmado',
          'happy path: booking is confirmed');
select is(:'r_ok'::jsonb->'booking'->>'start', :'target' || 'T10:00:00',
          'happy path: booking starts at the requested slot');
select is((select count(*) from public."Turno" where barbero_id = :f_barber_ok)::int, 1,
          'happy path: exactly one Turno row was created');

-- 3c. NULL opening time: documents the pre-existing 3.5 behavior
--     (SERVICE_NOT_BOOKABLE), unchanged by phase19.
select pg_temp.crear('pgtap-fail-closed', :'f_tok_nullopen',
                     ((:'target' || 'T10:00:00')::timestamp),
                     'f19-nullopen-1', 'f19-nullopen@example.com',
                     :'h_nullopen', '+5491155550033') as r_nullopen \gset
select is(:'r_nullopen'::jsonb->'error'->>'code', 'SERVICE_NOT_BOOKABLE',
          'null opening: rejected with SERVICE_NOT_BOOKABLE');
select is((select count(*) from public."Turno" where barbero_id = :f_barber_nullopen)::int, 0,
          'null opening: no Turno row was created');

select * from finish();
rollback;
