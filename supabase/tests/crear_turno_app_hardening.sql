-- pgTAP battery for the phase20 app hardening of public.crear_turno (ODD F3).
--
-- Run from the repository root:
--   SUPABASE_TEST_NETWORK=supabase_network_conexion-db npm run test:db -- supabase/tests/crear_turno_app_hardening.sql
-- (Without that var the runner cannot resolve host "db": the stack was
-- started from another project directory. See odd/tasks/f2-crear-turno-fail-closed.md.)
--
-- Prerequisite: the target database must already carry the phase20 forward
-- migration (phase20_crear_turno_app_hardening.sql). The assertions below pin
-- the HARDENED behavior, so cases (a)-(f) fail against the live pre-phase20
-- body -- that failure is the point: it proves the guard was open.
--
-- The whole battery runs in a single transaction that is rolled back at the
-- end, so it never mutates ambient rows: every shop, barber, service, client,
-- appointment and block is a fixture created here and discarded with the
-- rollback.
--
-- AUTH TECHNIQUE: public.crear_turno reads auth.uid(), which resolves
-- request.jwt.claim.sub first. Each case fakes one fixture barber with
--   SET LOCAL "request.jwt.claim.sub" = '<fixture users_id>'
-- RLS is bypassed because the test runner role is a superuser; only
-- auth.uid() needs faking.
--
-- Determinism: the slot under test is today+7 at 10:00 -- inside the
-- 09:00-20:00 fixture window -- and every happy-path fixture works all seven
-- days, so no assertion depends on what weekday the suite happens to run.
-- The non-working-weekday case derives its dias array from the target date
-- itself (the one dow the target is NOT), so it rejects on any run weekday.

begin;
\set ON_ERROR_STOP on

-- 1. One caller for the 7-argument app signature. Returns 'OK:<id>:<estado>:
--    <origen>:<duracion>' on success, 'ERR:<sqlstate>:<message>' on reject, so
--    both the code token and the absence of a row are assertable.
create function pg_temp.try_crear(
  p_svc bigint, p_ini timestamp, p_org text, p_tel text
) returns text
language plpgsql as $$
declare
  v_t public."Turno";
begin
  select * into v_t from public.crear_turno(
    p_svc, p_ini, p_org, 'Nombre', 'Apellido', p_tel, '+54 9 11 5555-0011');
  return 'OK:' || v_t.id::text || ':' || v_t.estado::text || ':' || v_t.origen
         || ':' || v_t.duracion_minutos::text;
exception when others then
  return 'ERR:' || SQLSTATE || ':' || SQLERRM;
end $$;

-- 2. Clock anchor, fake users, then fixtures.
select (clock_timestamp() at time zone 'America/Argentina/Buenos_Aires')::date as today,
       (clock_timestamp() at time zone 'America/Argentina/Buenos_Aires')::date + 7 as target,
       'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380b01' as uid_ok,
       'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380b02' as uid_mon,
       'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380b03' as uid_nullsched,
       'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380b04' as uid_emptywin
\gset

-- The one weekday the target date is NOT: guarantees a non-working day on any
-- run weekday.
select '{' || ((extract(dow from :'target'::date)::int + 1) % 7) || '}' as dias_off \gset

-- Barbero.users_id carries FK emprendedor_users_id_fkey to auth.users, so the
-- fake users must exist (mirrors public_availability.sql).
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
values ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380b01', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'pgtap-ah-ok@example.com', now(), now(), now()),
       ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380b02', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'pgtap-ah-mon@example.com', now(), now(), now()),
       ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380b03', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'pgtap-ah-nullsched@example.com', now(), now(), now()),
       ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380b04', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'pgtap-ah-emptywin@example.com', now(), now(), now())
on conflict (id) do nothing;

insert into public."Barberia" (nombre, publicado, dias_habiles, hora_apertura, hora_cierre)
values ('PgTAP AppHardening', true, '{0,1,2,3,4,5,6}', '09:00', '20:00')
returning id as f_shop \gset

-- Narrow shop for the empty-effective-window case (09:00-12:00 vs an
-- 18:00-20:00 barber: greatest open 18:00 >= least close 12:00).
insert into public."Barberia" (nombre, publicado, dias_habiles, hora_apertura, hora_cierre)
values ('PgTAP AppHardening Narrow', true, '{0,1,2,3,4,5,6}', '09:00', '12:00')
returning id as f_shop_narrow \gset

insert into public."Barbero" (nombre, users_id, activo, barberia_id, dias_habiles, hora_apertura, hora_cierre)
values ('PgTAP AH ok', :'uid_ok', true, :f_shop,
        '{0,1,2,3,4,5,6}', '09:00', '20:00')
returning id as f_barber_ok \gset

insert into public."Barbero" (nombre, users_id, activo, barberia_id, dias_habiles, hora_apertura, hora_cierre)
values ('PgTAP AH mondayless', :'uid_mon', true, :f_shop,
        :'dias_off', '09:00', '20:00')
returning id as f_barber_mon \gset

insert into public."Barbero" (nombre, users_id, activo, barberia_id, dias_habiles, hora_apertura, hora_cierre)
values ('PgTAP AH nullsched', :'uid_nullsched', true, :f_shop,
        '{0,1,2,3,4,5,6}', NULL, '20:00')
returning id as f_barber_nullsched \gset

insert into public."Barbero" (nombre, users_id, activo, barberia_id, dias_habiles, hora_apertura, hora_cierre)
values ('PgTAP AH emptywin', :'uid_emptywin', true, :f_shop_narrow,
        '{0,1,2,3,4,5,6}', '18:00', '20:00')
returning id as f_barber_emptywin \gset

insert into public."Servicio" (nombre, duracion, precio, descripcion, barbero_id)
values ('PgTAP AH 30 ok', 30, 1000, 'ah-ok', :f_barber_ok)
returning id as f_svc_ok \gset

insert into public."Servicio" (nombre, duracion, precio, descripcion, barbero_id)
values ('PgTAP AH null dur', NULL, 1000, 'ah-nulldur', :f_barber_ok)
returning id as f_svc_null \gset

insert into public."Servicio" (nombre, duracion, precio, descripcion, barbero_id)
values ('PgTAP AH 30 mon', 30, 1000, 'ah-mon', :f_barber_mon)
returning id as f_svc_mon \gset

insert into public."Servicio" (nombre, duracion, precio, descripcion, barbero_id)
values ('PgTAP AH 30 nullsched', 30, 1000, 'ah-nullsched', :f_barber_nullsched)
returning id as f_svc_nullsched \gset

insert into public."Servicio" (nombre, duracion, precio, descripcion, barbero_id)
values ('PgTAP AH 30 emptywin', 30, 1000, 'ah-emptywin', :f_barber_emptywin)
returning id as f_svc_emptywin \gset

select plan(15);

-- 3a. NULL phone is rejected. Against the pre-phase20 body this booking
--     SUCCEEDS (the CHECK allows NULL), so a failure here means the
--     hardening is missing, not that the test is wrong.
set local "request.jwt.claim.sub" = :'uid_ok';
select ok(
  (pg_temp.try_crear(:f_svc_ok, ((:'target' || 'T10:00:00')::timestamp), 'presencial', NULL)) ~~ 'ERR:P0001:%TELEFONO_INVALIDO%', 'null phone: rejected with TELEFONO_INVALIDO');

-- 3b. Blank and off-pattern phones are rejected with the same code (the
--     pattern mirrors cliente_telefono_formato_chk).
select ok(
  (pg_temp.try_crear(:f_svc_ok, ((:'target' || 'T10:00:00')::timestamp), 'presencial', '   ')) ~~ 'ERR:P0001:%TELEFONO_INVALIDO%', 'blank phone: rejected with TELEFONO_INVALIDO');
select ok(
  (pg_temp.try_crear(:f_svc_ok, ((:'target' || 'T10:00:00')::timestamp), 'presencial', '1155550011')) ~~ 'ERR:P0001:%TELEFONO_INVALIDO%', 'off-pattern phone: rejected with TELEFONO_INVALIDO');

-- 3c. origen 'web' no longer belongs to the app surface.
select ok(
  (pg_temp.try_crear(:f_svc_ok, ((:'target' || 'T10:00:00')::timestamp), 'web', '+5491155550011')) ~~ 'ERR:P0001:%ORIGEN_INVALIDO%', 'origen web: rejected with ORIGEN_INVALIDO');

-- 3d. NULL service duration is not bookable (was silently COALESCE to 30).
select ok(
  (pg_temp.try_crear(:f_svc_null, ((:'target' || 'T10:00:00')::timestamp), 'presencial', '+5491155550011')) ~~ 'ERR:P0001:%SERVICIO_NO_RESERVABLE%', 'null duration: rejected with SERVICIO_NO_RESERVABLE');

-- 3e. Non-working weekday: the fixture barber works every day EXCEPT the
--     target's own weekday.
set local "request.jwt.claim.sub" = :'uid_mon';
select ok(
  (pg_temp.try_crear(:f_svc_mon, ((:'target' || 'T10:00:00')::timestamp), 'presencial', '+5491155550011')) ~~ 'ERR:P0001:%FUERA_DE_HORARIO%', 'non-working weekday: rejected with FUERA_DE_HORARIO');

-- 3f. NULL barber schedule (hora_apertura NULL) fails closed.
set local "request.jwt.claim.sub" = :'uid_nullsched';
select ok(
  (pg_temp.try_crear(:f_svc_nullsched, ((:'target' || 'T10:00:00')::timestamp), 'presencial', '+5491155550011')) ~~ 'ERR:P0001:%HORARIO_NO_CONFIGURADO%', 'null barber schedule: rejected with HORARIO_NO_CONFIGURADO');

-- 3g. Empty effective window (barber 18:00-20:00 inside a 09:00-12:00 shop).
set local "request.jwt.claim.sub" = :'uid_emptywin';
select ok(
  (pg_temp.try_crear(:f_svc_emptywin, ((:'target' || 'T10:00:00')::timestamp), 'presencial', '+5491155550011')) ~~ 'ERR:P0001:%FUERA_DE_HORARIO%', 'empty effective window: rejected with FUERA_DE_HORARIO');

-- 3h. Inside the window but outside it: 07:00 starts before the 09:00 open.
set local "request.jwt.claim.sub" = :'uid_ok';
select ok(
  (pg_temp.try_crear(:f_svc_ok, ((:'target' || 'T07:00:00')::timestamp), 'presencial', '+5491155550011')) ~~ 'ERR:P0001:%FUERA_DE_HORARIO%', 'outside effective window: rejected with FUERA_DE_HORARIO');

-- 3i. Full-day block on the target date rejects, and inserts nothing.
insert into public."BloqueoHorario" (barbero_id, fecha, hora_inicio, hora_fin, motivo)
values (:f_barber_ok, :'target'::date, null, null, 'pgtap apphardening full day');
select ok(
  (pg_temp.try_crear(:f_svc_ok, ((:'target' || 'T10:00:00')::timestamp), 'presencial', '+5491155550011')) ~~ 'ERR:P0001:%HORARIO_BLOQUEADO%', 'blocked slot: rejected with HORARIO_BLOQUEADO');
select is((select count(*) from public."Turno" where barbero_id = :f_barber_ok)::int, 0,
          'blocked slot: no Turno row was created');
delete from public."BloqueoHorario" where motivo = 'pgtap apphardening full day';

-- 3j. Happy path with sane data still books: confirmado, presencial, 30 min.
select pg_temp.try_crear(:f_svc_ok, ((:'target' || 'T10:00:00')::timestamp), 'presencial', '+5491155550011') as r_ok \gset
select ok((:'r_ok' ~~ 'OK:%:confirmado:presencial:30'),
           'happy path: booking is confirmado, presencial, 30 minutes');
select is((select count(*) from public."Turno" where barbero_id = :f_barber_ok)::int, 1,
          'happy path: exactly one Turno row was created');
select is((select telefono_normalizado from public."Cliente"
           where id = (select cliente_id from public."Turno" where barbero_id = :f_barber_ok)),
          '+5491155550011', 'happy path: the canonical phone was stored');

-- 3k. None of the rejects above left a Turno behind: only the happy path did.
select is((select count(*) from public."Turno"
           where barbero_id in (:f_barber_ok, :f_barber_mon, :f_barber_nullsched, :f_barber_emptywin))::int,
          1, 'rejects created no Turno rows');

select * from finish();
rollback;
