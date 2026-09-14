# Apply Progress: web-publica-reservas — Work Unit 1 (PR 1)

## Scope of this batch

Implementation of Phase 1 / PR 1 only: schema migration, paired rollback, and demo seed.
The web scaffold, Edge Functions, and UI/theme remain for PRs 2 and 3.

## Files created

| File | Purpose |
|---|---|
| `supabase/migrations/phase9_public_barberia_discovery.sql` | Additive migration: `Barberia.public_slug`, `description`, `publicado`; narrow RPCs `public_context` / `public_catalog`; ACL locked to `service_role`. |
| `supabase/migrations/phase9_public_barberia_discovery_rollback.sql` | Reversible rollback: drops the two RPCs and the three added columns. |
| `supabase/seed_demo.sql` | Idempotent demo data: one published barbershop (`conexion-barberia`), one active barber, four services matching the HTML prototypes. |

## Decisions taken

### RPC return shapes

- `public_context(p_slug text)` returns exactly:
  ```json
  {
    "barberia": { "name": "...", "description": "..." },
    "barbers": [
      { "name": "...", "alias": "...", "description": "...", "photoUrl": "..." }
    ]
  }
  ```
- `public_catalog(p_slug text)` returns exactly:
  ```json
  { "services": [ { "name": "...", "durationMinutes": 40, "price": 23000 } ] }
  ```
- `durationMinutes` and `price` are projected with `to_jsonb(...)` so numeric columns become JSON numbers.
- No internal ids (`id`, `barberia_id`, `barbero_id`, `users_id`) and no `publicToken` appear in either payload.

### Not-found shape

A non-existent slug and an unpublished slug (`publicado = false`) return the identical body:
```json
{ "error": { "code": "PUBLIC_RESOURCE_NOT_FOUND", "message": "Resource not found", "retryable": false } }
```
This matches the stable error convention in `plan_web_publica.md` §6.

### Slug value

Demo seed uses `public_slug = 'conexion-barberia'`.

### Seed prerequisite

`Barbero.users_id` is `uuid NOT NULL` → `auth.users(id)`.
The seed attempts to create a deterministic demo auth user idempotently.
If direct `auth.users` inserts are blocked by schema or role limits, the seed fails loudly and the orchestrator/human must create the user via the Supabase Dashboard or Auth Admin API before re-running.

## Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `N/A` — no test runner exists in this greenfield repo until PR 2 creates the Astro/Vitest surface (design.md testing strategy). |
| Runtime harness command/scenario and exact result | Supabase MCP `apply_migration`. First attempt FAILED: `42P01: relation "public.barberia" does not exist`. Corrected by double-quoting the PascalCase identifiers; second attempt returned `{"success":true}`. Followed by read-only verification queries. |
| Rollback boundary | Run `supabase/migrations/phase9_public_barberia_discovery_rollback.sql`, then delete the demo rows seeded by `supabase/seed_demo.sql`. This removes only PR 1 artifacts and leaves `Servicio` schema, existing RLS policies, and `anon` grants untouched. |

## Orchestrator verification (completed)

1. ✅ `apply_migration` returned `{"success":true}` against `vcgyiyrboumimwgdsitf`.
2. ✅ `Barberia` now has `public_slug` (text), `description` (text), `publicado` (boolean NOT NULL DEFAULT false); all pre-existing columns untouched.
3. ✅ Function ACLs are `{postgres=X/postgres, service_role=X/postgres}` — `anon` and `authenticated` are absent.
4. ✅ `anon` holds zero table grants and zero function EXECUTE grants (union query returned `[]`).
5. ✅ `public_context('conexion-barberia')` returns the exact context DTO with no internal ids.
6. ✅ `public_catalog('conexion-barberia')` returns 4 services with numeric `durationMinutes` and `price`.
7. ✅ Non-enumeration PROVEN: an unpublished slug and a nonexistent slug both returned the byte-identical `PUBLIC_RESOURCE_NOT_FOUND` body.
8. ✅ Seed effects verified: 1 published `Barberia` (`conexion-barberia`), 1 active `Barbero`, 4 `Servicio` rows.
9. ✅ Temporary probe row `zz-temp-unpublished-probe` created for the non-enumeration test and deleted afterwards; verified `temp_restante = 0`.

## Task state

- [x] 1.1 Migration and rollback created, applied to `vcgyiyrboumimwgdsitf`, and verified.
- [x] 1.2 Seed executed; demo barbershop, barber and services verified through both RPCs.

## CORRECTION — the database was NOT empty

The initial `list_tables` introspection reported 0 rows for `Barberia`, `Barbero` and `Servicio`, and that claim was carried into `design.md` and `tasks.md`. **It was wrong.** `list_tables` row counts are stale `reltuples` estimates, not real counts. The database actually held 2 `Barberia` rows ("Barbería Piloto", "Barbería Demo") and 1 `Barbero` row ("Mauro Laime", with 5 `Servicio` rows in the unpublished "Barbería Demo").

Impact: none. The migration is purely additive; both pre-existing `Barberia` rows defaulted to `publicado = false`, so nothing pre-existing became publicly reachable. Future schema work on this project must use real `count(*)` queries, never `list_tables` row estimates.

## Workload / PR boundary

- Mode: chained PR slice
- Current work unit: PR 1 — schema and data foundation
- Boundary: starts from an empty `supabase/` directory; ends with migration, rollback, and seed files delivered. Does not include Astro scaffold, Edge Functions, or UI.
- Estimated review budget impact: ~240 authored lines across the three SQL files and this progress file; well under the 400-line attempt budget.

## Deviations from design.md

None — implementation matches design.md and the five specs.

## Issues found

- RESOLVED: `tasks.md` and `design.md` disagreed on the chain strategy. `tasks.md` now records `stacked-to-main`, confirmed by the user.
- `Barbero.activo` is nullable with no default (db-baseline.md §2). The seed sets `activo = true`; the RPCs filter `ba.activo = true`, so NULL rows are correctly treated as inactive.
- The generated SQL referenced the PascalCase tables unquoted, so the first application failed with `42P01`. Fixed and re-verified; see Work Unit Evidence.
- The initial "zero-row database" premise was wrong. See the CORRECTION section above.

---

## PR 2

### Scope of this batch

Bootstrap Astro SSR, the public DTO contracts, the server-only public API client, and the two anonymous Edge Functions that call the verified `public_context` / `public_catalog` RPCs.

### Files created

| File | Purpose |
|---|---|
| `package.json` | Astro/React/Node SSR dependencies, scripts `check`/`build`/`test`, Vitest and Playwright dev deps. |
| `astro.config.mjs` | `output: 'server'` with `@astrojs/node` standalone adapter and `@astrojs/react`. |
| `tsconfig.json` | Strict Astro TypeScript, path alias `~/*`. |
| `src/env.d.ts` | Astro client types and public env vars (`PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`). |
| `vitest.config.ts` | Vitest Node environment, test glob `src/**/*.{test,spec}.{ts,tsx}`. |
| `src/types/public.ts` | Exact DTO contracts: `Barber`, `Context`, `Catalog`, `PublicError`. |
| `src/lib/public-api.server.ts` | Server-only client that calls `/functions/v1/public-context` and `/functions/v1/public-catalog`; validates slug format; throws `PublicApiError`. |
| `src/lib/public-api.server.test.ts` | Vitest unit tests: exact context keys, numeric duration/price, identical unknown/unpublished 404, invalid slug rejection, Edge Function path (not PostgREST). |
| `supabase/config.toml` | Links project `vcgyiyrboumimwgdsitf`; disables JWT verification on the two public GET functions. |
| `supabase/functions/_shared/supabase.ts` | Service-role Supabase client using `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from `Deno.env`. |
| `supabase/functions/_shared/http.ts` | Allow-list CORS (`PUBLIC_SITE_ORIGIN` + `localhost:4321`), security headers (CSP, Referrer-Policy, X-Content-Type-Options, Permissions-Policy), JSON helpers. |
| `supabase/functions/_shared/handler.ts` | Common handler for anonymous GET/OPTIONS Edge Functions: slug validation, RPC call, identical `PUBLIC_RESOURCE_NOT_FOUND` 404, redacted 500. |
| `supabase/functions/public-context/index.ts` | Edge Function wired to `public_context(p_slug)`. |
| `supabase/functions/public-catalog/index.ts` | Edge Function wired to `public_catalog(p_slug)`. |

### Decisions taken

- Slug validation in functions and client: `^[a-z0-9-]{1,63}$`. Invalid slugs return `INVALID_INPUT` 400.
- CORS allow-list: `PUBLIC_SITE_ORIGIN` env var plus `http://localhost:4321`; methods `GET, OPTIONS`; headers `Content-Type, Accept`; `Vary: Origin`; no credentials.
- Security headers are returned on every response, including OPTIONS and errors.
- Functions are configured `verify_jwt = false` because they are anonymous public endpoints; the client sends no Supabase secrets.
- Internal errors are logged and returned as generic `INTERNAL_ERROR` 500; no SQL details, stack traces, or internal IDs leak.
- A shared `handlePublicRead` helper removes duplication between the two functions while keeping them as separate deployable units.

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `npm test` → `Test Files 1 passed (1)`, `Tests 5 passed (5)`, `Duration 365ms`. |
| Runtime harness command/scenario and exact result | `npm run check` → `0 errors`, `0 warnings`, `0 hints`; `npm run build` → `output: "server"`, adapter `@astrojs/node`, `Server built in 1.21s`, `Complete!`. |
| Rollback boundary | Delete the 14 files listed above, remove `node_modules/`/`dist/`/`package-lock.json`, and revert `tasks.md`/`apply-progress.md`. PR 1 database objects remain untouched. |

### Verification commands (real output)

```text
$ npm run check
Result (4 files):
- 0 errors
- 0 warnings
- 0 hints

$ npm run build
21:15:00 [build] output: "server"
21:15:00 [build] adapter: @astrojs/node
...
21:15:01 [build] Complete!

$ npm test
RUN  v2.1.9 /home/mauro/conexion-demo
✓ src/lib/public-api.server.test.ts (5 tests) 44ms
Test Files  1 passed (1)
Tests  5 passed (5)
```

### Task state

- [x] 2.1 Astro scaffold created and configured.
- [x] 2.2 DTOs and server-only client created, with unit tests.
- [x] 2.3 Edge Functions and shared helpers created.

### Orchestrator deployment and smoke test (completed)

Both Edge Functions were deployed to `vcgyiyrboumimwgdsitf` with `verify_jwt = false` and smoke-tested over HTTPS.

**BUG FOUND AND FIXED DURING THE SMOKE TEST:** the first deployment exported a bare default function (`export default (req: Request) => ...`). The Supabase Edge runtime does not wire that as a request handler: the isolate logged `booted (time: 25ms)`, never produced a response, and was killed with `reason: "WallClockTime"`. Both entrypoints now call `Deno.serve((req) => handlePublicRead(...))`, which is the form the runtime actually serves. Redeployed as version 2.

Smoke test results against `https://vcgyiyrboumimwgdsitf.supabase.co`:

| Check | Result |
|---|---|
| `GET /functions/v1/public-context?slug=conexion-barberia` | **200** + exact context DTO |
| `GET /functions/v1/public-catalog?slug=conexion-barberia` | **200** + 4 services with numeric `durationMinutes` / `price` |
| `GET .../public-context?slug=no-such-slug` | **404** + `PUBLIC_RESOURCE_NOT_FOUND` |
| `GET .../public-context?slug=INVALID%21` | **400** + `INVALID_INPUT` |
| `OPTIONS` with `Origin: http://localhost:4321` | **204** + `access-control-allow-origin: http://localhost:4321` |
| `OPTIONS` with `Origin: https://evil.example` | **204** with NO `access-control-allow-origin` |
| `POST` | **405** + `METHOD_NOT_ALLOWED` |
| `anon` direct REST read of `public."Barberia"` | **401** `42501 permission denied for table Barberia` |

Still open: `PUBLIC_SITE_ORIGIN` must be set for the deployed web origin. Continue to PR 3 (profile page, layout, service catalog, selector, theme).

### Workload / PR boundary

- Mode: chained PR slice
- Current work unit: PR 2 — scaffold and read infrastructure
- Boundary: starts after PR 1 verified database; ends with Astro build, typecheck, and unit tests green. Does not include pages, layout, selector, or theme.
- Estimated review budget impact: ~372 authored lines across code files; apply-progress excluded. Under the 400-line attempt budget.

### Deviations from design.md

- Added `supabase/functions/_shared/handler.ts` to share the common GET/OPTIONS/validate/RPC flow between the two functions; not in the original file list but keeps the PR under budget and reduces duplication.
- Did not create `src/pages/index.astro`; Astro builds successfully without pages when `output: 'server'` and the Node adapter are present. PR 3 will add `src/pages/b/[slug].astro`.

### Issues found

- The bare `export default` entrypoint form silently hangs at runtime. See the deployment section above. Fixed with `Deno.serve` and re-verified.
- A direct PostgreSQL check proved `anon` cannot read `public."Barberia"` (SQLSTATE `42501`, HTTP 401), confirming the read boundary is the only path.

---

## PR 3A and PR 3B

### Scope of this batch

Deliver the profile page, layout, service catalog, professional selector, and light/dark theme UI for the public discovery web. The work is split into two stacked slices on top of PR 2's scaffold, DTOs, and deployed Edge Functions.

### Files created / modified

| File | Purpose |
|---|---|
| `src/styles/tokens.css` | Theme tokens and component styles copied from both HTML prototypes; `:root` light, `:root[data-theme="dark"]` dark, heading font swap. |
| `src/lib/theme.ts` | Theme helpers: `getInitialTheme`, `applyTheme`, `toggleTheme`, plus storage key. Used by the inline head script and the island. |
| `src/components/ThemeSwitch.tsx` | Hydrated icon button that toggles light/dark and persists the choice. |
| `src/components/ProfessionalSelector.tsx` | Data-driven dropdown pill populated from the context DTO `barbers` list. |
| `src/components/ServiceCatalog.astro` | SSR service ticket list rendered from the catalog DTO. |
| `src/layouts/PublicLayout.astro` | Shell with topbar, Google Fonts, global tokens, pre-paint theme script, and theme switch island. |
| `src/pages/b/[slug].astro` | SSR route (`prerender = false`) that fetches context/catalog and renders the profile; returns the custom 404 page for unknown/unpublished slugs. |
| `src/pages/404.astro` | Custom not-found page reused by the dynamic route via `Astro.rewrite('/404')`. |
| `src/components/ThemeSwitch.test.tsx` | RED tests for bootstrap and toggle. |
| `src/components/ProfessionalSelector.test.tsx` | RED tests for one/two barber data-driven selection. |
| `playwright.config.ts` | Chromium-only config with `webServer` running `npm run preview` against `/b/conexion-barberia`. |
| `tests/e2e/profile.spec.ts` | Playwright smoke tests: DTO rendering, no internal IDs, selector, theme toggle, 404. |
| `package.json` | Added `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`. |
| `vitest.config.ts` | Switched environment to `jsdom`, added `esbuild.jsx: 'automatic'`, alias `~`, and `setupFiles`. |
| `vitest.setup.ts` | Jest-DOM matchers and `matchMedia` polyfill for component tests. |
| `src/lib/public-api.server.ts` | Added `process.env` fallback so the Node SSR preview/runtime can read `PUBLIC_SUPABASE_URL` / `PUBLIC_SUPABASE_ANON_KEY` even when they are not baked into the Vite build. |

### Decisions taken

- CSS is included via `<style is:global>@import '../styles/tokens.css';</style>` in `PublicLayout.astro`; Astro builds it into a hashed `_astro/*.css` asset.
- The pre-paint theme script is inlined in `<head>` so `data-theme` is set before the first paint, preventing FOUC.
- The 404 response uses `Astro.rewrite('/404')` to render `src/pages/404.astro` with status 404. Returning a plain `Response` with status 404 was being replaced by Astro's default error page.
- `public-api.server.ts` now reads `process.env` before `import.meta.env` so the same built artifact works with runtime env vars in the Node SSR preview/server.
- The profile page renders only DTO fields (name, description, barbers, services). Address/hours/rating rows from the prototypes are not shown because they are not in the public context DTO and would require hardcoded fake data.
- The "Reservar" CTA is rendered as a non-wired button to match the prototype ticket footer visually, with no booking behavior.

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `npm test` → `Test Files 3 passed (3)`, `Tests 11 passed (11)` |
| Runtime harness command/scenario and exact result | `npm run check` → `0 errors`, `0 warnings`, `0 hints`; `npm run build` → `Complete!`; `npx playwright test` → `4 passed` against built SSR preview hitting live Edge Functions |
| Rollback boundary | Delete the files listed above under `src/`, `tests/`, `playwright.config.ts`, `vitest.setup.ts`, and revert `package.json`/`vitest.config.ts`. PR 1/2 database objects and Edge Functions remain untouched. |

### Verification commands (real output)

```text
$ npm test
RUN  v2.1.9 /home/mauro/conexion-demo
✓ src/lib/public-api.server.test.ts (5 tests)
✓ src/components/ThemeSwitch.test.tsx (3 tests)
✓ src/components/ProfessionalSelector.test.tsx (3 tests)
Test Files  3 passed (3)
Tests  11 passed (11)

$ npm run check
Result (14 files):
- 0 errors
- 0 warnings
- 0 hints

$ npm run build
... Complete!

$ npx playwright test
Running 4 tests using 4 workers
✓ renders profile and catalog from DTOs with no internal IDs
✓ professional selector is data-driven and selectable
✓ theme switch toggles light and dark
✓ returns 404 for unknown slugs
4 passed
```

### Task state

- [x] 3.1 Public layout, profile page, and service catalog created.
- [x] 3.2 Professional selector created with RED unit tests.
- [x] 3.3 Theme switch and tokens created with RED unit tests.

### Split workload / PR boundaries

- Mode: chained PR slices with an explicit size exception for PR 3A
- PR 3A (`fb28273`): dependency lockfile, UI tokens, selector, theme switch, component tests, and browser-test configuration. The lockfile contributes 986 generated lines; this is the maintainer-approved size exception.
- PR 3B (`fd832ca`): public layout, SSR profile route, catalog, 404 route, runtime environment fallback, and Playwright smoke coverage.
- Rollback: revert PR 3B independently for the profile/catalog surface; revert PR 3A independently for the UI foundation and dependency/test tooling.

### Deviations from design.md

- Added `src/pages/404.astro` and used `Astro.rewrite('/404')` to serve a custom 404 page; not in the original design but required because Astro's Node adapter replaces a plain 404 `Response` with its default error page.
- Added `process.env` fallback in `public-api.server.ts` so runtime env vars work in the Node SSR server; the design assumed `import.meta.env` would be sufficient, but Vite bakes `import.meta.env` at build time.
- Added `@testing-library/jest-dom` and `jsdom` plus `vitest.setup.ts` to enable React component RED tests; the design only mentioned Vitest/Playwright.
- Did not reproduce the prototype's static address/hours/rating rows because those fields are not in the context DTO.

### Issues found

- Vite's SSR build inlines `import.meta.env` as a static object, so `PUBLIC_SUPABASE_URL`/`PUBLIC_SUPABASE_ANON_KEY` were not available at runtime unless baked in at build time. Fixed with a `process.env` fallback in the server-only API client.
- Returning `new Response(notFoundHtml, { status: 404 })` from an Astro route produced Astro's default 404 page instead of the custom body. Fixed by adding `src/pages/404.astro` and using `Astro.rewrite('/404')`.
- Playwright's Chromium binary needed system dependencies (`libnspr4`, etc.); installed with `npx playwright install-deps chromium`.
- Playwright's `webServer` URL check needed to target a route that returns 200 (`/b/conexion-barberia`) because the app has no root page.
