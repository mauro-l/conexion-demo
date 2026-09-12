# Tasks: Public Discovery Web

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 700–950 authored lines across migration, greenfield scaffold, functions, tests, and UI |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 migration/data → PR 2 scaffold/read boundary → PR 3 profile/selector/theme |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending user choice |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Apply public schema and seed one demo barber shop | PR 1 | Supabase SQL contract/grant probes | Non-production target `vcgyiyrboumimwgdsitf` | Revert sibling migration and remove seed rows |
| 2 | Bootstrap Astro SSR and public context/catalog boundary | PR 2 | `astro check`; `astro build`; `npm test` | Built SSR `/b/[slug]` plus Edge Function contract probes | Remove scaffold, functions, RPC calls, and tests |
| 3 | Deliver profile, catalog, selector, and theme UI | PR 3 | `npx playwright test` | Playwright `/b/[slug]` smoke | Remove UI/layout/island/style files |

## Phase 1: Cross-Repo Foundation (PR 1; migration owner)

- [ ] 1.1 **Cross-repo work unit:** create/apply the paired `phase9_public_barberia_discovery.sql` and rollback in the sibling repo (read-only here); verify unique `public_slug`, nullable `description`, `publicado`, narrow RPC ACLs, and zero `anon` table grants against `vcgyiyrboumimwgdsitf`. Do not create these files in this repo.
- [ ] 1.2 Operational/data step: publish one demo `Barberia`, one active `Barbero`, and its `Servicio` rows; verify context/catalog fixtures and record rollback deletion. Web implementation is blocked until 1.1 is applied.

## Phase 2: Scaffold and Read Infrastructure (PR 2; blocked by Phase 1)

- [ ] 2.1 Create `package.json`, `astro.config.mjs`, `tsconfig.json`, `src/env.d.ts`, `supabase/config.toml`; configure Astro SSR Node, React islands, `check`/`build`/`test`, Vitest, and Playwright.
- [ ] 2.2 Create `src/types/public.ts` and `src/lib/public-api.server.ts`; enforce exact context/catalog DTOs, server-only function calls, no IDs/secrets, and consistent 404 behavior. RED tests precede implementation: unknown/unpublished parity, exact keys, numeric duration, and direct anonymous REST denial.
- [ ] 2.3 Create `supabase/functions/_shared/http.ts`, `_shared/supabase.ts`, `public-context/index.ts`, and `public-catalog/index.ts`; implement GET/OPTIONS allow-list CORS, security headers, validation, narrow RPC calls, and redacted errors. Verify `astro check`, `astro build`, `npm test`.

## Phase 3: Profile and Interaction UI (PR 3; depends on Phase 2)

- [ ] 3.1 Create `src/layouts/PublicLayout.astro`, `src/pages/b/[slug].astro`, and `src/components/ServiceCatalog.astro`; render SSR profile/catalog only from DTOs, with no booking or secret leakage. Verify `npx playwright test`.
- [ ] 3.2 Create `src/components/ProfessionalSelector.tsx`; RED-test one barber selectable and two barber entries data-driven, then implement no-booking selection behavior.
- [ ] 3.3 Create `src/components/ThemeSwitch.tsx` and `src/styles/tokens.css`; RED-test toggle/bootstrap, then implement identical light/dark tokens, Playfair/Oswald swap, and pre-paint stored/system theme. Verify `npx playwright test`.

## Key Learnings

1. The migration is owned by the sibling repository and must precede web deployment.
2. The greenfield web has no test runner until the scaffold creates the Vitest and Playwright surface.
