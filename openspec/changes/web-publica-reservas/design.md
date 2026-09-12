# Design: Public Discovery Web

## Technical Approach

Bootstrap a server-rendered Astro application with React islands. `/b/[slug]` fetches only public DTOs from two anonymous Edge Functions during Astro SSR; the browser never receives Supabase credentials or table access. Astro renders the profile and catalog, while small islands handle the professional selector and theme switch. This implements the five specs, `plan_web_publica.md` §§4, 6, 7, 14, and the live schema in `db-baseline.md`.

## Architecture Decisions

| Decision | Choice | Alternatives / rationale |
|---|---|---|
| Migration home | Add `public_slug`, nullable `description`, and `publicado` to `Barberia` in the sibling repo’s `supabase/migrations/phase9_public_barberia_discovery.sql`, with a paired rollback file. Apply there against the verified shared project, before deploying web functions. | The sibling repo is the only observed migration owner and has the linked-project record; the web repo has no Supabase scaffold. Never write the sibling from this change. |
| Public read boundary | Edge Functions use a server-only `service_role` client to invoke narrow `SECURITY INVOKER` RPCs (`public_context`, `public_catalog`) with `REVOKE EXECUTE FROM PUBLIC, anon, authenticated` and `GRANT` only to `service_role`. No generic table proxy; `anon` table grants remain empty. | A private `SECURITY DEFINER` connection would reduce query coupling but needs unobserved private-schema/DB connection infrastructure. This choice is deployable with the existing Supabase client pattern; the service key remains server-only. |
| Description | Add nullable `Barberia.description`; the RPC maps null to `""`. | Static text would diverge from the required context DTO and hardcoded prototype content. |
| Publication | `public_slug` is unique and `publicado` defaults false. Reads require both; missing and unpublished slugs return the same 404 body. | Slug-presence-only cannot retain an unpublished slug; a publication table is unnecessary for this single-boolean lifecycle. |
| Catalog | Join published `Barberia` → its sole active `Barbero` → `Servicio`; do not deduplicate. In the RPC JSON projection, cast numeric `Servicio.duracion` to JSON number `durationMinutes`; clients cannot supply it. | No `Servicio` migration, public token, or selected-barber filtering. Multiple-barber catalog behavior remains future scope. |
| Astro structure | Root is `/home/mauro/conexion-demo`; create SSR `src/pages/b/[slug].astro` (`prerender = false`) plus Node adapter. Server-only `src/lib/public-api.server.ts` calls the functions. `ProfessionalSelector.tsx` and `ThemeSwitch.tsx` are the only hydrated islands: data selection and theme persistence need client state; profile/catalog stay HTML. | A fully client-rendered page would lose static-first HTML and make all content hydration-dependent. |
| Theme | `:root` and `:root[data-theme="dark"]` define identical token names copied from both HTML prototypes; `--heading-font` selects Playfair Display or Oswald. An inline head script sets the stored/system theme before paint; `ThemeSwitch` (`client:load`) toggles it. | Hydrating with a default theme would flash the wrong tokens/font. |
| CORS/headers | Allow only `PUBLIC_SITE_ORIGIN` (one approved production origin) and `http://localhost:4321` in development; never `*`. Permit `GET, OPTIONS` and `Content-Type, Accept`; return `Vary: Origin`, JSON content type, and no credentials. Add CSP, `Referrer-Policy`, `X-Content-Type-Options: nosniff`, and restrictive `Permissions-Policy`. | The allow-list prevents wildcard embedding; SSR requests remain credential-free. |

## Data Flow

```text
Browser → Astro SSR /b/[slug] → public-context/public-catalog Edge Functions
                                      → service_role → narrow RPCs → PostgreSQL
                                      ← exact DTOs ←
Browser ← HTML + selector/theme islands
```

RPCs select only published rows and DTO fields. Unknown, inactive, and unpublished resources share `PUBLIC_RESOURCE_NOT_FOUND`; internal errors are generic 500s.

## File Changes

| File | Action | Description |
|---|---|---|
| `package.json`, `astro.config.mjs`, `tsconfig.json`, `src/env.d.ts` | Create | Astro/React/TypeScript/Node SSR and `check`, `build`, `test` scripts. |
| `src/pages/b/[slug].astro`, `src/layouts/PublicLayout.astro`, `src/components/ServiceCatalog.astro` | Create | SSR profile shell, exact DTO rendering, and prototype-derived layout. |
| `src/components/ProfessionalSelector.tsx`, `src/components/ThemeSwitch.tsx`, `src/styles/tokens.css` | Create | Data-driven selector, no-booking interaction, and theme tokens/FOUC prevention. |
| `src/types/public.ts`, `src/lib/public-api.server.ts` | Create | DTO contracts and server-only Edge Function client. |
| `supabase/config.toml`, `supabase/functions/public-context/index.ts`, `supabase/functions/public-catalog/index.ts`, `supabase/functions/_shared/http.ts`, `supabase/functions/_shared/supabase.ts` | Create | Anonymous GET functions, CORS, validation, RPC calls, and redacted errors. |
| `D:\ComIT\proyecto-final-rn\supabase\migrations\phase9_public_barberia_discovery.sql`, `D:\ComIT\proyecto-final-rn\supabase\migrations\phase9_public_barberia_discovery_rollback.sql` | Create elsewhere | Shared-schema migration/RPCs and reversible rollback; delivery is a separate sibling-repo change. |

## Interfaces / Contracts

```ts
type Context = { barberia: { name: string; description: string }; barbers: Barber[] };
type Barber = { name: string; alias: string | null; description: string | null; photoUrl: string | null };
type Catalog = { services: { name: string; durationMinutes: number; price: number }[] };
```

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | DTO exact keys, numeric duration, selector one/two entries, theme bootstrap | Vitest and TypeScript `astro check`. |
| Integration | RPC/Edge contracts, equal unknown/unpublished 404, anonymous REST denial, grants | Staging/branch SQL and function tests; never production. |
| E2E | `/b/[slug]`, no IDs in HTML, functional selector, light/dark swap | Playwright smoke against the built SSR app. |

## Threat Matrix

Routing changes, but no shell, subprocess, VCS, executable classification, or PR automation boundary is introduced:

| Boundary | Status / reason | RED test |
|---|---|---|
| Documentation-like paths | N/A — not executed or classified | None |
| Git repository selection | N/A — no runtime git path | None |
| Commit state | N/A — no commit automation | None |
| Push state | N/A — no push automation | None |
| PR commands | N/A — no PR automation | None |

## Migration / Rollout

Apply the sibling migration in a non-production branch after reconfirming the target ref, publish one approved `Barberia` row through a privileged operator action, deploy RPCs/functions, then deploy web. Rollback clears publication data, drops RPCs/index/columns, and removes web/functions without touching `Servicio` or anon grants. This exceeds the 400-line budget: split delivery after scaffold + read infrastructure, before profile/selector/theme UI; `ask-on-risk` must resolve chaining before apply.

## Open Questions

- [ ] The sibling lacks `supabase/config.toml`; `.temp/linked-project.json` reports ref `ononwmgxbjuksnqupkqi`, while migration comments mention another ref. Reconfirm the target before applying SQL.
- [ ] Supply the approved production origin and identify the existing `Barberia` row/description for initial publication.
