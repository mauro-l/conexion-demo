```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:a7c9afdd260c3d80268c91fd14cd5ee4df6411db262f3b07b0861419387fa6d7
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 7/7
scenarios: 18/18
test_command: npm test
test_exit_code: 0
test_output_hash: sha256:e2579b775871b1d64583ebd0926990e06799fcc2039e52a3513d0d90536b56d4
build_command: npm run build
build_exit_code: 0
build_output_hash: sha256:d18cceca05cb7f51e4a1c7b319e70909c15cb64d67ed1aaf4329e2304f9053b5
```

## Verification Report

**Change**: next-public-parity
**Version**: N/A
**Mode**: Standard

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 15 |
| Tasks complete | 15 |
| Tasks incomplete | 0 |

All 15 tasks (1.1–4.3) are checked `[x]` in `tasks.md`. The working tree is intentionally left uncommitted (single maintainer-approved `size:exception` PR). No `supabase/**` file appears in the working-tree diff, confirming the Edge Functions, RPCs, migrations, RLS, and grants are untouched by this change.

### Build & Tests Execution

Commands were run in the exact order that previously broke, so the ordering defect is genuinely exercised. `.next-unknown-slug/` still exists after the Playwright run (the `NEXT_DIST_DIR` output of the second dev server), so `npm run lint` really does lint against a populated second dist dir.

| Command | Exit | Observed result |
|---------|------|-----------------|
| `npx playwright test` | 0 | 9 tests passed (2 projects) |
| `npm run lint` | **0** | `eslint .`, no output (previously exit 1, 5030 problems) |
| `npm run typecheck` | 0 | `tsc --noEmit`, no output |
| `npm test` | 0 | 5 files / 27 tests passed |
| `npm run build` | 0 | `next build`, `ƒ /` dynamic + `○ /_not-found` static |

**Build**: ✅ Passed
```text
$ npm run build
> next build
▲ Next.js 16.2.9 (Turbopack)
✓ Compiled successfully in 1481ms
  Running TypeScript ...
  Finished TypeScript in 2.2s ...
  Collecting page data using 4 workers ...
  Generating static pages using 4 workers (0/2) ...
✓ Generating static pages using 4 workers (2/2) in 290ms
  Finalizing page optimization ...
Route (app)
┌ ƒ /
└ ○ /_not-found
(exit 0)
```

**Typecheck**: ✅ Passed
```text
$ npm run typecheck
> tsc --noEmit
(exit 0, no output)
```

**Tests**: ✅ 27 passed / ❌ 0 failed
```text
$ npm test
> vitest run
✓ lib/site-config.server.test.ts (7 tests)
✓ lib/public-api.server.test.ts (12 tests)
✓ components/public/PublicInfo.test.tsx (2 tests)
✓ components/ThemeSwitch.test.tsx (3 tests)
✓ components/public/ServiceCatalog.test.tsx (3 tests)
Test Files  5 passed (5)
     Tests  27 passed (27)
(exit 0)
```

**E2E**: ✅ 9 passed
```text
$ npx playwright test
✓ [landing] renders hero and service catalog from the public DTOs
✓ [landing] renders only the information rows that have values
✓ [landing] does not expose internal identifiers, credentials, or the configured slug
✓ [landing] keeps booking controls out, the CTA inert, and no fabricated defaults
✓ [landing] serves the approved local cover asset
✓ [landing] applies the stored theme before paint and toggles it
✓ [landing] returns 404 for the removed dynamic route and unknown paths
✓ [not-found] renders the not-found page for an unknown configured slug
✓ [not-found] does not reveal the configured slug or offer a booking route
9 passed
(exit 0)
```

**Lint**: ✅ Passed (the previously failing command)
```text
$ npm run lint
> eslint .
(exit 0, no output)
```

The `eslint.config.mjs` ignore list now reads `['dist/**', '.astro/**', '.next*/**', 'test-results/**', 'playwright-report/**']`. The `.next*/**` glob covers both `.next/` and `.next-unknown-slug/`, so the compiled chunks of the second Playwright dev server are no longer linted. The previous CRITICAL is **resolved**.

### Previous CRITICAL resolution

The single prior CRITICAL was that `npm run lint` exited 1 with 5030 findings (314 errors, 4716 warnings), all from `.next-unknown-slug/**`. After the parent's fix (`.next*/**` in the ESLint ignores), `npm run lint` now exits 0 with no output, verified against a still-populated `.next-unknown-slug/` directory. The ordering defect is closed: the five commands now pass in the exact order that previously broke.

### Spec Compliance Matrix

| Requirement | Scenario | Evidence | Result |
|-------------|----------|----------|--------|
| Next public scaffold, route, parity, and verification | Landing renders from public reads | E2E hero/catalog from live DTO; `h1.hero-title` contains DTO name | ✅ COMPLIANT |
| Next public scaffold, route, parity, and verification | Private configuration is not exposed | E2E + grep: 0 cred/slug/`NEXT_PUBLIC_` in `.next/static` | ✅ COMPLIANT |
| Next public scaffold, route, parity, and verification | Verification surface is Next-based | all five commands exit 0 (lint, typecheck, build, test, playwright) | ✅ COMPLIANT |
| Next public scaffold, route, parity, and verification | Missing public resource | not-found E2E project (404, indistinguishable) | ✅ COMPLIANT |
| Next public scaffold, route, parity, and verification | Phase-one booking posture | E2E: inert CTA, `/reservar` 404 | ✅ COMPLIANT |
| Next public scaffold, route, parity, and verification | Theme has no incorrect-theme flash | E2E stored-theme + pre-paint bootstrap | ✅ COMPLIANT |
| Next public scaffold, route, parity, and verification | Cover asset is approved | E2E local `cover.jpg`, no `picsum.photos` in render | ✅ COMPLIANT |
| Next public scaffold, route, parity, and verification | Domain remains configurable | `getSiteOrigin()`; no hardcoded `conexion-barberia.com` | ✅ COMPLIANT |
| Unique public identifier and non-enumeration | Duplicate slug rejected | `phase9_public_barberia_discovery.sql` unique index (unchanged) | ✅ COMPLIANT |
| Unique public identifier and non-enumeration | Unknown versus unpublished | `public-api.server.test.ts` identical-error assertion; not-found E2E project | ✅ COMPLIANT |
| Unique public identifier and non-enumeration | Slug is server-only | `getConfiguredSlug()` (env only); slug absent from HTML and `.next/static`/`.next/server` | ✅ COMPLIANT |
| Context DTO | Exact field set | `public-api.server.test.ts` deep-equal + live read (7 fields) | ✅ COMPLIANT |
| Edge Function/RPC-only read boundary | Anonymous direct-table probe | live probe: HTTP 401 / code `42501` on `Barberia`, `Barbero`, `Servicio` | ✅ COMPLIANT |
| Catalog DTO | Exact field set | `public-api.server.test.ts` + live read (4 fields incl. description) | ✅ COMPLIANT |
| DB-authoritative resolution | Duration, price, and description come from the database | RPC `to_jsonb(s.duracion)`/`to_jsonb(s.precio)`/`s.descripcion`; live numeric values | ✅ COMPLIANT |
| Selector rendered from the barbers list | Single barber today | E2E `.prof-select` count 0 | ✅ COMPLIANT |
| Selector rendered from the barbers list | Data-only expansion | `barbers[]` retained as array type; landing does not iterate it | ✅ COMPLIANT |
| Selector rendered from the barbers list | Booking-flow boundary | E2E: `/reservar` 404, inert CTA, no selector | ✅ COMPLIANT |

**Compliance summary**: 18/18 scenarios compliant.

### Correctness (Static Evidence)

| Requirement | Status | Notes |
|------------|--------|-------|
| Unique public identifier and non-enumeration | ✅ Implemented | `BARBERSHOP_PUBLIC_SLUG` resolved server-only in `getConfiguredSlug()`; slug never rendered, never in a URL, never in the client bundle. |
| Context DTO | ✅ Implemented | `types/public.ts` `Barberia` has exactly the seven fields; `barbers[]` retained with four fields; no internal ids, no `publicToken`. |
| Edge Function/RPC-only read boundary | ✅ Implemented | Client calls `/functions/v1/public-context|catalog` only; `anon` direct-table access returns 401/`42501` (live-verified). |
| Catalog DTO | ✅ Implemented | `Service` = `name`, `durationMinutes`, `price`, nullable `description`. |
| DB-authoritative resolution | ✅ Implemented | Values pass through DTO from the RPC; no client-supplied duration/price. |
| Selector rendered from the barbers list | ✅ Implemented | No selector or barber list rendered; `barbers[]` stays in the type for Fase 2. |
| Next public scaffold, route, parity, and verification | ✅ Implemented | Scaffold/route/parity/verification all correct; all five commands exit 0. |

### Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| Server/client boundary | ✅ Yes | Only `ThemeSwitch.tsx` carries `'use client'`; all other components are Server Components. |
| `/` resolves server-only slug; remove `/b/[slug]` | ✅ Yes | `app/b/` absent; `/b/<slug>` and `/reservar` return 404 (E2E-verified). |
| `revalidate: 60` on both GETs, no other cached reads | ✅ Yes | Only the two public GETs carry `next: { revalidate: 60 }` (single shared fetch path); unit test asserts `[60, 60]`. |
| `allSettled` non-404 precedence; `notFound()` only on `PUBLIC_RESOURCE_NOT_FOUND` | ✅ Yes | Unit tests + live dead-backend probe return HTTP 500 (not 404) for `NETWORK_ERROR`. |
| `PUBLIC_SITE_ORIGIN` for `metadataBase`, no hardcoded domain | ✅ Yes | `getSiteOrigin()`; localhost dev fallback; production fail-clear. |
| Local `public/cover.jpg` via `next/image`, no `remotePatterns` | ✅ Yes | `src="/cover.jpg"`, `width/height` set; no remote host; no `picsum.photos`. |
| Nullable fields render conditionally, no fabricated defaults | ✅ Yes | The five Astro fallbacks are gone; no `??` fabricated defaults remain in render paths. |
| Theme bootstrap before paint, `suppressHydrationWarning` | ✅ Yes | Raw `<script>` in `<head>`; `<html ... suppressHydrationWarning>`; E2E flash-free theme passes. |

### Issues Found

**CRITICAL**: None

**WARNING**:
1. Non-hermetic verification surface (unchanged by the fix). Running the E2E suite (or `next dev` with a custom `NEXT_DIST_DIR`) auto-mutates the tracked `tsconfig.json`: Next appends dist-dir type paths to `include`. The current `include` array contains `.next/types/**/*.ts`, `.next/dev/types/**/*.ts`, `.next-unknown-slug/types/**/*.ts`, and `.next-unknown-slug/dev/types/**/*.ts`, and the file is DIRTY in git (38 insertions, 3 deletions). The `.next-unknown-slug` paths leak the second-server dist-dir name into a source-controlled config as a side effect of the test suite. The ESLint fix did not touch this.

**SUGGESTION**:
1. Stale Astro environment names (unchanged by the fix). The local `.env` still contains `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY` (the old Astro names) alongside the new `SUPABASE_URL`/`SUPABASE_ANON_KEY`. The application correctly reads the new names; the old names are dead entries, are not `NEXT_PUBLIC_*`, and do not leak. Removing them would avoid confusion.
2. E2E info-row and service-description assertions remain count-based (unchanged by the fix). `profile.spec.ts` asserts `.info-row` count equals the non-null DTO count and `.ticket` count equals the service count, and never asserts a concrete rendered value for the address or a service description. The hero `name` is asserted concretely, but the info rows and descriptions are only asserted for presence/count. Asserting at least one concrete value at E2E would guard against empty-content regressions now that phase10 data is populated.
3. E2E remains live-backend-dependent (unchanged by the fix). `profile.spec.ts`/`not-found.spec.ts` read `SUPABASE_URL`/`SUPABASE_ANON_KEY` from `.env` and assert against the live DTO. This was accepted in the design, but the suite fails in an offline/clean CI without the seeded `conexion-barberia` slug.

### Verdict

PASS WITH WARNINGS

The previous CRITICAL is resolved: `npm run lint` now exits 0 with no output, verified in the exact order that previously broke (Playwright → lint → typecheck → test → build) against a still-populated `.next-unknown-slug/` directory. All 7 requirements and 18 scenarios are compliant, and all five verification commands exit 0. One WARNING (non-hermetic `tsconfig.json` rewrite by `next dev`) and three SUGGESTIONs remain; none is a correctness or security defect.
