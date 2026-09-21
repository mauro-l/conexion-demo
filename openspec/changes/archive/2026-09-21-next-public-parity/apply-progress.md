# Apply Progress: next-public-parity — Fase 1 (single PR, maintainer-approved `size:exception`)

## Scope of this batch

Fase 1 only: replace the Astro SSR landing with one Next.js 16 App Router route at `/`
that reads the configured barbershop through the existing Edge Functions and renders the
hero, barbershop information, and service catalog. No booking flow, no `/reservar`, no
selector, no barber list. `supabase/**` is untouched. Delivery is a separate human
decision: the working tree is intentionally left **uncommitted**.

Mode: **Standard** (`strict_tdd: false` in `openspec/config.yaml`). No TDD module loaded.

## Baseline (task 1.1)

`node_modules` was drifted before apply: `npm ls astro` reported
`astro@7.3.2 invalid: "^4.16.0"` and `@astrojs/node@11.1.5 invalid: "^8.3.4"` with
`ELSPROBLEMS`. A clean `npm ci` restored the locked `astro@4.16.19` /
`@astrojs/node@8.3.4`; the pre-migration baseline was `npm test` → 2 files / 8 tests
passed. Every result below was produced after a **fresh post-migration `npm ci`**.

## Files created

| File | Purpose |
|---|---|
| `app/layout.tsx` | Root layout: `lang="es"`, `data-theme="light"`, `suppressHydrationWarning`, `metadataBase`, Google Fonts links, raw in-`<head>` theme bootstrap script. |
| `app/page.tsx` | `/` Server Component: server-only slug, `loadLanding` (React `cache`), `generateMetadata`, `notFound()` only on `PUBLIC_RESOURCE_NOT_FOUND`, `dynamic = 'force-dynamic'`. |
| `app/not-found.tsx` | Spanish public not-found experience, shared topbar. |
| `app/globals.css` | Theme tokens and component styles ported verbatim from `src/styles/tokens.css`. |
| `components/ThemeSwitch.tsx` | Sole Client Component; lazy `useState` initializer, `useSyncExternalStore` mount gate, `conexion-theme` persistence. |
| `components/public/PublicHeader.tsx` | Server topbar: brand + theme control. |
| `components/public/PublicHero.tsx` | Cover (`next/image`, local `public/cover.jpg`) + identity block; carries `PublicInfo` as children to preserve DOM. |
| `components/public/PublicInfo.tsx` | Conditional contact rows; no fabricated defaults. |
| `components/public/ServiceCatalog.tsx` | DTO-driven service tickets; conditional `description`; inert CTA. |
| `lib/site-config.server.ts` | `getConfiguredSlug()` + validated `getSiteOrigin()`. |
| `lib/public-api.server.ts` | Server-only Edge reads: 5s abort, `revalidate: 60`, DTO validation, `allSettled` precedence, `loadPublicPageData`. |
| `lib/theme.ts` | Ported unchanged from `src/lib/theme.ts`. |
| `types/public.ts` | Exact context/catalog DTOs; `barbers[]` retained, unrendered. |
| `lib/public-api.server.test.ts`, `lib/site-config.server.test.ts` | Node-environment unit tests (19). |
| `components/ThemeSwitch.test.tsx`, `components/public/ServiceCatalog.test.tsx`, `components/public/PublicInfo.test.tsx` | jsdom component tests (8). |
| `tests/e2e/profile.spec.ts` (retargeted), `tests/e2e/not-found.spec.ts` | Playwright: landing parity at `/` and unknown-slug not-found. |
| `eslint.config.mjs` | Flat config from `eslint-config-next/core-web-vitals` + `/typescript`. |
| `next.config.ts` | `distDir` from `NEXT_DIST_DIR` so the second Playwright dev server does not race `.next`. |
| `.env.example` | Documents the four server-only variables. |
| `vitest.config.ts`, `playwright.config.ts`, `tsconfig.json` | Next/Vitest/Playwright configuration. |

## Files modified

| File | Change |
|---|---|
| `package.json` | Astro scripts/deps removed; `dev`/`build`/`start`/`lint`/`typecheck`/`test`/`test:e2e`; Next 16.2.9 + React 19 + flat ESLint + Vitest + Playwright. No `next lint`. |
| `package-lock.json` | Regenerated for the Next toolchain. |
| `vitest.setup.ts` | `matchMedia` stub guarded by `typeof window !== 'undefined'` so Node-environment suites share the setup file. |
| `tsconfig.json` | Next settings, `~/* -> ./*`, `exclude: ["node_modules", "supabase"]` (Edge Functions are Deno). Next added `.next/dev/types/**/*.ts` and set `jsx: react-jsx`. |
| `.gitignore` | Ignores `.next/`, `.next-unknown-slug/`, `out/`, `tsconfig.tsbuildinfo`, `playwright-report/`. |

## Files deleted

`astro.config.mjs` and the whole `src/` tree (`pages/`, `layouts/`, `components/`,
`lib/`, `styles/`, `types/`, `env.d.ts`), plus generated `dist/`, `.astro/`,
`test-results/`.

## Decisions taken

- **DTO validation is structural, not exhaustive.** The validators require
  `barberia.name` (string), `barbers` (array), and service `name`/`durationMinutes`/
  `price` types. This deliberately accepts the current live phase9 payload (see
  *Issues found*) instead of turning a backend that is behind the migration into a 500.
- **`dynamic = 'force-dynamic'`.** The slug is server-only config, so the route resolves
  per request; `next: { revalidate: 60 }` on the two GETs is the only cached read surface,
  giving the accepted ≤60s bounded eventual consistency. This also keeps `next build`
  free of build-time backend/credential coupling.
- **Two Playwright projects.** `landing` (port 3000, `profile.spec.ts`) and `not-found`
  (port 3100, `not-found.spec.ts` with `BARBERSHOP_PUBLIC_SLUG=zz-unknown-slug` and a
  separate `NEXT_DIST_DIR`). Credentials are read from `.env` at config load via
  `process.loadEnvFile`; no literal credential remains in any config.
- **`next/image` with explicit `width={950} height={634}`.** Local asset only; no
  `images.remotePatterns`, no remote host.
- **Google Fonts links preserved** in `app/layout.tsx` for token parity. The
  `@next/next/no-page-custom-font` rule is disabled with a one-line rationale because the
  App Router root layout applies globally, so the `pages/_document` guidance does not
  apply. No remote asset is fetched at implementation time; runtime font requests are the
  same ones the Astro layout made.
- **`ThemeSwitch` mount gate via `useSyncExternalStore`.** The lint rule
  `react-hooks/set-state-in-effect` rejects the previous `setMounted`-in-effect pattern;
  `useSyncExternalStore(subscribe, () => true, () => false)` provides a hydration-stable
  "mounted" flag while keeping the required lazy `useState` initializer.
- **Vitest environments split per file.** Server-boundary suites declare
  `// @vitest-environment node` because jsdom's `AbortSignal` is incompatible with Node's
  `fetch` (it surfaced as `NETWORK_ERROR`); component suites stay in jsdom.

## Work Unit Evidence

| Unit | Focused test command and exact result | Runtime harness command/scenario and exact result | Rollback boundary |
|---|---|---|---|
| 1 — Toolchain swap | `npm run lint` → exit 0, no output; `npm run typecheck` → exit 0, no output | `N/A` — no runtime surface in this unit | `package.json`, `package-lock.json`, `eslint.config.mjs`, `tsconfig.json`, `vitest.config.ts`, `playwright.config.ts`, `next.config.ts`, `.env.example` |
| 2 — Server boundary + types | `npm test` → `lib/site-config.server.test.ts (7)`, `lib/public-api.server.test.ts (12)` passed | Node `http` mock server exercises timeout, error mapping, DTO rejection, Edge-only path, 404/500 precedence | `lib/*.server.ts`, `lib/*.test.ts`, `types/public.ts` |
| 3 — Landing UI at parity | `npm run build` → exit 0, `ƒ /`, `○ /_not-found`; component suites passed | `npm run dev` + Playwright on `/`: hero/catalog from DTO, conditional rows, inert CTA, local cover, pre-paint theme | `app/`, `components/` |
| 4 — Fresh-install verification | `npm ci` then `lint`/`typecheck`/`build`/`test` all exit 0 | Fresh `npm ci` + `npx playwright test` → 9 passed | Verification-only; no artifact to revert |

## Verification commands (real output)

```text
$ npm run lint
> eslint .
(exit 0, no output)

$ npm run typecheck
> tsc --noEmit
(exit 0, no output)

$ npm run build
▲ Next.js 16.2.9 (Turbopack)
✓ Compiled successfully in 1551ms
  Finished TypeScript in 2.2s
✓ Generating static pages using 4 workers (2/2) in 292ms

Route (app)
┌ ƒ /
└ ○ /_not-found
(exit 0)

$ npm test
 ✓ lib/site-config.server.test.ts (7 tests)
 ✓ lib/public-api.server.test.ts (12 tests)
 ✓ components/public/PublicInfo.test.tsx (2 tests)
 ✓ components/ThemeSwitch.test.tsx (3 tests)
 ✓ components/public/ServiceCatalog.test.tsx (3 tests)
 Test Files  5 passed (5)
      Tests  27 passed (27)
(exit 0)

$ npx playwright test
Running 9 tests using 6 workers
 ✓ [landing] renders hero and service catalog from the public DTOs
 ✓ [landing] renders only the information rows that have values
 ✓ [landing] does not expose internal identifiers, credentials, or the configured slug
 ✓ [landing] keeps booking controls out, the CTA inert, and no fabricated defaults
 ✓ [landing] serves the approved local cover asset
 ✓ [landing] applies the stored theme before paint and toggles it
 ✓ [landing] returns 404 for the removed dynamic route and unknown paths
 ✓ [not-found] renders the not-found page for an unknown configured slug
 ✓ [not-found] does not reveal the configured slug or offer a booking route
 9 passed (10.3s)
(exit 0)
```

Server-only facts re-verified after the migration:

```text
$ curl .../rest/v1/Barberia?select=id&limit=1   (apikey: anon)  -> HTTP 401 {"code":"42501","message":"permission denied for table Barberia"}
$ curl .../rest/v1/Barbero?select=id&limit=1    (apikey: anon)  -> {"code":"42501","message":"permission denied for table Barbero"}
$ information_schema.role_table_grants where grantee='anon'     -> zero rows for schema public
$ grep -rl '<anon key>|<SUPABASE_URL>|conexion-barberia|NEXT_PUBLIC' .next/static -> no matches (12 JS/JSON chunks scanned)
```

`public/cover.jpg` is a baseline JPEG, 950x634, 370,862 bytes — the approved local asset.

## Task state

- [x] 1.1 Clean `npm ci` baseline plus recorded `ELSPROBLEMS` drift.
- [x] 1.2 Toolchain swapped to Next 16.2.9 / React 19 with flat ESLint; Astro removed.
- [x] 1.3 `~/* -> ./*` in `tsconfig.json` and Vitest; Playwright on `localhost:3000` `/` via `npm run dev` with no literal credentials.
- [x] 1.4 Astro pages, layouts, components and configuration deleted.
- [x] 2.1 `types/public.ts` DTOs (seven `barberia` fields, `barbers[]` retained, nullable catalog `description`).
- [x] 2.2 `lib/site-config.server.ts`.
- [x] 2.3 `lib/public-api.server.ts` server-only rewrite.
- [x] 2.4 `lib/theme.ts` ported unchanged.
- [x] 3.1 `app/layout.tsx` + `app/globals.css`.
- [x] 3.2 `app/page.tsx` + the four public Server Components.
- [x] 3.3 `components/ThemeSwitch.tsx` sole Client Component.
- [x] 3.4 `app/not-found.tsx`; `app/b/[slug]` gone; `profile.spec.ts` retargeted.
- [x] 4.1 Vitest coverage for the boundary and rendering contracts.
- [x] 4.2 Playwright parity, privacy, theme, asset, and not-found coverage.
- [x] 4.3 Fresh `npm ci` then all five commands green.

## Workload / PR boundary

- Mode: **single PR with maintainer-approved `size:exception`** (the user already decided
  this; no chain, no split).
- Boundary: starts from the Astro landing on the clean phase9 baseline; ends with the
  Next App Router landing at `/` and a green Next verification surface. Does not include
  the Edge Functions, RPCs, migrations, RLS, grants, or any booking flow.
- Authored review surface, excluding the generated lockfile: **≈2,997 changed lines**
  (333 tracked additions + 1,087 deletions of the Astro tree + 1,577 new source lines).
  The lockfile contributes a further ≈10,328 lines. This is over the 400-line budget; the
  exception is the approved delivery decision, and no comments, docs, tests, or blank
  lines were removed to shrink it.

## Deviations from design.md

- **`lib/site-config.server.ts` also owns the Supabase credential read** implicitly: the
  API client reads `SUPABASE_URL`/`SUPABASE_ANON_KEY` from `process.env` directly rather
  than through a `site-config` accessor, keeping the module surface minimal. Environment
  names match the design exactly.
- **`next.config.ts` added** to expose `distDir` via `NEXT_DIST_DIR` for the second
  Playwright dev server. Not in the design's file tree; required to satisfy the
  unknown-slug E2E fixture without `.next` lock contention.
- **`.env.example` added** to document the four server-only variables; the design assumed
  an already-configured environment.
- **Vitest per-file environments** (`// @vitest-environment node`) added because the
  design only specified "Vitest retains jsdom/setup".
- **`PublicHero` composes `PublicInfo` as children** so the hero `<section class="hero
  container">` keeps the exact Astro DOM and the ported CSS stays visually unchanged.
- **Service descriptions no longer fall back to the Astro `prototypeDetails` map.** Those
  four strings were fabricated fallbacks; the hard constraint forbids new fabricated
  defaults, so `description` is rendered only when the DTO provides it.

## Issues found

- **BLOCKER for full spec parity (outside apply scope): `phase10_public_landing_details`
  is not applied.** `supabase_list_migrations` shows the live project stops at
  `phase9_public_barberia_discovery` (+ `phase9_cliente_telefono_canonico`), and a live
  read of `public-context` returns only `barberia: { name, description }` while
  `public-catalog` omits `description`. The delta specs require the seven-field context
  DTO and the four-field catalog DTO, and the design asserts the fallback removal is
  parity-preserving because the seed stores identical values. The seed **file** does, but
  the live database cannot until that migration is applied and the seed re-run. This
  change is forbidden from touching `supabase/**`, so the orchestrator must apply the
  migration (and re-seed) before `sdd-verify`; until then the four info rows and the
  service disclosures render nothing, which is a visible difference from the Astro app's
  fallback-enhanced output.
- The two unpublished `Barberia` rows have `public_slug = NULL`, so an unpublished E2E
  fixture cannot be constructed without a database write. The E2E covers the unknown
  configured slug; unknown-vs-unpublished identity is the backend contract already proven
  in the archived `web-publica-reservas` PR 1 and asserted by the unit test.
- React logs a development warning (`Encountered a script tag while rendering React
  component`) for the mandated raw `<script>` in `<head>`. It is expected for that exact
  requirement, and the flash-free-theme E2E test proves the script executes before paint.
- `npm` prints install-script allow-list warnings for `esbuild`, `sharp`, and
  `unrs-resolver`. They are non-fatal; `next/image` served `cover.jpg` successfully
  (`naturalWidth > 0`) and the full suite is green.
- `npm audit` reports 8 advisories (3 moderate, 3 high, 2 critical) in the dependency
  tree. Out of scope for this change and not remediated.
