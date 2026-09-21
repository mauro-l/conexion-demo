# Tasks: next-public-parity

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 1200–1800 (300–500 authored + lockfile) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High
Estimated changed lines: 1200–1800 (300–500 authored + lockfile)

### Suggested Work Units

| Unit | Goal | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|
| 1 | Toolchain swap on clean baseline | `npm ci && lint && typecheck` | N/A (no runtime surface) | `package.json`, lockfile, configs |
| 2 | Server boundary plus types | `npm test` | N/A (server-only) | `lib/*.server.ts`, `types/public.ts` |
| 3 | Landing UI at parity | `npm run build` | `dev` plus Playwright on `/` | `app/`, `components/` |
| 4 | Fresh-install verification | `lint && typecheck && test && build` + E2E | Fresh `npm ci` + E2E | Verification-only |

## Phase 1: Baseline and toolchain

- [x] 1.1 Run clean `npm ci`; record the `ELSPROBLEMS` drift (`astro` 7.3.2 vs 4.16.19 locked). Prior passes invalid.
- [x] 1.2 Swap `package.json`/lockfile to Next 16.2.9 + React 19 with `lint` (`eslint .`, flat `eslint-config-next`), `typecheck` (`tsc --noEmit`), `build` (`next build`), Vitest, Playwright. Drop Astro and `astro check`; never `next lint`.
- [x] 1.3 Next `tsconfig.json` with `~/* -> ./*`; `vitest.config.ts` `~` to `./`; Playwright on `localhost:3000` `/` via `npm run dev`, no literal env. No test rewrites.
- [x] 1.4 Delete Astro pages, layouts, components, config.

## Phase 2: Server data boundary (needs Phase 1)

- [x] 2.1 Create `types/public.ts`: exact context DTO (seven `barberia` fields plus `barbers[]`) and catalog DTO (`name`, `durationMinutes`, `price`, nullable `description`). Keep `barbers[]` unrendered.
- [x] 2.2 Create `lib/site-config.server.ts`: `getConfiguredSlug()` for server-only `BARBERSHOP_PUBLIC_SLUG`; validated `PUBLIC_SITE_ORIGIN` (localhost dev fallback, fail-clear prod).
- [x] 2.3 Rewrite `lib/public-api.server.ts` server-only: env creds (never `NEXT_PUBLIC_*`), 5s abort, `revalidate: 60` on context/catalog GETs only, `allSettled` non-404 precedence, `notFound()` only on `PUBLIC_RESOURCE_NOT_FOUND`, else 500. Edge/RPC/grants untouched; `anon` zero grants.
- [x] 2.4 Port `lib/theme.ts` unchanged.

## Phase 3: App Router landing UI (needs Phase 2)

- [x] 3.1 Create `app/layout.tsx` (`lang="es"`, `data-theme="light"`, `suppressHydrationWarning`, bootstrap script, `metadataBase`) plus `app/globals.css` from tokens, no visual changes.
- [x] 3.2 Create `app/page.tsx` plus `PublicHeader`/`PublicHero`/`PublicInfo`/`ServiceCatalog` Server Components: DTO-only render, `next/image` for `public/cover.jpg` (no `remotePatterns`), conditional nullables, inert CTAs and no `/reservar`, no selector or barber list, drop five seed-identical fallbacks (`b/[slug].astro:39-45`). `whatsapp_url` `'#'` out of scope.
- [x] 3.3 Create `components/ThemeSwitch.tsx` as the sole Client Component.
- [x] 3.4 Create `app/not-found.tsx` (Spanish); remove `app/b/[slug]`; retarget `profile.spec.ts` to `/` plus `/b/...` absence.

## Phase 4: Fresh-install verification (needs Phase 3)

- [x] 4.1 Vitest: timeout, error mapping, DTO rejection, 60s revalidation, 404/500 precedence, Edge-only reads, slug privacy, retained `barbers[]`, no selector.
- [x] 4.2 Playwright: `/` parity, nullables, inert CTAs, local cover, flash-free theme, no IDs/creds/slug in HTML or `.next/static`, no selector, unknown/unpublished fixtures (60s staleness accepted).
- [x] 4.3 Fresh `npm ci`, then all five commands green; Edge/RPC, DTO privacy, `anon` zero grants unchanged.

## Apply outcome

All 15 tasks implemented and verified on a fresh `npm ci`:

| Command | Observed result |
|---|---|
| `npm run lint` | exit 0, no output |
| `npm run typecheck` | exit 0, no output |
| `npm run build` | exit 0, `ƒ /` dynamic, `○ /_not-found` static |
| `npm test` | exit 0, 5 files / 27 tests passed |
| `npx playwright test` | exit 0, 9 tests passed (2 projects) |

### Blocker for full spec parity (outside apply edit scope)

`phase10_public_landing_details` is **not applied** to project `vcgyiyrboumimwgdsitf`
(the applied migration list stops at `phase9_public_barberia_discovery` plus
`phase9_cliente_telefono_canonico`). The live `public-context` therefore returns
`barberia: { name, description }` only, and `public-catalog` returns no
`description`. The four nullable info rows and the service descriptions render
nothing until that migration is applied and the demo seed re-run. Applying it
touches `supabase/**`, which this change forbids, so it must be resolved by the
orchestrator before `sdd-verify`.

The two unpublished `Barberia` rows have `public_slug = NULL`, so no unpublished
E2E fixture exists without a database write. Unknown-vs-unpublished identity was
proven at the backend in the archived `web-publica-reservas` PR 1.
