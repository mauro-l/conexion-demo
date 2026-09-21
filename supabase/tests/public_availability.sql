-- pgTAP integration battery for public.public_availability (SDD task 4.2).
--
-- Run from the repository root:
--   npm run test:db
--
-- The target database must already carry the project schema plus this
-- repository's migrations (phase9..phase12). The whole battery runs in a
-- single transaction that is rolled back at the end, so it never mutates
-- ambient rows: every shop, barber, service, client, appointment and block is a
-- fixture created here and discarded with the rollback.
--
-- Determinism: the 14-day window and the 30-minute lead time come from the
-- database clock in America/Argentina/Buenos_Aires, never from the host clock.
-- `today` drives the lead-time case and `today + 7` (a working day inside the
-- window) drives occupancy, blocks and adjacency, so no assertion depends on
-- what time the suite happens to run.

begin;
\set ON_ERROR_STOP on

-- 1. Helpers: one RPC caller plus pure reads over its response.
create function pg_temp.avail(p_slug text, p_token text) returns jsonb
language sql as $$
  select public.public_availability(p_slug, p_token)
$$;

create function pg_temp.slots_on(p_json jsonb, p_date date) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_agg(s order by s->>'start'), '[]'::jsonb)
  from jsonb_array_elements(p_json->'days') d,
       jsonb_array_elements(d->'slots') s
  where (d->>'date')::date = p_date
$$;

create function pg_temp.slot_count(p_json jsonb, p_date date) returns int
language sql immutable as $$
  select jsonb_array_length(pg_temp.slots_on(p_json, p_date))
$$;

create function pg_temp.has_slot(p_json jsonb, p_start text) returns boolean
language sql immutable as $$
  select exists (
    select 1
    from jsonb_array_elements(p_json->'days') d,
         jsonb_array_elements(d->'slots') s
    where s->>'start' = p_start
  )
$$;

create function pg_temp.total_slots(p_json jsonb) returns int
language sql immutable as $$
  select coalesce(sum(jsonb_array_length(d->'slots')), 0)::int
  from jsonb_array_elements(p_json->'days') d
$$;

-- 1b. Lead-time construction helpers.
--
--     The fixture window (section 2) must be exact-to-the-hour so the 30-minute
--     slot grid stays anchored on :00/:30, and it must never wrap past local
--     midnight in either direction. `hora_apertura`/`hora_cierre` are `time`
--     columns: the cast drops the date, so `date_trunc('hour', now) + 6h` at
--     19:00 becomes 01:00 (behind a 15:00 open) and `date_trunc('hour', now)
--     - 3h` at 02:00 becomes 23:00 (ahead of an 08:00 close). Both cases leave
--     a close earlier than the open, so today has no valid window at all.
--     These helpers clamp the open to 00:00 and the close to 24:00, which makes
--     the wrap impossible while keeping both boundaries on exact hours.
--
--     Section 6b evaluates the same two helpers against every synthetic clock of
--     the local day, so the fixture and its whole-day proof cannot drift apart.
create function pg_temp.lead_open(p_now timestamp) returns time
language sql immutable as $$
  select case
    when date_trunc('hour', p_now) - interval '3 hours' < date_trunc('day', p_now)
      then time '00:00'
      else (date_trunc('hour', p_now) - interval '3 hours')::time
  end
$$;

create function pg_temp.lead_close(p_now timestamp) returns time
language sql immutable as $$
  select case
    when date_trunc('hour', p_now) + interval '6 hours'
         >= date_trunc('day', p_now) + interval '1 day'
      then time '24:00'
      else (date_trunc('hour', p_now) + interval '6 hours')::time
  end
$$;

-- First 30-minute grid step at or after `p_now + 30 minutes`, computed from the
-- grid anchor (the shop open time) the same way the RPC anchors its grid.
create function pg_temp.lead_first(p_now timestamp, p_open time) returns timestamp
language sql immutable as $$
  select date_trunc('day', p_now) + p_open
       + ceil(
           extract(epoch from ((p_now + interval '30 minutes')
                               - (date_trunc('day', p_now) + p_open)))
           / 1800
         ) * interval '30 minutes'
$$;

-- Last start today can hold: the window close minus the service duration.
create function pg_temp.lead_last_start(
  p_now timestamp,
  p_close time,
  p_duration_minutes int
) returns timestamp
language sql immutable as $$
  select date_trunc('day', p_now) + p_close
       - (p_duration_minutes * interval '1 minute')
$$;

-- 2. Clock anchors, then fixtures.
select (clock_timestamp() at time zone 'America/Argentina/Buenos_Aires')::date as today,
       (clock_timestamp() at time zone 'America/Argentina/Buenos_Aires')::date + 7 as target,
       (clock_timestamp() at time zone 'America/Argentina/Buenos_Aires')::date + 13 as last_day,
       (clock_timestamp() at time zone 'America/Argentina/Buenos_Aires') as now_ba,
       clock_timestamp() at time zone 'America/Argentina/Buenos_Aires' as now_ts,
       -- Deterministic lead-time window, derived from the database clock rather
       -- than pinned to 10:00. Both boundaries are clamped to the local day and
       -- floored to exact hours (pg_temp.lead_open/lead_close, section 1b), so
       -- the 30-minute slot grid is anchored on :00 and its first step at or
       -- after `now + 30min` is a stable function of the clock. That flooring
       -- removes a sub-second race: if the grid were anchored on the raw clock
       -- second, a step landing exactly on now+30 could be included or excluded
       -- depending on whether the RPC's `clock_timestamp()` read a few
       -- microseconds later than this one. The window opens three hours before
       -- `now` (never before today 00:00) and closes six hours after it (never
       -- after today 24:00), so the close can never wrap behind the open and
       -- today always yields candidate slots. The one clock where the lead-time
       -- predicate itself is unobservable is the final window before local
       -- midnight: for a 30-minute service whose close is clamped to 24:00, the
       -- last start today can hold is 23:30, so once `now + 30min` passes 23:30
       -- no today start can satisfy the rule. Section 6 classifies that window
       -- as an explicit skip, and section 6b proves the construction over every
       -- hour of the local day.
       pg_temp.lead_open(clock_timestamp() at time zone 'America/Argentina/Buenos_Aires') as lt_open,
       pg_temp.lead_close(clock_timestamp() at time zone 'America/Argentina/Buenos_Aires') as lt_close,
       (select count(*) from public."Turno") as turnos0,
       (select count(*) from public."Cliente") as clientes0
\gset

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
values ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'pgtap-availability@example.com', now(), now(), now())
on conflict (id) do nothing;

insert into public."Barberia" (nombre, public_slug, publicado, dias_habiles, hora_apertura, hora_cierre)
values ('PgTAP Availability', 'pgtap-availability', true, '{0,1,2,3,4,5,6}', '09:00', '20:00')
returning id as f_shop \gset

insert into public."Barbero" (nombre, users_id, activo, barberia_id, dias_habiles, hora_apertura, hora_cierre)
values ('PgTAP Barber', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', true, :f_shop,
        '{0,1,2,3,4,5,6}', '09:00', '20:00')
returning id as f_barber \gset

insert into public."Servicio" (nombre, duracion, precio, descripcion, barbero_id)
values ('PgTAP 30', 30, 1000, 'pg-thirty', :f_barber)
returning id as f_svc30, public_service_token as f_tok30 \gset

insert into public."Servicio" (nombre, duracion, precio, descripcion, barbero_id)
values ('PgTAP 60', 60, 2000, 'pg-sixty', :f_barber)
returning public_service_token as f_tok60 \gset

insert into public."Servicio" (nombre, duracion, precio, descripcion, barbero_id)
values ('PgTAP null', null, null, null, :f_barber)
returning public_service_token as f_toknull \gset

-- A second published shop: a token resolves only inside its own shop.
insert into public."Barberia" (nombre, public_slug, publicado, dias_habiles, hora_apertura, hora_cierre)
values ('PgTAP Other', 'pgtap-other', true, '{1}', '09:00', '17:00')
returning id as f_shop2 \gset

insert into public."Barbero" (nombre, users_id, activo, barberia_id, dias_habiles, hora_apertura, hora_cierre)
values ('PgTAP Other Barber', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', true, :f_shop2,
        '{1}', '09:00', '17:00')
returning id as f_barber2 \gset

insert into public."Servicio" (nombre, duracion, precio, descripcion, barbero_id)
values ('PgTAP Other Service', 30, 500, null, :f_barber2)
returning public_service_token as f_tokother \gset

insert into public."Cliente" (nombre, telefono, barberia_id)
values ('PgTAP Client', 1155550000, :f_shop)
returning id as f_client \gset

select plan(79);

-- 3. Valid read: window, day numbering, ID-free DTO, computable slot grid.
select pg_temp.avail('pgtap-availability', :'f_tok30') as a30 \gset
select (select d from jsonb_array_elements(:'a30'::jsonb->'days') d
        where (d->>'date')::date = :'target'::date) as a30day \gset
select (select s from jsonb_array_elements(:'a30day'::jsonb->'slots') s limit 1) as a30slot \gset

select is(jsonb_array_length(:'a30'::jsonb->'days'), 14, 'valid read: exactly 14 days');
select is(:'a30'::jsonb->'days'->0->>'date', :'today', 'valid read: first day is today');
select is(:'a30'::jsonb->'days'->13->>'date', :'last_day', 'valid read: last day is today+13');
select is((select count(*) from jsonb_array_elements(:'a30'::jsonb->'days') d
           where (d->>'date')::date > :'last_day'::date)::int, 0, 'valid read: today+14 is excluded');
select is((select count(*) from jsonb_array_elements(:'a30'::jsonb->'days') d
           where (d->>'day')::int <> extract(dow from (d->>'date')::date)::int)::int, 0,
          'valid read: day is extract(dow), 0=Sunday..6=Saturday');
select is((select count(*) from jsonb_object_keys(:'a30'::jsonb->'service'))::int, 5,
          'valid read: service DTO exposes exactly five fields');
select is(:'a30'::jsonb->'service'->>'publicServiceToken', :'f_tok30', 'valid read: token echoed');
select is(:'a30'::jsonb->'service'->>'name', 'PgTAP 30', 'valid read: name comes from the database');
select is((:'a30'::jsonb->'service'->>'durationMinutes')::numeric, 30::numeric,
          'valid read: duration comes from the database');
select is((:'a30'::jsonb->'service'->>'price')::numeric, 1000::numeric,
          'valid read: price comes from the database');
select is(:'a30'::jsonb->'service'->>'description', 'pg-thirty',
          'valid read: description comes from the database');
select is(:'a30'::jsonb->'service' ? 'id', false, 'valid read: service DTO exposes no id');
select is((select count(*) from jsonb_object_keys(:'a30day'::jsonb))::int, 3,
          'valid read: day exposes date, day, slots');
select is((select count(*) from jsonb_object_keys(:'a30slot'::jsonb))::int, 3,
          'valid read: slot exposes start, end, availabilityToken');
select is(:'a30slot'::jsonb->>'availabilityToken', '',
          'valid read: the RPC leaves the token blank for the Edge to sign');
select is(pg_temp.slot_count(:'a30'::jsonb, :'target'::date), 22,
          'valid read: 22 half-hour starts on a full working day');
select is((select count(*) from jsonb_array_elements(:'a30'::jsonb->'days') d,
                  jsonb_array_elements(d->'slots') s
           where (s->>'end')::timestamp <> (s->>'start')::timestamp + interval '30 minutes')::int, 0,
          'valid read: every slot spans exactly the service duration');
select is((select count(*) from jsonb_array_elements(:'a30'::jsonb->'days') d,
                  jsonb_array_elements(d->'slots') s
           where extract(minute from (s->>'start')::timestamp)::int % 30 <> 0)::int, 0,
          'valid read: starts land on the 30-minute grid');
select is(pg_temp.has_slot(:'a30'::jsonb, :'last_day' || 'T09:00:00'), true,
          'valid read: today+13 is eligible');

-- 4. Unknown and malformed input fails closed without leaking a schedule.
select is(pg_temp.avail('pgtap-availability', '00000000000000000000000000000000')->'error'->>'code',
          'PUBLIC_RESOURCE_NOT_FOUND', 'malformed input: unknown token is not found');
select is(pg_temp.avail('pgtap-availability', '00000000000000000000000000000000') ? 'days', false,
          'malformed input: unknown token exposes no days');
select is(pg_temp.avail('no-such-shop', :'f_tok30')->'error'->>'code', 'PUBLIC_RESOURCE_NOT_FOUND',
          'malformed input: unknown slug is not found');
select is(pg_temp.avail('pgtap-other', :'f_tok30')->'error'->>'code', 'PUBLIC_RESOURCE_NOT_FOUND',
          'malformed input: a token does not resolve inside another shop');
update public."Barberia" set publicado = false where id = :f_shop;
select is(pg_temp.avail('pgtap-availability', :'f_tok30')->'error'->>'code', 'PUBLIC_RESOURCE_NOT_FOUND',
          'malformed input: an unpublished shop is not found');
update public."Barberia" set publicado = true where id = :f_shop;
update public."Barbero" set activo = false where id = :f_barber;
select is(pg_temp.avail('pgtap-availability', :'f_tok30')->'error'->>'code', 'PUBLIC_RESOURCE_NOT_FOUND',
          'malformed input: an inactive barber is not found');
update public."Barbero" set activo = true where id = :f_barber;

-- 5. Window boundary: a slot ending exactly at today+14 midnight is excluded.
update public."Barberia" set hora_cierre = '24:00' where id = :f_shop;
update public."Barbero" set hora_cierre = '24:00' where id = :f_barber;
select pg_temp.avail('pgtap-availability', :'f_tok60') as a60win \gset
select is(pg_temp.has_slot(:'a60win'::jsonb, :'last_day' || 'T23:00:00'), false,
          'window boundary: a slot ending exactly at today+14 midnight is excluded');
select is(pg_temp.has_slot(:'a60win'::jsonb, :'last_day' || 'T22:30:00'), true,
          'window boundary: the last slot strictly inside the window survives');
select is(pg_temp.has_slot(:'a60win'::jsonb, :'target' || 'T23:00:00'), true,
          'window boundary: the same 23:00 start survives on a non-final date');
select is((select count(*) from jsonb_array_elements(:'a60win'::jsonb->'days') d,
                  jsonb_array_elements(d->'slots') s
           where (s->>'end')::timestamp >= (:'last_day'::date + 1)::timestamp)::int, 0,
          'window boundary: no slot ends at or after the exclusive window end');
update public."Barberia" set hora_cierre = '20:00' where id = :f_shop;
update public."Barbero" set hora_cierre = '20:00' where id = :f_barber;

-- 6. Lead time: today never offers a start before now+30 minutes, and the
--    first today start sits exactly on the first 30-minute grid step at or
--    after now+30. The shop is opened before `now` (section 2) so today always
--    has candidate slots, and the lead-time assertions below are deliberately
--    *not* guarded: a construction that produced no eligible today slots fails
--    the non-vacuity guard loudly. The single exception is the documented final
--    window before local midnight (section 6b), where no eligible today start
--    can exist at all and the case is reported as an explicit `skip`.
update public."Barberia" set hora_apertura = :'lt_open', hora_cierre = :'lt_close' where id = :f_shop;
update public."Barbero"  set hora_apertura = :'lt_open', hora_cierre = :'lt_close' where id = :f_barber;

select count(*) as lt_today_slots
from jsonb_array_elements(pg_temp.slots_on(pg_temp.avail('pgtap-availability', :'f_tok30'), :'today'::date)) s
\gset

select coalesce(min(s->>'start'), '') as first_today
from jsonb_array_elements(pg_temp.slots_on(pg_temp.avail('pgtap-availability', :'f_tok30'), :'today'::date)) s
\gset

-- The expected first step and the last start today can hold are computed from the
-- same anchor the fixture uses (`lt_open`, section 2). With `open < now`, the first
-- step at or after now+30 is always at least one step past the anchor, so `ceil`
-- cannot return a step that precedes now+30.
select pg_temp.lead_first(:'now_ts'::timestamp, :'lt_open'::time) as lt_expected_first,
       pg_temp.lead_last_start(:'now_ts'::timestamp, :'lt_close'::time, 30) as lt_last_start
\gset

-- Unprovable-window classifier. With the close clamped to 24:00 and a 30-minute
-- service, the last today start is 23:30; once `now + 30min` is past that start
-- there is no today candidate at all, so neither the rule nor its violation can be
-- observed at this clock. The first conjunct is the important one: a derivation whose
-- close is not after its open is a *broken construction*, not an unprovable clock, so
-- it falls through to the loud non-vacuity guard instead of skipping. Outside this
-- documented window the guard still fires, and section 6b proves the classification
-- across all 48 synthetic clocks of the local day.
select (:'lt_close'::time > :'lt_open'::time
        and :'lt_expected_first'::timestamp > :'lt_last_start'::timestamp) as lt_unprovable \gset

\if :lt_unprovable
select skip('lead time: unprovable in the final window before local midnight (clamped close 24:00 minus the 30-minute service leaves 23:30 as the last today start, so now+30 no longer fits inside today); the non-vacuity guard stays armed for every other clock', 3);
\else
-- Guard: the construction must yield at least one today slot. If it does not,
-- a later assertion could pass without exercising the predicate; this check
-- makes that outcome a hard failure instead.
select ok(
  :'lt_today_slots'::int > 0,
  'lead time: the construction yields at least one eligible today slot (non-vacuous)');

select is((select count(*) from jsonb_array_elements(pg_temp.slots_on(pg_temp.avail('pgtap-availability', :'f_tok30'), :'today'::date)) s
           where (s->>'start')::timestamp < :'now_ts'::timestamp + interval '30 minutes')::int, 0,
          'lead time: no today slot starts before now+30 minutes');

select is(
  :'first_today',
  to_char(:'lt_expected_first'::timestamp, 'YYYY-MM-DD"T"HH24:MI:SS'),
  'lead time: the earliest today slot is the first grid step at or after now+30 minutes');
\endif

-- The predicate still applies after the shop closes: a clock-derived window
-- whose open time is today but whose candidates all fall before now must yield
-- no today slots. This is the complement of the non-vacuity guard above and holds
-- at every clock, including the skipped pre-midnight window.
update public."Barberia" set hora_apertura = '00:00', hora_cierre = '00:30' where id = :f_shop;
select is(pg_temp.slot_count(pg_temp.avail('pgtap-availability', :'f_tok30'), :'today'::date), 0,
          'lead time: a window entirely before now yields no today slots');
update public."Barberia" set hora_apertura = :'lt_open', hora_cierre = :'lt_close' where id = :f_shop;

-- 6b. Whole-day construction sweep (hour-independent proof).
--
--     The defect this guards against: the fixture window used to be
--     `date_trunc('hour', now) - 3h` .. `+ 6h`, moved verbatim into `time` columns.
--     Both ends cross local midnight for part of the day and the `time` cast drops
--     the date, so the close could land *before* the open (at 19:00: open 16:00,
--     close 01:00) or the open *after* the close (at 02:00: open 23:00, close
--     08:00). Today then had zero candidates: the suite failed loudly under the
--     non-vacuity guard, but before that guard existed it passed vacuously, and a
--     single-hour verification could not see it either way. This block evaluates
--     the same construction helpers against 48 synthetic local clocks - every hour
--     of the day at :00 and :30 - and asserts the derived window never wraps and
--     always leaves an eligible today start, with the documented final window
--     before midnight classified as a skip.
create temp table lt_sweep as
select syn.ts,
       pg_temp.lead_open(syn.ts)  as open_t,
       pg_temp.lead_close(syn.ts) as close_t,
       pg_temp.lead_first(syn.ts, pg_temp.lead_open(syn.ts)) as expected_first,
       pg_temp.lead_last_start(syn.ts, pg_temp.lead_close(syn.ts), 30) as last_start
from (
  select date_trunc('day', :'now_ts'::timestamp)
         + make_interval(hours => h, mins => m) as ts
  from generate_series(0, 23) as h
  cross join (values (0), (30)) as off(m)
) syn;

alter table lt_sweep add column anchor timestamp;
alter table lt_sweep add column has_eligible boolean;
update lt_sweep
   set anchor = date_trunc('day', ts) + open_t,
       has_eligible = expected_first >= ts + interval '30 minutes'
                      and expected_first <= last_start
                      and expected_first::date = ts::date;

select is((select count(*) from lt_sweep)::int, 48,
          'construction sweep: 48 synthetic local clocks evaluated (24 hours x :00 and :30)');
select is((select count(*) from lt_sweep where close_t <= open_t)::int, 0,
          'construction sweep: the derived close is never earlier than the derived open');
select is((select count(*) from lt_sweep
           where extract(minute from anchor) <> 0
              or extract(second from anchor) <> 0)::int, 0,
          'construction sweep: the grid anchor stays on the exact hour at every clock');
select is((select count(*) from lt_sweep
           where not has_eligible and ts::time <= time '23:00')::int, 0,
          'construction sweep: every clock outside the final window before midnight leaves an eligible today start');
select is((select has_eligible from lt_sweep where ts::time = time '23:00'), true,
          'construction sweep: the 23:00 clock still leaves an eligible today start');
select is((select has_eligible from lt_sweep where ts::time = time '23:30'), false,
          'construction sweep: the 23:30 clock is the documented unprovable case');

-- 7. NULL schedule fields contribute no slots and never fall back to shop hours.
select pg_temp.avail('pgtap-availability', :'f_toknull') as anull \gset
select is(:'anull'::jsonb->'service'->>'durationMinutes', null,
          'NULL duration: the service is still returned');
select is(jsonb_array_length(:'anull'::jsonb->'days'), 0, 'NULL duration: the calendar is empty');
update public."Barbero" set hora_apertura = null, hora_cierre = null where id = :f_barber;
select pg_temp.avail('pgtap-availability', :'f_tok30') as abh \gset
select is(pg_temp.total_slots(:'abh'::jsonb), 0,
          'NULL barber hours contribute no slots (no shop-hours fallback)');
select is(jsonb_array_length(:'abh'::jsonb->'days'), 14,
          'NULL barber hours still return the full window');
update public."Barbero" set hora_apertura = '09:00', hora_cierre = '20:00' where id = :f_barber;
update public."Barbero" set dias_habiles = null where id = :f_barber;
select is(pg_temp.total_slots(pg_temp.avail('pgtap-availability', :'f_tok30')), 0,
          'NULL barber working days contribute no slots');
update public."Barbero" set dias_habiles = '{0,1,2,3,4,5,6}' where id = :f_barber;
update public."Barberia" set dias_habiles = '{0,1,2,3,4,5,6}' where id = :f_shop;

-- NULL shop schedule response shape: the service snapshot is still returned and
-- the calendar still spans the full 14-day window with empty slots (mirrors the
-- barber-NULL case above; the scenario requires no barber-hours fallback).
update public."Barberia" set hora_apertura = null, hora_cierre = null where id = :f_shop;
select pg_temp.avail('pgtap-availability', :'f_tok30') as ashopnull \gset
select is(pg_temp.total_slots(:'ashopnull'::jsonb), 0,
          'NULL shop hours contribute no slots');
select is(:'ashopnull'::jsonb->'service'->>'publicServiceToken', :'f_tok30',
          'NULL shop hours still return the service snapshot');
select is(jsonb_array_length(:'ashopnull'::jsonb->'days'), 14,
          'NULL shop hours still return the full 14-day window');
select is((select count(*) from jsonb_array_elements(:'ashopnull'::jsonb->'days') d
           where jsonb_array_length(d->'slots') <> 0)::int, 0,
          'NULL shop hours return every day with empty slots');
update public."Barberia" set hora_apertura = '09:00', hora_cierre = '20:00' where id = :f_shop;
update public."Barberia" set dias_habiles = null where id = :f_shop;
select is(pg_temp.total_slots(pg_temp.avail('pgtap-availability', :'f_tok30')), 0,
          'NULL shop working days contribute no slots');
update public."Barberia" set dias_habiles = '{0,1,2,3,4,5,6}' where id = :f_shop;

-- 8. Occupancy and half-open adjacency on a future working day.
select is(pg_temp.slot_count(pg_temp.avail('pgtap-availability', :'f_tok30'), :'target'::date), 22,
          'occupancy: baseline is 22 slots before any appointment');
insert into public."Turno" (inicio, cliente_id, barbero_id, servicio_id, origen, duracion_minutos, estado)
values (:'target'::date + time '09:00', :f_client, :f_barber, :f_svc30, 'presencial', 30, 'confirmado')
returning id as f_turno \gset
select is(pg_temp.slot_count(pg_temp.avail('pgtap-availability', :'f_tok30'), :'target'::date), 21,
          'occupancy: confirmado occupies its interval');
select is(pg_temp.has_slot(pg_temp.avail('pgtap-availability', :'f_tok30'),
                           :'target' || 'T09:00:00'), false,
          'occupancy: the occupied start is absent');
select is(pg_temp.has_slot(pg_temp.avail('pgtap-availability', :'f_tok30'),
                           :'target' || 'T09:30:00'), true,
          'adjacency: a slot starting exactly at the appointment end survives');
update public."Turno" set estado = 'cancelado' where id = :f_turno;
select is(pg_temp.slot_count(pg_temp.avail('pgtap-availability', :'f_tok30'), :'target'::date), 22,
          'occupancy: cancelado does not occupy');
update public."Turno" set estado = 'ausente' where id = :f_turno;
select is(pg_temp.slot_count(pg_temp.avail('pgtap-availability', :'f_tok30'), :'target'::date), 22,
          'occupancy: ausente does not occupy');
update public."Turno" set estado = 'pendiente' where id = :f_turno;
select is(pg_temp.slot_count(pg_temp.avail('pgtap-availability', :'f_tok30'), :'target'::date), 21,
          'occupancy: pendiente occupies');
update public."Turno" set estado = 'completado' where id = :f_turno;
select is(pg_temp.slot_count(pg_temp.avail('pgtap-availability', :'f_tok30'), :'target'::date), 21,
          'occupancy: completado occupies');
update public."Turno" set inicio = :'target'::date + time '09:15' where id = :f_turno;
select is(pg_temp.slot_count(pg_temp.avail('pgtap-availability', :'f_tok30'), :'target'::date), 20,
          'occupancy: a partial overlap removes every candidate interval it touches');
select is((select count(*) from jsonb_array_elements(
             pg_temp.slots_on(pg_temp.avail('pgtap-availability', :'f_tok30'), :'target'::date)) s
           where s->>'start' in (:'target' || 'T09:00:00', :'target' || 'T09:30:00'))::int, 0,
          'occupancy: a partial overlap removes both touched starts');
update public."Turno" set inicio = :'target'::date + time '09:30' where id = :f_turno;
select is(pg_temp.has_slot(pg_temp.avail('pgtap-availability', :'f_tok30'),
                           :'target' || 'T09:00:00'), true,
          'adjacency: back-to-back appointments keep the slot that ends when the next begins');
delete from public."Turno" where id = :f_turno;

-- 9. Blocks: full-day NULL/NULL, partial [start,end), and the boundary CHECK.
insert into public."BloqueoHorario" (barbero_id, fecha, hora_inicio, hora_fin, motivo)
values (:f_barber, :'target'::date, null, null, 'pgtap full day');
select is(pg_temp.slot_count(pg_temp.avail('pgtap-availability', :'f_tok30'), :'target'::date), 0,
          'blocks: a full-day block (both boundaries NULL) removes the whole date');
select is(pg_temp.slot_count(pg_temp.avail('pgtap-availability', :'f_tok30'),
                             (:'target'::date + 1)), 22,
          'blocks: a full-day block does not suppress other dates');
delete from public."BloqueoHorario" where motivo = 'pgtap full day';
select throws_ok(
  format('insert into public."BloqueoHorario" (barbero_id, fecha, hora_inicio, hora_fin) '
         || 'values (%s, %L, null, %L)', :'f_barber', :'target', '12:00'),
  '23514', null, 'blocks: a half-defined block is rejected by bloqueohorario_horas_completas');
insert into public."BloqueoHorario" (barbero_id, fecha, hora_inicio, hora_fin, motivo)
values (:f_barber, :'target'::date, '10:00', '11:00', 'pgtap partial');
select is(pg_temp.slot_count(pg_temp.avail('pgtap-availability', :'f_tok30'), :'target'::date), 20,
          'blocks: a partial block removes [hora_inicio,hora_fin) overlaps');
select is((select count(*) from jsonb_array_elements(
             pg_temp.slots_on(pg_temp.avail('pgtap-availability', :'f_tok30'), :'target'::date)) s
           where s->>'start' in (:'target' || 'T10:00:00', :'target' || 'T10:30:00'))::int, 0,
          'blocks: the partial block removes both covered starts');
select ok(
  pg_temp.has_slot(pg_temp.avail('pgtap-availability', :'f_tok30'), :'target' || 'T09:30:00')
  and pg_temp.has_slot(pg_temp.avail('pgtap-availability', :'f_tok30'), :'target' || 'T11:00:00'),
  'blocks: starts outside the block survive');
update public."BloqueoHorario" set hora_inicio = '09:00', hora_fin = '09:30' where motivo = 'pgtap partial';
select is(pg_temp.slot_count(pg_temp.avail('pgtap-availability', :'f_tok30'), :'target'::date), 21,
          'blocks: a block ending at a slot start removes only the overlapping slot');
select is(pg_temp.has_slot(pg_temp.avail('pgtap-availability', :'f_tok30'),
                           :'target' || 'T09:30:00'), true,
          'blocks: half-open block, the slot at the block end survives');
delete from public."BloqueoHorario" where motivo = 'pgtap partial';

-- 10. Least privilege: the RPC is service_role-only.
select is(has_function_privilege('anon', 'public.public_availability(text,text)', 'EXECUTE'), false,
          'grants: anon cannot execute the availability RPC');
select is(has_function_privilege('authenticated', 'public.public_availability(text,text)', 'EXECUTE'),
          false, 'grants: authenticated cannot execute the availability RPC');
select is(has_function_privilege('service_role', 'public.public_availability(text,text)', 'EXECUTE'),
          true, 'grants: service_role can execute the availability RPC');
set local role service_role;
select is(jsonb_array_length(public.public_availability('pgtap-availability', :'f_tok30')->'days'), 14,
          'grants: service_role execution succeeds');
reset role;
set local role anon;
select throws_ok(format('select public.public_availability(%L, %L)', 'pgtap-availability', :'f_tok30'),
                 '42501', null, 'grants: anon execution is denied');
reset role;
select is(public.public_catalog('pgtap-availability')->'services'->0 ? 'publicServiceToken', true,
          'catalog: the catalog exposes the opaque public service token');
select is(public.public_catalog('pgtap-availability')->'services'->0 ? 'id', false,
          'catalog: the catalog exposes no internal id');
select is(has_function_privilege('anon', 'public.public_catalog(text)', 'EXECUTE'), false,
          'catalog: anon cannot execute the catalog RPC');
select is(has_function_privilege('service_role', 'public.public_catalog(text)', 'EXECUTE'), true,
          'catalog: service_role can execute the catalog RPC');

-- 11. The read never mutates.
select is((select count(*) from public."Turno")::int, :turnos0,
          'read-only: the availability read created no appointment');
select is((select count(*) from public."Cliente")::int, :clientes0 + 1,
          'read-only: the availability read created no client');

select * from finish();
rollback;


