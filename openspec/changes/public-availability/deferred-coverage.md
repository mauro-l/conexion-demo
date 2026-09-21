# Deferred Coverage Log — public-availability

This change is backed by four suites: Vitest (`npm test`), pgTAP against the local
database (`npm run test:db`, 79 assertions), real-HTTP Edge checks (`npm run
test:edge`, 28 checks) and Playwright against a production build (`npm run
test:e2e`, 12 tests). This log lists the cases those suites do **not** prove, so a
maintainer can tell what is guaranteed from what is only assumed.

Read it before trusting the suite. Every entry names the exact case, why it is deferred
today, and what would move it to covered.

## Categories

- **Spec case without coverage** — a requirement or scenario in
  `specs/public-availability-read/spec.md` that no committed test or execution evidence
  proves.
- **Operational precondition** — environment or fixture that must be running for any of
  the evidence to exist at all. Not a product behavior.

## Spec cases without coverage

### D1 — Exact 30-minute lead-time boundary at 10:00

**Case.** Spec scenario "Boundary and lead time": local time is 10:00 and the earliest
eligible start is 10:30.

**Status: closed (non-vacuous, clock-derived, proven across the whole day).** The RPC
still reads `clock_timestamp()` with no injectable seam
(`supabase/migrations/phase12_public_availability.sql:77`) and was deliberately not
changed. Instead the harness owns its fixtures and derives today's shop/barber window
from the database clock through two helpers
(`supabase/tests/public_availability.sql`, section 1b): the open is
`date_trunc('hour', now) - 3h` clamped so it never precedes local midnight, and the close
is `date_trunc('hour', now) + 6h` clamped so it never passes it. Both boundaries stay on
exact hours, so the 30-minute grid stays anchored on `:00`/`:30`, and the clamp makes it
impossible for the close to land before the open. The section-6 assertions then prove
(a) at least one eligible today slot exists (a hard failure, never a skip, if it does
not), (b) no today slot starts before `now + 30 minutes`, (c) the earliest today slot is
exactly the first 30-minute grid step at or after `now + 30 minutes`, computed from the
same anchor the fixture uses, and (d) a window placed entirely before `now` yields no
today slots, which is the complement showing the predicate still applies.

**Whole-day proof.** Section 6b evaluates the same two derivation helpers against **48
synthetic local clocks** — every hour of the day at `:00` and `:30` — and asserts that
the derived close is never earlier than the derived open, that the grid anchor stays on
the exact hour at every clock, and that every clock outside the documented final window
leaves at least one eligible today start. This is the deterministic, hour-independent
check a single-hour run cannot provide, and it is what caught the wrap defect the earlier
`-3h`/`+6h` form hid: with the un-clamped close, clocks from 18:00 onward produce a
00:00 close behind a 15:00 open, and the sweep fails.

**The one genuinely unprovable window.** For a 30-minute service whose close is clamped
to `24:00`, the last start today can hold is `23:30`; once `now + 30min` is past that
start, no today start can satisfy the rule, so neither the predicate nor a violation of
it can be observed. Section 6 classifies this window (real clocks after `23:00`) as an
explicit `skip` carrying its reason text, and section 6b shows the same classification
for the synthetic `23:30` clock. A broken construction cannot hide behind that skip: the
classifier only fires when the derived close is after the derived open, so a wrapped
window falls through to the loud non-vacuity guard (verified by restoring the un-clamped
`+6 hours` form — the suite fails in section 6 *and* in the sweep).

**Residue.** A literal "local time is exactly 10:00" fixture is still not expressible
without a clock seam, and the spec's 10:00 wording remains an illustration of the rule
rather than a pinned input. The rule itself (`start >= now + 30 minutes`, on the grid)
is now executed-proven non-vacuously at every wall-clock time the construction can
produce, with the pre-midnight window reported as an explicit skip rather than a silent
pass.

### D2 — Occupied / blocked / NULL-schedule on published live data

**Case.** The spec scenarios "Occupied interval", "Missing barber schedule", "Missing shop
schedule", and the occupancy/block rules in "Occupancy and blocks".

**Why it is deferred.** These are proven only against in-transaction fixtures in the local
scratch database (`supabase/tests/public_availability.sql` sections 7-9). No committed test
reads the published production shop at all: `npm run test:e2e` targets the local scratch
stack (`playwright.config.ts` plus `.env.local`), and the SQL harness creates and rolls
back its own fixtures. The design records that the live data proves only the empty-calendar
case (`design.md:80-82`).

**What would unblock it.** Published, disposable fixtures on the live shop (a service with
a known appointment or block), or an explicit staging shop with deterministic data.

### D3 — Shop-level (`Barberia`) NULL schedule against the spec's own wording

**Case.** A barbershop whose shop-level schedule fields (`dias_habiles`, `hora_apertura`,
`hora_cierre`) are NULL yields no slots and never falls back to barber hours.

**Status: closed.** Implemented
(`supabase/migrations/phase12_public_availability.sql:178-181` filters the shop fields
with `IS NOT NULL`) and fixture-tested
(`supabase/tests/public_availability.sql`, section 7). The response shape for the
shop-NULL state is now asserted too, mirroring the barber-NULL case: the service
snapshot is still returned with the requested `publicServiceToken`, `days` still spans
14 entries, and every one of those days carries empty `slots`.

### D4 — Effective-hours intersection with differing shop and barber schedules

**Case.** The spec requires "Effective hours are the intersection of shop and barber hours
and working-day arrays."

**Why it is deferred.** Every fixture sets the shop and barber to identical hours and
working days, and mutates them together (`supabase/tests/public_availability.sql:70-76`,
`:92-98`, `:174-175`, `:187-188`). The `greatest`/`least` intersection and the `= ANY`
day intersection are therefore never exercised with differing values, so the intersection
semantics are not independently proven.

**What would unblock it.** A fixture with a shop wider than its barber (for example shop
08:00-20:00, barber 10:00-14:00) asserting the slot grid spans only 10:00-14:00, plus a
differing `dias_habiles` pair.

### D5 — Edge validation branches with no committed test

**Case.** Spec scenario "Invalid or unknown input": an unknown query field or a date
outside the window returns a stable client error.

**Status: closed.** `npm run test:edge` (`scripts/edge-test.sh`) drives the **served**
Edge function over real HTTP and asserts status, stable code and the `no-store` header
for each branch: unknown query field and malformed `date` → `INVALID_INPUT` (400), a
date the window cannot contain → `AVAILABILITY_RANGE_EXCEEDED` (400), an unknown service
token and an unknown slug → `PUBLIC_RESOURCE_NOT_FOUND` (404), and a non-GET method →
`METHOD_NOT_ALLOWED` (405). A real service token is resolved from the catalog at run
time, so nothing is hardcoded. The Vitest client-side fakes
(`lib/availability.server.test.ts:141-155`) remain as client behaviour tests but are no
longer the only evidence.

### D6 — Fase 3 server-side lead-time re-enforcement

**Case.** "Fase 3 MUST consume this contract and re-enforce the same 30-minute lead-time
rule server-side."

**Why it is deferred.** Fase 3 (the booking writer) is explicitly out of scope for this
change (`proposal.md:16-17`), so the requirement cannot be verified today.

**What would unblock it.** The Fase 3 implementation and its own server-side lead-time test.

**Note.** The spec also says the token MUST NOT be persisted. There is no code path that
stores it, and the E2E no-mutation probe snapshots every writable table before and after
the read flow (`tests/e2e/public-availability.spec.ts:118-145`, `:228`, `:251-253`); no
dedicated non-persistence assertion exists, but there is no store to assert against.

### D7 — Edge `Cache-Control: no-store` response header

**Case.** "Responses MUST be `Cache-Control: no-store`" and the "Valid service read" scenario's
"the response is uncached" (`specs/public-availability-read/spec.md`, "Authoritative
availability contract").

**Status: closed.** `npm run test:edge` (`scripts/edge-test.sh`) asserts the served
`no-store` header on the 200 path **and** on every error path it exercises (unknown query
field, malformed date, date outside the window, unknown service token, unknown slug, wrong
method). It is a reproducible in-repo command, replacing the earlier one-off `curl -i`
observation. `supabase/functions/_shared/http.test.ts` additionally pins the response
factory (`jsonResponse`/`errorResponse`/`handleOptions`) as a fast unit-level guard, but
the real-HTTP check is the evidence that closes this entry.

### D8 — Token rotation and value preservation

**Case.** `publicServiceToken` "MUST be opaque, unique, non-NULL", each value MUST be preserved
"across renames and price changes", and "Rotation MUST be an explicit server-side operation and
MUST invalidate the old token" (`specs/public-service-catalog-read/spec.md`, "DB-authoritative
resolution").

**Why it is deferred.** No test updates a service's `nombre`/`precio` and re-reads its token, and
no test overwrites a token and asserts the old value stops resolving. The SQL harness reads tokens
from fresh fixtures only (`supabase/tests/public_availability.sql:81`, `:85`, `:89`);
`phase11_public_service_token.sql:16-30` installs the default, backfill, and unique index, but
nothing exercises a later `UPDATE`. Uniqueness and non-NULL hold by DDL, not by assertion.

**What would unblock it.** A SQL fixture that (1) updates `Servicio.nombre`/`precio` and asserts
`public_service_token` is unchanged, and (2) overwrites one token and asserts the previous token
now returns `PUBLIC_RESOURCE_NOT_FOUND`.

## Operational preconditions

These must be running for the evidence above to exist at all. They are not product
behavior, and a green suite with a missing precondition is a false negative.

| # | Precondition | Needed by |
|---|---|---|
| P1 | Local Supabase stack reachable (Postgres 54322, Kong 54321, and the `public-availability` Edge function served) with migrations `phase9`..`phase12` applied | `npm run test:db`, `npm run test:edge`, `npm run test:e2e` |
| P2 | Docker reachable through `sg docker`, plus `SUPABASE_TEST_NETWORK=supabase_network_conexion-db` | `scripts/db-test.sh` (the repo `config.toml` carries the production project id) |
| P3 | `.env.local` with `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `BARBERSHOP_PUBLIC_SLUG` pointing at the local stack, loaded before `.env` | app reads, `npm run test:edge`, `npm run test:e2e` |
| P4 | A prior `npm run build` (Playwright refuses to fall back to `next dev`) | `npm run test:e2e` |
| P5 | At least one future day with slots for the read-only E2E flow | `tests/e2e/public-availability.spec.ts:222-224` |
| P6 | A published service for `BARBERSHOP_PUBLIC_SLUG`, so `scripts/edge-test.sh` can resolve a live 32-hex service token before its HTTP checks | `npm run test:edge` |
