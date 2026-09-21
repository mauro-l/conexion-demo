```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:bbdd4d0bad685a4a535cae41d9ee573d0243ea5ac1e0e5cf8e6f51d67fac7f33
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 8/8
scenarios: 28/28
test_command: npm test
test_exit_code: 0
test_output_hash: sha256:93ea64653565a5e2ae4368cb07df2a4a9704238c367d06de14abc04a4b2bde6f
build_command: npm run build
build_exit_code: 0
build_output_hash: sha256:ac922b73d26a00e64bb3c8ca749d4bb0b6b0c6f92fa0756fd9eeb16f4997102a
```

## Verification Report

**Change**: public-availability
**Version**: N/A
**Mode**: Standard (`strict_tdd: false`)

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 15 |
| Tasks complete | 15 |
| Tasks incomplete | 0 |

All 15 tasks (1.1–5.2) are checked `[x]` in `tasks.md`. The working tree is intentionally left uncommitted (per the author's apply-progress note); nothing was committed during verification.

### Build & Tests Execution

All six evidence commands ran in the foreground against the local scratch stack. Results:

| Command | Exit | Observed result |
|---------|------|-----------------|
| `npm test` | 0 | 8 files / 55 tests passed |
| `npm run typecheck` | 0 | `tsc --noEmit`, no errors |
| `npm run lint` | 0 | `eslint .`, no problems |
| `npm run build` | 0 | Next 16.2.9 (Turbopack); routes `/`, `/_not-found`, `/reservar` |
| `SUPABASE_TEST_NETWORK=supabase_network_conexion-db npm run test:db` | 0 | pgTAP 1 file / 68 assertions, PASS |
| `npm run test:e2e` | 0 | Playwright 12 tests passed (6 workers) |

`next-env.d.ts` was restored to HEAD byte-identical after `npm run build`.

### Spec Compliance Matrix

Compliance statuses: ✅ COMPLIANT (covering test passed), ⚠️ PARTIAL (test passes but covers only part of the scenario), ❌ UNTESTED, ❌ FAILING.

**public-availability-read** (4 requirements, 10 scenarios)

| Requirement | Scenario | Evidence | Result |
|---|---|---|---|
| Authoritative availability contract | Valid service read | `supabase/tests/public_availability.sql:117-153` (DB-computed 14-day window, day numbering, 22-slot grid, ID-free DTO); `:304-316` (service_role-only grants) | ⚠️ PARTIAL — DB authority + grants proven; `Cache-Control: no-store` response header unproven (D7) |
| Authoritative availability contract | Invalid or unknown input | `tests/e2e/not-found.spec.ts:17-22` (unknown token → 404, no internal identifiers); `lib/availability.server.test.ts:141-155` (faked INVALID_INPUT) | ⚠️ PARTIAL — unknown-token path proven; malformed date / unknown field / date-outside-window unproven (D5) |
| Exact slot window and schedule rules | Boundary and lead time | `supabase/tests/public_availability.sql:117-121,152-153` (today+13 eligible, today+14 excluded), `:173-186` (exclusive-boundary exclusion), `:194-196` (no today slot before now+30) | ⚠️ PARTIAL — window edges proven; exact 10:00→10:30 lead-time boundary unproven (D1) |
| Exact slot window and schedule rules | Missing barber schedule | `supabase/tests/public_availability.sql:211-221` (NULL hours/days → 0 slots, no shop fallback) | ✅ COMPLIANT |
| Exact slot window and schedule rules | Missing shop schedule | `supabase/tests/public_availability.sql:222-228` (NULL shop hours/days → 0 slots, no barber fallback) | ✅ COMPLIANT |
| Occupancy and blocks | Occupied interval | `supabase/tests/public_availability.sql:234-268` (confirmado/pendiente/completado occupy; cancelado/ausente free; partial overlap; half-open adjacency) | ✅ COMPLIANT |
| Occupancy and blocks | Empty published calendar | `supabase/tests/public_availability.sql:207-210` (empty `days` returned with service, no error) + `components/booking/AvailabilityCalendar.test.tsx:34-48` (empty-state renders) | ✅ COMPLIANT (empty-is-success proven; see SUGGESTION S4) |
| Read-only tokens and flow boundary | Token expiry | `supabase/functions/_shared/availability-token.test.ts:98-110` (12:10:00 and 12:10:01 → expired; 12:09:59 → valid; `now >= exp`) | ✅ COMPLIANT |
| Read-only tokens and flow boundary | Token payload shape | `supabase/functions/_shared/availability-token.test.ts:50-58` (exactly 6 claims, no `v`) | ✅ COMPLIANT |
| Read-only tokens and flow boundary | End of read flow | `components/booking/AvailabilityCalendar.test.tsx:50-76` (end state, no fetch); `tests/e2e/public-availability.spec.ts:212-254` (no mutation) | ✅ COMPLIANT |

**public-barber-selector** (1 requirement, 5 scenarios)

| Requirement | Scenario | Evidence | Result |
|---|---|---|---|
| Selector rendered from the barbers list | Landing remains selector-free | `tests/e2e/profile.spec.ts:111` (`.prof-select` count 0); `components/public/ServiceCatalog.test.tsx:24` | ✅ COMPLIANT |
| Selector rendered from the barbers list | Data-only expansion | `tests/e2e/profile.spec.ts:111` (no selector) | ⚠️ PARTIAL — no two-barber fixture; 4-field barber DTO retention asserted by type only |
| Selector rendered from the barbers list | Any-professional booking entry | `tests/e2e/public-availability.spec.ts:232` (`.prof-select-value` = "Cualquier profesional"); `app/reservar/page.tsx:64-67` | ✅ COMPLIANT |
| Selector rendered from the barbers list | Booking-flow boundary | `tests/e2e/profile.spec.ts:111` (landing selector-free) + `tests/e2e/public-availability.spec.ts:232` (affordance on /reservar only) | ✅ COMPLIANT |
| Selector rendered from the barbers list | No booking-time resolution | `supabase/migrations/phase12_public_availability.sql:197` (DISTINCT union across barbers, no `barbero_id` in output `:243-247`) + no-mutation tests | ✅ COMPLIANT |

**public-service-catalog-read** (2 requirements, 4 scenarios)

| Requirement | Scenario | Evidence | Result |
|---|---|---|---|
| Catalog DTO | Tokenized exact field set | `supabase/tests/public_availability.sql:125,135` (5 fields, no id); `:318-321` (catalog token, no id); `lib/public-api.server.test.ts:89-91` | ✅ COMPLIANT |
| DB-authoritative resolution | Server-side token resolution | `supabase/tests/public_availability.sql:127-134` (token resolves, DB values echoed) | ⚠️ PARTIAL — token re-resolution proven; "changed price/duration re-read current values" unproven (D8) |
| DB-authoritative resolution | Duration, price, description from DB | `supabase/tests/public_availability.sql:129-134` (duration 30, price 1000, description 'pg-thirty' from DB) | ✅ COMPLIANT |
| DB-authoritative resolution | Null duration | `supabase/tests/public_availability.sql:207-210` (service returned, empty `days`, no error) | ✅ COMPLIANT |

**web-app-scaffold** (1 requirement, 9 scenarios)

| Requirement | Scenario | Evidence | Result |
|---|---|---|---|
| Next public scaffold, route, parity, and verification | Landing renders from public reads | `tests/e2e/profile.spec.ts:60-75` (hero from context, services from catalog) | ✅ COMPLIANT |
| Next public scaffold, route, parity, and verification | Private configuration is not exposed | `tests/e2e/profile.spec.ts:90-103` + `tests/e2e/public-availability.spec.ts:173-210` (credentials/slug absent from html + served chunks) | ✅ COMPLIANT (see WARNING W4) |
| Next public scaffold, route, parity, and verification | Verification surface is Next-based | all six commands exit 0 (this report) | ✅ COMPLIANT |
| Next public scaffold, route, parity, and verification | Missing public resource | `tests/e2e/not-found.spec.ts:4-32` (`/` and `/reservar` 404, same copy) | ✅ COMPLIANT |
| Next public scaffold, route, parity, and verification | Active catalog CTA and route | `components/public/ServiceCatalog.test.tsx:46-66` (href); `tests/e2e/public-availability.spec.ts:148-171` (CTA click → /reservar, no mutation) | ✅ COMPLIANT |
| Next public scaffold, route, parity, and verification | Search params are awaited | `app/reservar/page.tsx:22-28` (`searchParams: Promise`, awaited); `tsc` passes (Promise type enforced); E2E route resolves correct service | ✅ COMPLIANT |
| Next public scaffold, route, parity, and verification | Theme has no incorrect-theme flash | `tests/e2e/profile.spec.ts:140-148` (stored theme before paint) | ✅ COMPLIANT |
| Next public scaffold, route, parity, and verification | Cover asset is approved | `tests/e2e/profile.spec.ts:126-138` (local `cover.jpg`, no picsum) | ✅ COMPLIANT |
| Next public scaffold, route, parity, and verification | Domain remains configurable | `lib/site-config.server.ts` + `lib/site-config.server.test.ts:26-47` (configured origin, dev fallback) | ✅ COMPLIANT |

**Compliance summary**: 23/28 scenarios fully COMPLIANT, 5 PARTIAL, 0 UNTESTED, 0 FAILING. The envelope `scenarios: 28/28` counts scenarios with a passing covering test (COMPLIANT + PARTIAL); "fully compliant" is the stricter 23.

### Correctness (Static Evidence)

| Claim | Status | Notes |
|-------|--------|-------|
| RPC read-only, ID-free, `[today,today+14)`, `0=Sunday`, `start >= now+30min`, shop∩barber, NULL fail-closed, occupancy, half-open | ✅ Implemented | `phase12_public_availability.sql` — single SELECT/EXECUTE, no DML; window/`extract(dow)`/`greatest`/`least`/`IS NOT NULL`/`[)` filters present |
| service_role-only grants | ✅ Implemented | `phase12:299-300`, `phase11:79-80`; executed-proven at `:304-316` |
| Edge validates slug/service/date, rejects unknown fields, always no-store, stable errors | ✅ Implemented | `index.ts:66-93,101-150`; `jsonResponse`/`errorResponse` noStore=true throughout |
| HS256 token, `base64url` 3 segments, payload `{slug,service,start,end,iat,exp}`, no `v`, `exp=iat+600`, `now>=exp` rejected, 5s pre-iat skew, constant-time compare | ✅ Implemented | `availability-token.ts:146-206`; executed-proven by the token test suite |
| Next Server Component awaits `searchParams`, `notFound()` on public-not-found, no-store read, single client island | ✅ Implemented | `app/reservar/page.tsx`, `lib/availability.server.ts`, `AvailabilityCalendar.tsx` |
| Catalog CTA → `/reservar?service=<token>` | ✅ Implemented | `ServiceCatalog.tsx:45-50` |

### Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| RPC computes slots; Edge is a thin no-store proxy | ✅ Yes | `phase12` owns window/occupancy; `index.ts` only validates + signs |
| Opaque `public_service_token` | ✅ Yes | `phase11:16-30` default/backfill/NOT NULL/UNIQUE |
| Stateless HMAC availability token, no persistence | ✅ Yes | no store; E2E no-mutation probe + SQL read-only check |
| Server-only Next fetch keeps credentials private | ✅ Yes | `lib/availability.server.ts`; E2E privacy audit passes |
| Catalog-derived anti-overlap predicate (no assumed name) | ✅ Yes | `phase12:96-142` reads `pg_constraint`/`pg_get_constraintdef`, fails closed |

### Issues Found

**CRITICAL**: None.

**WARNING**:

- **W1 — `Cache-Control: no-store` response header not executed-proven (D7).** The spec clause "Responses MUST be `Cache-Control: no-store`" is first-class, but the only committed assertion is request-side (`lib/availability.server.test.ts:88-112` checks the Next client sends `cache: 'no-store'`, not what the served Edge returns). The header is set at `supabase/functions/_shared/http.ts:48,71` but no Edge-level test asserts it. *Resolve*: a Deno test of `jsonResponse`/`errorResponse`, or an integration script hitting the served function, asserting the header on the 200 path and each stable-error path.
- **W2 — Edge validation branches unproven (D5).** `INVALID_INPUT` (unknown field `index.ts:66-68`, malformed date `:80-84`) and `AVAILABILITY_RANGE_EXCEEDED` (`:128-142`) are stable-error contract clauses with no committed test; Vitest only fakes the codes (`lib/availability.server.test.ts:141-155`). *Resolve*: an Edge-level test asserting each status/code including a `date` outside the window.
- **W3 — Exact 10:00→10:30 lead-time boundary unproven (D1).** The RPC reads `clock_timestamp()` with no seam (`phase12:77`); the harness's second lead-time assertion (`supabase/tests/public_availability.sql:197-204`) is wall-clock guarded and passes vacuously after shop close. *Resolve*: a deterministic SQL clock seam plus a pinned 10:00→10:30 assertion.
- **W4 — "slug absent from client bundles" holds only literally.** The booking E2E asserts the raw slug string and credentials are absent from the served HTML/chunks (`tests/e2e/public-availability.spec.ts:190-209`), while also asserting `availabilityToken` is present (`:199`). The availability token is HMAC-**signed** (integrity), not encrypted: its base64url payload contains `slug` and `service`, so the slug is trivially recoverable by the browser. This is not a secret leak — the slug is a public identifier and no credential reaches the client — but the wording "absent"/"opaque" overstates the guarantee. *Resolve*: document the token as signed-not-encrypted, or tighten the spec wording.
- **W5 — Token rotation / value preservation unproven (D8).** `phase11_public_service_token.sql:16-30` installs the default, backfill, NOT NULL, and unique index, but no test updates `nombre`/`precio` and re-reads the unchanged token, nor overwrites a token and asserts the old value stops resolving. *Resolve*: a SQL fixture for rename/price preservation and rotation invalidation.

**SUGGESTION**:

- **S1 — Occupied/blocked/NULL-schedule proven only against in-transaction fixtures (D2).** The logic is exercised in `supabase/tests/public_availability.sql` sections 7–9 but never against the published shop. A staging shop with deterministic data would close the gap.
- **S2 — `supabase/**` has no `tsc` gate.** `tsconfig.json` excludes `supabase`, so `availability-token.ts` and the Edge function are type-checked by Vitest's esbuild but not `tsc`; type errors there would not fail `npm run typecheck`. *Resolve*: add a targeted typecheck or include the shared module.
- **S3 — Shop/barber intersection semantics not independently proven (D4).** Every fixture uses identical shop/barber hours and days, so `greatest`/`least` and `= ANY` intersection are never exercised with differing values. *Resolve*: a fixture with a wider shop than its barber.
- **S4 — "Empty published calendar" GIVEN does not map to any fixture.** The empty-is-success boundary is proven via NULL-duration (`:207-210`) and the UI empty-state, but no fixture shows a valid non-NULL-duration service with zero appointments yielding an empty result. *Resolve*: add such a fixture or clarify the scenario wording.
- **S5 — No two-barber fixture for "Data-only expansion".** The barber-selector scenario's "both entries retain the four DTO fields" is asserted by the `Barber` type definition only, not by a test. *Resolve*: a two-barber context fixture with a four-field assertion.

### Deferred Coverage Judgement

Every entry in `deferred-coverage.md` was re-checked against the executed evidence. None should block; D5 and D7 are the two closest to "should block" because they leave spec-level stable-error and no-store contract clauses unexecuted-proven.

| Entry | Honest? | Judgement |
|-------|---------|-----------|
| D1 — 10:00 lead-time boundary | Yes | Acceptable. Deterministic no-slot-before-now+30 proven (`:194-196`); only the exact boundary is unprovable without a clock seam. |
| D2 — occupied/blocked/NULL on live data | Yes | Acceptable. Logic proven in-transaction (sections 7–9); live-data proof is an operational concern. |
| D3 — shop-NULL response shape | Yes | Acceptable, and lower severity than stated: the scenario's THEN (no slots, no fallback) **is** proven (`:222-228`); only the 14-entry response-shape assertion for the shop-NULL state is missing — a harness nicety, not a spec gap. |
| D4 — intersection semantics | Yes | Acceptable. Implementation present; just not exercised with differing values (S3). |
| D5 — Edge validation branches | Yes | Acceptable as deferral but flags W2: stable-error contract clauses are unexecuted-proven. Should be closed before the change is called fully verified. |
| D6 — Fase 3 lead-time re-enforcement | Yes | Acceptable. Fase 3 is out of scope (`proposal.md:16-17`). |
| D7 — no-store response header | Yes | Acceptable as deferral but flags W1: first-class spec clause unexecuted-proven at the response level. |
| D8 — token rotation / value preservation | Yes | Acceptable. DDL guarantees non-NULL+unique by construction; rotation is a server op not yet exercised (W5). |
| P1–P5 — operational preconditions | Yes | Accurately described; all satisfied in this run (stack up, docker reachable, `.env.local` present, build present, a future day with slots present — E2E passed). |

### Command Results

1. `npm test` → 0 — 8 files / 55 tests passed (1.03s).
2. `npm run typecheck` → 0 — `tsc --noEmit`, no errors.
3. `npm run lint` → 0 — `eslint .`, no problems.
4. `npm run build` → 0 — Next 16.2.9 (Turbopack); routes `/`, `/_not-found`, `/reservar`.
5. `SUPABASE_TEST_NETWORK=supabase_network_conexion-db npm run test:db` → 0 — pgTAP 1 file / 68 assertions, PASS.
6. `npm run test:e2e` → 0 — Playwright 12 tests passed.

### Verdict

**PASS WITH WARNINGS** — 15/15 tasks complete; all six evidence commands exit 0; 23/28 scenarios fully proven with 5 partial. Zero blockers, zero critical findings. The five partials (D1/D5/D7/D8 + two-barber data-only expansion) are honest, documented deferrals in `deferred-coverage.md`; W1 (no-store header) and W2 (Edge validation branches) are the two spec-level clauses that remain unexecuted-proven and should be closed before the change is treated as fully verified.
