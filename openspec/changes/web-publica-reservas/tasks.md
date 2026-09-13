# Tasks: Public Discovery Web

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 700–950 authored lines across migration, greenfield scaffold, functions, tests, and UI |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 migration/data → PR 2 scaffold/read boundary → PR 3 profile/selector/theme |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main (confirmed by the user) |

Decision needed before apply: No — resolved as chained PRs with `stacked-to-main`
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Apply public schema and seed one demo barber shop | PR 1 | Supabase SQL contract/grant probes | Live project `vcgyiyrboumimwgdsitf` (read-only probes) | Run the rollback migration and remove seed rows |
| 2 | Bootstrap Astro SSR and public context/catalog boundary | PR 2 | `astro check`; `astro build`; `npm test` | Built SSR `/b/[slug]` plus Edge Function contract probes | Remove scaffold, functions, RPC calls, and tests |
| 3 | Deliver profile, catalog, selector, and theme UI | PR 3 | `npx playwright test` | Playwright `/b/[slug]` smoke | Remove UI/layout/island/style files |

## Phase 1: Schema and Data Foundation (PR 1)

- [x] 1.1 Create the paired `supabase/migrations/phase9_public_barberia_discovery.sql` and `supabase/migrations/phase9_public_barberia_discovery_rollback.sql` IN THIS REPO. Applied the DDL to `vcgyiyrboumimwgdsitf` through the Supabase MCP. **Correction:** the database was NOT empty — `list_tables` row counts are stale `reltuples` estimates and the database actually held 2 `Barberia` and 1 `Barbero` rows. The migration is additive, so this caused no harm, and both pre-existing rows defaulted to `publicado = false`. Verified: unique `public_slug`, nullable `description`, `publicado`, function ACLs `{postgres, service_role}` only, and `anon` holding zero table and function grants.
- [x] 1.2 Operational/data step: seeded one demo `Barberia` (slug `conexion-barberia`, published), one active `Barbero` linked to the Dashboard-created auth user, and 4 `Servicio` rows. Verified end to end: `public_context` and `public_catalog` return the exact DTO shape with no internal ids; an unpublished slug and a nonexistent slug return the identical `PUBLIC_RESOURCE_NOT_FOUND` body. Rollback: run the rollback migration and delete the seeded rows.

## Phase 2: Scaffold and Read Infrastructure (PR 2; blocked by Phase 1)

- [x] 2.1 Create `package.json`, `astro.config.mjs`, `tsconfig.json`, `src/env.d.ts`, `supabase/config.toml`; configure Astro SSR Node, React islands, `check`/`build`/`test`, Vitest, and Playwright.
- [x] 2.2 Create `src/types/public.ts` and `src/lib/public-api.server.ts`; enforce exact context/catalog DTOs, server-only function calls, no IDs/secrets, and consistent 404 behavior. RED tests precede implementation: unknown/unpublished parity, exact keys, numeric duration, and direct anonymous REST denial.
- [x] 2.3 Create `supabase/functions/_shared/http.ts`, `_shared/supabase.ts`, `public-context/index.ts`, and `public-catalog/index.ts`; implement GET/OPTIONS allow-list CORS, security headers, validation, narrow RPC calls, and redacted errors. Verify `astro check`, `astro build`, `npm test`.

## Phase 3: Profile and Interaction UI (PR 3; depends on Phase 2)

- [ ] 3.1 Create `src/layouts/PublicLayout.astro`, `src/pages/b/[slug].astro`, and `src/components/ServiceCatalog.astro`; render SSR profile/catalog only from DTOs, with no booking or secret leakage. Verify `npx playwright test`.
- [ ] 3.2 Create `src/components/ProfessionalSelector.tsx`; RED-test one barber selectable and two barber entries data-driven, then implement no-booking selection behavior.
- [ ] 3.3 Create `src/components/ThemeSwitch.tsx` and `src/styles/tokens.css`; RED-test toggle/bootstrap, then implement identical light/dark tokens, Playfair/Oswald swap, and pre-paint stored/system theme. Verify `npx playwright test`.

## Key Learnings

1. The migration lives in this repo under `supabase/migrations/`; the SDD edit authority for this change covers only the web repo, so a sibling-repo migration was not deliverable.
2. The greenfield web has no test runner until the scaffold creates the Vitest and Playwright surface.
