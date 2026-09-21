## Exploration: public-availability (Fase 2, read-only availability)

Fase 2 adds read-only availability to the Next.js 16 public landing shipped in Fase 1
(archived at `openspec/changes/archive/2026-09-21-next-public-parity/`): the catalog CTA
becomes active and navigates to a new `/reservar?service=<token>` route, the deferred
professional selector returns as "any professional" only, and a new Edge/RPC availability
contract computes slots from working hours, working days, blocks, and occupying
appointments over a 14-day forward window. No booking creation, no customer data, no
idempotency, no cancellation. All evidence below is from live read-only probes run
2026-09-21 plus the cited repo files.

### Current State

#### 1. Scheduling data model as it actually exists (live probe, 2026-09-21)

Enum `estado_turno` (live `pg_enum`, sort order): `pendiente | confirmado | completado |
cancelado | ausente`.

- `Barberia` — `id bigint PK`, `created_at timestamptz NOT NULL`,
  `nombre varchar NOT NULL`, `admin_user_id uuid NULL`,
  `hora_apertura time NULL`, `hora_cierre time NULL`, `dias_habiles int2[] NULL`,
  `public_slug text NULL` (unique index `idx_barberia_public_slug_unique`, multiple NULLs
  allowed), `description text NULL`, `publicado boolean NOT NULL DEFAULT false`,
  `codigos_area_permitidos text[] NOT NULL DEFAULT '{11}'` (not in the 2026-09-11
  `db-baseline.md`; new since), `direccion`, `horario_publico`, `whatsapp_url`,
  `instagram_handle`, `instagram_url` (all `text NULL`, from
  `supabase/migrations/phase10_public_landing_details.sql`).
- `Barbero` — `id bigint PK`, `created_at timestamptz NOT NULL`,
  `nombre varchar NOT NULL`, `users_id uuid NOT NULL → auth.users`,
  `descripcion text NULL`, `duracion_default smallint NULL`, `precio_base numeric NULL`,
  `alias varchar NULL`, `foto_url text NULL`, `activo boolean NULL` (nullable, no
  default — queries must use `activo = true`, as `public_context`/`public_catalog` do),
  `barberia_id bigint NOT NULL → Barberia`,
  `dias_habiles int2[] NULL`, `hora_apertura time NULL`, `hora_cierre time NULL`.
- `Servicio` — `id bigint PK`, `nombre varchar NULL`, `duracion numeric NULL`,
  `precio numeric NULL`, `barbero_id bigint NOT NULL → Barbero`,
  `descripcion text NULL` (phase10). No `activo` column. No public identifier or token
  column. Services hang off a barber, not the barbershop; the catalog RPC joins through
  the active barbers of the published shop (`phase10_public_landing_details.sql:94-96`).
- `BloqueoHorario` — `id bigint PK`, `created_at timestamptz NOT NULL`,
  `barbero_id bigint NOT NULL → Barbero`, `fecha date NOT NULL`,
  `hora_inicio time NULL`, `hora_fin time NULL`, `motivo text NULL`.
  `NULL/NULL` means a full-day block (plan §9; live row `barbero_id=1, fecha=2026-09-27`
  confirms the convention in use).
- `Turno` — `id bigint PK`, `created_at timestamptz NOT NULL`,
  `estado estado_turno NULL DEFAULT 'pendiente'`, `inicio timestamp without time zone
  NOT NULL` (local-naive), `cliente_id bigint NOT NULL`, `barbero_id bigint NOT NULL`,
  `update_at timestamptz NULL`, `servicio_id bigint NOT NULL`, `origen text NOT NULL`,
  `duracion_minutos smallint NOT NULL`. Live check constraints per baseline:
  `turno_origen_check (origen IN ('web','whatsapp','presencial'))`,
  `turno_duracion_valida (duracion_minutos > 0 AND <= 480)`.
- No token, idempotency, or availability tables exist (live `pg_tables` probe for
  `%token%`/`%idempoten%`/`%availability%` returned zero rows), consistent with plan §9
  listing token storage as "to evaluate".

#### 2. Effective-hours rule: NOT established anywhere — spec must decide

Both `Barberia` and `Barbero` carry nullable `dias_habiles`, `hora_apertura`,
`hora_cierre`, and no code or migration in this repository combines them: grep for
`hora_apertura|dias_habiles|Buenos_Aires|timeZone` hits only the plans, the seed, and
the old `db-baseline.md` — zero application or RPC code. The seed sets identical hours
on shop and barber (`09:00–20:00`, shop `[1..6]`, demo barber `[1..6]`), which masks the
question rather than answering it. Live data sharpens it: `Barbería Piloto` (id 1) has
NULL hours/days, `Barbería Demo` (id 2, unpublished) has full-week `[0..6]`, the
published `Conexión Barbería` (id 3) has `[1..6]` + `09:00–20:00`, and both live barbers
have `09:00–20:00` with different day sets (`[0..6]` vs `[1..6]`). Candidate semantics
(intersection of shop ∩ barber; barber-wins with shop as fallback when barber fields
are NULL; shop-wins) are all implementable, but none is authoritative today. Additional
sub-ambiguity: day numbering. Live arrays mix `0` (barbero 1 uses `[0..6]`) and `1..6`
styles, so the spec must pin whether `0`/`7` means Sunday (Postgres `extract(dow)`) or
whether days are ISO `1=Monday..7=Sunday`.

#### 3. Which `Turno` states occupy a slot

Live constraint name is `turno_sin_solape` (the baseline doc's migration label was
`turno_no_solape_estricto`; the live object carries the shorter name):

```sql
EXCLUDE USING gist (
  barbero_id WITH =,
  tsrange(inicio, inicio + (duracion_minutos::double precision * '00:01:00'::interval), '[)') WITH &&
) WHERE (estado = ANY (ARRAY['pendiente'::estado_turno, 'confirmado'::estado_turno, 'completado'::estado_turno]))
```

- Occupying: `pendiente`, `confirmado`, `completado`.
- Freeing: `cancelado`, `ausente` (cancellation frees the interval immediately).
- Back-to-back appointments ARE allowed: the range bound is `'[)'`
  (start-inclusive, end-exclusive), so `tsrange` adjacency does not conflict.
- Scope is per `barbero_id`, not per barbershop — with "any professional" resolution
  deferred to Fase 3, availability must evaluate occupancy per barber and union the
  result; a slot free for one barber but taken for another is still bookable in the
  Fase 3 model.
- Note: `pendiente` blocks despite Fase 3 creating directly in `confirmado`; stale
  `pendiente` rows (no expiry column exists) would permanently shadow slots until
  moved to a terminal state. Spec should state whether availability treats
  long-lived `pendiente` as occupying (constraint-consistent) or decaying (requires a
  rule that does not exist yet).

#### 4. Slot computation inputs and boundaries

- Service duration: `Servicio.duracion` is `numeric NULL` — the authoritative per-service
  length, but nullable with no default and no `CHECK`. `Barbero.duracion_default`
  (`smallint NULL`) exists as a possible fallback; `turno_duracion_valida` bounds stored
  turns to `1..480` minutes. The spec must define: duration source of truth, NULL
  handling, rounding of fractional `numeric` values, and step granularity (plan and
  code are silent; prototypes used hardcoded arrays, explicitly non-authoritative).
- Occupying `Turno` rows per §3, evaluated per barber over `[day_start, day_end)` with
  `'[)'` overlap semantics; the candidate slot `[s, s+duracion)` must satisfy the same
  non-overlap predicate the constraint enforces.
- `BloqueoHorario`: full-day (`hora_inicio IS NULL AND hora_fin IS NULL`) removes the
  whole date; partial removes `[hora_inicio, hora_fin)` on that `fecha` for that
  `barbero_id`. Live rows demonstrate both shapes
  (`2026-09-22 15:00–17:00 partial`; `2026-09-27 full-day`).
- Past times on the current day must be excluded; "past" is evaluated in
  `America/Argentina/Buenos_Aires` wall time (see §5). No minimum lead time exists
  anywhere (the only minute-level policy in the plan is the Fase 4 five-minute
  cancellation limit). The spec must set lead time explicitly, including whether
  `lead_time = 0` is intended.
- 14-day forward window (locked product decision): spec must pin inclusive/exclusive
  ends (recommendation: dates `[today, today+13]`, i.e. 14 bookable dates inclusive) and
  whether `today` is included when its remaining slots are exhausted.

#### 5. Timezone correctness

`Turno.inicio` is `timestamp without time zone` storing Buenos Aires wall time. The
concrete rule: construct and compare naive local values (`YYYY-MM-DD HH24:MI:SS`)
entirely in `America/Argentina/Buenos_Aires` (UTC-3 year-round, no DST), and never
round-trip through `Date.toISOString()` or UTC-epoch arithmetic — `toISOString()`
shifts wall time to UTC, so a `09:00` local slot serialised that way persists as
`12:00`, a silent three-hour displacement. The plans state this twice
(`plan_next_web_completa.md` §12; `plan_web_publica.md:418`) but no code in this
repository implements or demonstrates it: the only temporal code paths are
`next: { revalidate: 60 }` fetch caching and Postgres `timestamptz` defaults
(`created_at`, `update_at`), which are server-clock instants, not booking wall time.
In Postgres, generate slots with `AT TIME ZONE 'America/Argentina/Buenos_Aires'`
anchored to local dates, or compute local midnights client-side of the cast and keep
the `timestamp` naive end to end. Day-boundary arithmetic (`dias_habiles` membership,
"is this slot in the past") must use the same zone on both sides.

#### 6. Live data for testing (read-only probes, 2026-09-21)

| Probe | Result |
|---|---|
| `Turno` rows | 27 (25 `confirmado`, 2 `cancelado`; `origen`: 16 `presencial`, 11 `whatsapp`) |
| `Turno` per barber | ALL 27 on `barbero_id = 1` (Mauro Laime, unpublished `Barbería Demo`); **zero** on `barbero_id = 10` (Juan Pérez, published shop) |
| `BloqueoHorario` rows | 2, both on `barbero_id = 1` (partial `2026-09-22 15:00–17:00 "Corte de luz"`; full-day `2026-09-27 "Vacaciones"`) |
| Active `Barbero` rows | 2 |
| `Servicio` rows | 9 (4 with descriptions on Juan Pérez; 5 without on Mauro Laime) |
| Published shop | `Conexión Barbería` (`public_slug='conexion-barberia'`, `publicado=true`) |

Availability against the published slug therefore exercises only the empty-calendar
path today: no occupying turns, no blocks, four catalog services. Meaningful exercise
of overlap, partial/full-day blocks, and past-time filtering needs demo fixtures on
the published shop's barber (`barbero_id = 10`): at least one `confirmado` turn inside
business hours on a near date, one partial block, one full-day block, and turns in
`cancelado`/`ausente` proving they free their intervals. Fixture creation is seed/migration
work for a later phase, not this exploration.

#### 7. Service token (plan §8.1: stable public token, never index or internal id)

`Servicio` has no public identifier; the catalog DTO exposes only
`{ name, durationMinutes, price, description }` (`types/public.ts:37-42`,
`phase10_public_landing_details.sql:80-90`). Names are not unique-constrained and
`duracion`/`precio` are nullable, so name-based addressing is fragile. Options and
costs are compared under Approaches; whichever is chosen, `/reservar` must re-resolve
name/price/duration server-side from the database (plan §8.1), and the token must not
be the row `id`. `barbers[]` already carries `name`, `alias`, `description`,
`photoUrl` — sufficient for rendering an "any professional" affordance plus future
per-barber display; nothing further is needed for the Fase 2 selector revival except
the locked product copy ("Cualquier profesional" only, no per-barber choice).

#### 8. Availability token (plan §13: short expiry; storage "to evaluate" per §9)

No persistence exists and none is required for Fase 2's read-only scope: the token is
consumed only in Fase 3, which does not exist yet. Minimum viable is a stateless
signed token (payload: slug/barbershop ref, service ref, date, issued-at, expiry;
HMAC with a server-only secret; `exp` of minutes). Tradeoffs are compared under
Approaches. Either way, availability responses carrying tokens must bypass the
`revalidate: 60` cache (plan §12; see §11).

#### 9. Edge Function pattern to follow

- Shared handler: `supabase/functions/_shared/handler.ts` (`handlePublicRead`) —
  `OPTIONS` → `handleOptions`; non-GET → `405 METHOD_NOT_ALLOWED`; strict slug regex
  `^[a-z0-9-]{1,63}$` → `400 INVALID_INPUT`; `service_role` client RPC call
  (`_shared/supabase.ts`, `persistSession: false`); RPC-level
  `PUBLIC_RESOURCE_NOT_FOUND` → `404`; everything else → `500 INTERNAL_ERROR`.
  Error shape is always `{ error: { code, message, retryable } }`
  (`_shared/http.ts:56-64`).
- Origin/CORS: allowlist = `{ http://localhost:4321 }` + `PUBLIC_SITE_ORIGIN`
  (`_shared/http.ts:1-3`); note the localhost entry is the Astro-era dev port while
  the Next app runs on `3000` (`lib/site-config.server.ts:10`) — Fase 2 must reconcile
  this. `Vary: Origin` is set; CSP is `default-src 'none'`.
- New availability surface follows the same shape: method enforcement, input
  validation (date strict, service token strict, unknown fields rejected), service-role
  only, stable error codes (suggest `SLOT_UNAVAILABLE`-style vocabulary only for the
  Fase 3 writer; Fase 2 needs `INVALID_INPUT`, `PUBLIC_RESOURCE_NOT_FOUND`,
  `AVAILABILITY_RANGE_EXCEEDED` or equivalent, `INTERNAL_ERROR`).
- New RPC must preserve the posture in `phase9/phase10` migrations:
  `SECURITY INVOKER` + `SET search_path = public, pg_temp` +
  `REVOKE EXECUTE FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE TO service_role`
  only, keeping `anon` at zero table grants.

#### 10. Existing CTA and the new route

- `components/public/ServiceCatalog.tsx:43-45` renders `<button type="button"
  className="ticket-cta">Reservar</button>` with no handler — deliberately inert
  (comment at `:15-19`). Activation means navigating to
  `/reservar?service=<token>`; the component stays a Server Component, so navigation
  uses an anchor/`Link`, not a client click handler. `key={service.name}` (`:26`)
  also becomes suspect once services are addressable — a later phase should key by a
  stable token.
- `app/page.tsx` is a `force-dynamic` Server Component composing `PublicHeader`,
  `PublicHero`/`PublicInfo`, `ServiceCatalog` from `loadPublicPageData(slug)` with
  `allSettled` 404/500 precedence (`lib/public-api.server.ts:170-196`). The `/reservar`
  route needs: a Server Component shell resolving the slug server-only, validating the
  `service` search-param token (invalid/unknown → not-found or an explicit
  actionable error — spec decision), and a Client Component island for the
  interactive calendar/slots (plus the revived "any professional" affordance and the
  explicit end-of-flow state required by locked decision 6). `app/layout.tsx` applies
  to all routes (theme bootstrap, fonts, `metadataBase`), so no layout fork is needed.
- Next 16 `params`/`searchParams` async handling was NOT verified against current docs
  in this phase (no docs fetch performed; repo pins `next 16.2.9`, `react ^19.3.0` in
  `package.json:15-19`). Any design relying on their sync/async semantics must verify
  against the installed version's docs in the design phase.

#### 11. Caching and the never-cache rule

Context and catalog reads use `next: { revalidate: 60 }`
(`lib/public-api.server.ts:24,122-129`; design decision recorded in the archived
`design.md`). Availability and anything carrying tokens must opt out: `cache: 'no-store'`
(or `export const dynamic = 'force-dynamic'` plus a no-store fetch) on the new
server-to-Edge read, and no `revalidate` on the Edge response (`Cache-Control:
no-store`, plus `Vary` correctness per plan §11). The 60-second stale-while-published
bound accepted for landing DTOs must not extend to slots.

#### 12. Spec delta surface (all five baselines read)

- `public-barber-selector` — delta REQUIRED. Currently mandates the selector MUST NOT
  render in Fase 1 and defers it to Fase 2 (`spec.md:10-11`). This change re-amends it:
  selector returns on `/reservar` as "Cualquier profesional" only, still absent from `/`.
- `web-app-scaffold` — delta REQUIRED. Scenario "Phase-one booking posture"
  (`spec.md:41-46`) states the CTA does not navigate and `/reservar` is not a route;
  both statements invert in Fase 2.
- `public-service-catalog-read` — delta REQUIRED. The exact four-field DTO
  (`spec.md:11`) gains the stable public service token (field addition), and the
  DB-authoritative requirement (`spec.md:22`) extends to token→service resolution.
- `public-context-read` — delta PROBABLY REQUIRED (minor). The seven-field/four-field
  exact-shape requirements (`spec.md:34,45`) are unchanged, but the "no `publicToken`
  (deferred; additive later)" note (`spec.md:34`) interacts with the new token-bearing
  surfaces; at minimum the availability contract needs a home (new capability vs
  extension of this one — spec-phase decision).
- `public-theme-switch` — NO delta. Untouched by this change.

#### 13. Contradictions and ambiguity (adversarial pass)

- Plan §8.2 says "no explicit barber selector in this cycle" while the locked Fase 2
  decisions for THIS change revive the selector as "any professional" — the plan's §8
  describes the end-state MVP, the session decisions describe the Fase 2 slice; the
  spec must scope the selector to `/reservar` read-only display, not booking-time
  resolution (Fase 3).
- Plan §8.3 says "do not assume 14 days"; the locked decision sets exactly 14 days
  forward. Locked decision wins; the plan sentence is superseded for this change.
- `_shared/http.ts:1` allows `http://localhost:4321` (Astro dev) but the Next app
  serves `3000` (`lib/site-config.server.ts:10`); the archived design never updated
  the Edge allowlist. Fase 2's new function must not inherit a stale CORS allowlist.
- `Servicio.nombre/duracion/precio` are all nullable with no `activo` flag and no
  publication concept; the plan (§0) deliberately keeps the barber-tied catalog with
  no `Servicio.activo`. NULL durations/prices in a public slot computation are
  therefore reachable, not hypothetical — spec must define exclusion vs fallback.
- `Barbero.activo` is nullable with no default; only `= true` filtering is safe.
- The anti-overlap migration is applied live but unversioned in this repo
  (`db-baseline.md:12-23`; live name `turno_sin_solape` vs the doc label
  `turno_no_solape_estricto`) — any design depending on its exact predicate must cite
  the live definition quoted in §3, not the repo.
- Could NOT verify: Next 16 `searchParams`/`params` async semantics (docs not fetched,
  deliberate — design-phase task); `authenticated`-role grants / RLS policies
  re-probe at close (read-only verify scope; last evidenced by `db-baseline.md` §4–5
  and unchanged phase9/phase10 migrations); per-service fractional `duracion` values
  in the wild (all live values are whole minutes).

### Affected Areas

- `components/public/ServiceCatalog.tsx` — CTA activation (link navigation with token).
- `app/page.tsx`, `app/layout.tsx` — landing stays; layout inherited by `/reservar`.
- `app/reservar/page.tsx` (new) + `components/booking/*` (new) — Server shell plus
  calendar/slots Client Components and the explicit end-of-flow state.
- `lib/public-api.server.ts`, `types/public.ts` (+ `types/booking.ts` or equivalent) —
  service-token-bearing catalog read, no-store availability read, new DTO types.
- `supabase/functions/public-availability/index.ts` (new) + `_shared/{handler,http}.ts`
  (extend validation/CORS, keep error shape) — availability Edge contract.
- New RPC (e.g. `public_availability`) + migration preserving the
  REVOKE/GRANT posture — slot computation boundary.
- `supabase/seed_demo.sql` (later phase) — fixtures on the published shop's barber.
- `openspec/specs/{public-barber-selector,web-app-scaffold,public-service-catalog-read,public-context-read}/spec.md` —
  deltas per §12.

### Approaches

1. **Service token: opaque random token column on `Servicio`** — `public_service_token`
   `text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(12),'hex')`, backfilled once.
   - Pros: stable across renames/price changes; unguessable; never an internal id;
     trivial server-side re-resolution.
   - Cons: additive migration + backfill; catalog DTO gains a field (spec delta).
   - Effort: Low/Medium.
2. **Service token: deterministic slug derived from `nombre`** (e.g. `slugify(nombre)`).
   - Pros: no migration; human-readable URLs.
   - Cons: breaks on rename; collision handling needed (names unconstrained); leaks
     naming; still needs uniqueness enforcement — effectively a migration anyway.
   - Effort: Medium, worse properties. Not recommended.
3. **Service token: hash of `(barberia_id, servicio_id)` with a server secret**.
   - Pros: no migration; opaque.
   - Cons: requires the secret at every resolution point; rotation invalidates
     in-flight links; couples Edge and Next secrets.
   - Effort: Medium. Fallback only.
4. **Availability token: stateless signed (HMAC, `exp` in minutes)**.
   - Pros: no storage, matches plan §9 "to evaluate" with the lightest footprint;
     short expiry is a field, not a sweeper; sufficient while Fase 3 does not exist.
   - Cons: revocation needs a denylist (not needed in Fase 2 — nothing consumes the
     token yet); payload must stay free of PII/ids.
   - Effort: Low. Recommended minimum viable.
5. **Availability token: stored hash (`token_hash`, type, `turno/slot` ref, expiry,
   revoked)** per plan §9.
   - Pros: revocable, auditable, survives to Fase 3/4 semantics.
   - Cons: new table + lifecycle + cleanup for a token nothing consumes in Fase 2;
     over-build for a read-only slice.
   - Effort: Medium. Defer to Fase 3 unless the spec wants the schema early.
6. **Slot computation location: Postgres RPC (set-returning or JSON)** vs Edge-side
   arithmetic.
   - Pros of RPC: single authority, same transaction snapshot semantics the Fase 3
     writer will need, no row over-fetch, timezone math in one place.
   - Cons of RPC: heavier SQL authorship.
   - Effort: Medium. Recommended — Edge stays a thin validator/proxy as today.

### Recommendation

Authoritative slot computation in a new `service_role`-only RPC (same
REVOKE/GRANT/`search_path` posture as phase9/phase10), fronted by a thin Edge
Function reusing `_shared` validation and error shape, consumed by a no-store
server read; opaque `public_service_token` column for services; stateless short-expiry
availability token format reserved but not consumed; `/reservar` Server shell +
calendar/slots Client island ending in an explicit "booking arrives next stage"
state. The spec phase must first lock: effective-hours combination + day numbering
(§2), NULL duration/price handling (§4/§13), lead time and window edges (§4), and the
service-token field addition (§7/§12).

### Risks

- [spec-must-resolve] Effective-hours combination rule is established nowhere (§2);
  any implementation guess bifurcates shop vs barber schedules. Includes day-numbering
  (`0` vs ISO) and NULL-fallback semantics.
- [spec-must-resolve] Nullable `Servicio.duracion/precio` with no `activo` flag can
  reach public slot math; exclusion vs fallback is undecided (§4, §13).
- [spec-must-resolve] Lead time, window inclusive/exclusive ends, and "today
  exhausted" behaviour are undefined (§4).
- [spec-must-resolve] `pendiente` occupies per the constraint but has no expiry;
  availability must state whether stale `pendiente` shadows slots (§3).
- CORS allowlist still names the Astro dev port (`4321`), not Next's `3000` (§9, §13).
- All live turns/blocks sit on the unpublished shop's barber; published-shop
  availability is untestable without fixtures (§6).
- Anti-overlap migration unversioned in repo; live name `turno_sin_solape` differs
  from the baseline doc label (§13).
- NOT verified: Next 16 `searchParams` async semantics; fresh `anon` grant/RLS
  re-probe; fractional durations in the wild (§13).

### Ready for Proposal

Yes — proceed to proposal/spec with the six locked decisions plus the five
spec-must-resolve items above as explicit inputs. The orchestrator should tell the
user: Fase 2 is implementable without touching booking, but the spec phase must lock
the effective-hours rule first, since it is the single most likely place for the
implementation to guess wrong.
