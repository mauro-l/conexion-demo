# Exploration: next-public-parity

## 1. Parity Inventory

### Files to Migrate (exact list with responsibility)

| File | Responsibility | Migration Target |
|---|---|---|
| `src/pages/b/[slug].astro` | SSR page: resolves barbershop by slug, fetches context + catalog in parallel via Edge Functions, renders hero + info list + ServiceCatalog. Returns 404 via `Astro.rewrite('/404')` on `PUBLIC_RESOURCE_NOT_FOUND`. Uses `picsum.photos` for cover image seeded by slug. | `app/page.tsx` — Server Component; slug resolved from env, not URL param; `notFound()` for 404. |
| `src/pages/404.astro` | Static 404 page with "Pagina no encontrada" messaging. | `app/not-found.tsx`. |
| `src/layouts/PublicLayout.astro` | HTML shell: `<html lang="es">`, meta viewport, title, Google Fonts preconnect + stylesheet (IBM Plex Mono, Inter, Oswald, Playfair Display), global CSS import of `tokens.css`, inline theme bootstrap script (reads `localStorage` / `prefers-color-scheme`), sticky topbar with logo + ThemeSwitch island. | `app/layout.tsx` — root layout; `metadata` export; inline `<script>` for theme bootstrap with `suppressHydrationWarning`. |
| `src/components/ServiceCatalog.astro` | SSR component: receives `services` from Catalog DTO, renders ticket cards with name, expandable description (falls back to `prototypeDetails` hardcoded map), duration formatting, price formatting, and inert "Reservar" CTA button. | Server Component `ServiceCatalog`; CTA becomes `<Link href="/reservar?service=...">` (Fase 1: inert or linking to `/reservar` placeholder). Remove `prototypeDetails` fallback — use only DTO `description`. |
| `src/components/ThemeSwitch.tsx` | React island: `useState`/`useEffect` to read initial theme, toggle between light/dark, call `applyTheme()`. Renders moon/sun icon button with Spanish aria-labels. | Client Component (`'use client'`); identical logic; `suppressHydrationWarning` on `<html>`. |
| `src/lib/public-api.server.ts` | Server-only API client: `createPublicApiClient()` reads `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY` from `import.meta.env` / `process.env`, constructs `Authorization: Bearer` header, calls `GET /functions/v1/public-context?slug=...` and `GET /functions/v1/public-catalog?slug=...`. Validates slug with regex. Throws `PublicApiError` with code/message/retryable. | Rewrite as `lib/public-api.server.ts` using `process.env.NEXT_PUBLIC_SUPABASE_URL` and `process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY`. Same structure, but Astro env conventions replaced. |
| `src/lib/theme.ts` | Pure utility: `getInitialTheme()` (reads `localStorage` / `prefers-color-scheme`), `applyTheme()` (sets `document.documentElement.dataset.theme` + `localStorage`), `toggleTheme()`, `THEME_STORAGE_KEY = 'conexion-theme'`. | Direct port to Next; no framework coupling. |
| `src/types/public.ts` | TypeScript types: `Barber`, `Context`, `Catalog`, `PublicError`. No internal IDs. | Direct port; add optional `address`, `hours`, `whatsappUrl`, `instagramHandle`, `instagramUrl` fields if not already present (they are in the DTO but the type currently has them optional). |
| `src/styles/tokens.css` | CSS custom properties: light/dark themes, typography tokens, component styles (topbar, hero, services, tickets). 455 lines. | Move to `app/globals.css` or equivalent CSS import. Preserve exact values. |

### VISUAL ONLY — Do NOT Carry Over as Functional Behavior

| Item | Location | Why it is visual-only |
|---|---|---|
| `prototypeDetails` hardcoded map | `ServiceCatalog.astro:11-20` | Fallback descriptions for prototype display only; plan says "textos visuales sirven como referencia, no como regla." Use DTO `description` exclusively. |
| Inert "Reservar" `<button>` | `ServiceCatalog.astro:62-64` | No click handler, no navigation. In Fase 1 this becomes a link to `/reservar` (placeholder) or remains inert. NOT a booking action. |
| `picsum.photos` cover image | `[slug].astro:52` | Placeholder image seeded by slug. Plan does not carry this forward as a real image strategy — keep as-is or replace with a real image path from DTO (TBD in design). |
| Login link check in E2E | `profile.spec.ts:43` | `Iniciar sesion` assertion — tests that login is NOT present. This is a parity constraint, not a feature. |
| Spanish UI copy | Throughout | All user-facing text is Spanish. Must be preserved exactly in the Next version. |

---

## 2. Edge Boundary Contracts

### `supabase/functions/public-context/index.ts`

- **HTTP method:** GET (enforced in `handler.ts:12-13`; OPTIONS handled for CORS preflight)
- **Request shape:** `GET /functions/v1/public-context?slug={slug}`
- **RPC called:** `public.public_context(p_slug text)` (phase10 version)
- **Response payload (200):**
  ```json
  {
    "barberia": {
      "name": string,
      "description": string,
      "address": string | null,
      "hours": string | null,
      "whatsappUrl": string | null,
      "instagramHandle": string | null,
      "instagramUrl": string | null
    },
    "barbers": [
      { "name": string, "alias": string | null, "description": string, "photoUrl": string | null }
    ]
  }
  ```
- **Error shape:** `{ "error": { "code": string, "message": string, "retryable": boolean } }`
  - 400: `INVALID_INPUT` (bad slug format)
  - 404: `PUBLIC_RESOURCE_NOT_FOUND` (unknown or unpublished slug — identical body for both)
  - 405: `METHOD_NOT_ALLOWED`
  - 500: `INTERNAL_ERROR`
- **CORS/origin handling:** `ALLOWED_ORIGINS` starts with `http://localhost:4321`; adds `PUBLIC_SITE_ORIGIN` env var if set. Only allowed origins get `Access-Control-Allow-Origin` header. `Vary: Origin` always set.
- **Authentication to Supabase:** `createServiceClient()` uses `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from Deno env. RPC is `SECURITY INVOKER` with `search_path = public, pg_temp`. Function GRANT is `service_role` only.
- **DTO field leak check:** No internal IDs (`id`, `barberia_id`, `barbero_id`, `users_id`) in response. Clean.
- **Env vars read:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PUBLIC_SITE_ORIGIN`

### `supabase/functions/public-catalog/index.ts`

- **HTTP method:** GET (same handler)
- **Request shape:** `GET /functions/v1/public-catalog?slug={slug}`
- **RPC called:** `public.public_catalog(p_slug text)` (phase10 version)
- **Response payload (200):**
  ```json
  {
    "services": [
      { "name": string, "durationMinutes": number, "price": number, "description": string | null }
    ]
  }
  ```
- **Error shape:** Same as `public-context`
- **CORS/origin handling:** Same as `public-context`
- **Authentication to Supabase:** Same as `public-context`
- **DTO field leak check:** No internal IDs. `durationMinutes` derived from `Servicio.duracion` (numeric), `price` from `Servicio.precio`. Clean.
- **Env vars read:** Same as `public-context`

### `_shared/supabase.ts`

- `createServiceClient()` reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `Deno.env`
- Uses `jsr:@supabase/supabase-js@2` with `persistSession: false, autoRefreshToken: false`

### `_shared/http.ts`

- CORS allowlist: `http://localhost:4321` hardcoded + `PUBLIC_SITE_ORIGIN` env var
- Security headers: CSP `default-src 'none'; frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, restrictive `Permissions-Policy`
- JSON responses include `Content-Type: application/json`

---

## 3. Resolution of the Barbershop

### How It Works Today

1. **Database:** `Barberia.public_slug` is `text`, nullable, with a unique index (`idx_barberia_public_slug_unique`). The demo seed sets `public_slug = 'conexion-barberia'`.
2. **URL:** The slug is the URL parameter: `/b/[slug].astro` reads `Astro.params.slug` and passes it to both Edge Functions as `?slug={slug}`.
3. **Edge Functions:** Both `public_context` and `public_catalog` RPCs accept `p_slug text` and filter `WHERE b.public_slug = p_slug AND b.publicado = true`.
4. **Current flow:** `src/pages/b/[slug].astro:9` → `Astro.params.slug` → `api.context(slug)` + `api.catalog(slug)`.

### Plan's Requirement

The plan says: `/` resolves the barbershop by a **configured** `public_slug` that must NOT appear in the public URL. The slug is for "resolución interna/backoffice, no en la URL pública."

### Proposed Mechanism

The `public_slug` must come from a **server-only environment variable** in Next.js:

- **Env var name:** `PUBLIC_BARBERSHOP_SLUG`
- **Server-only or `NEXT_PUBLIC_*`?** Server-only. This value is resolved server-side in a Server Component and passed to Edge Functions. It must NOT appear in the HTML, client bundle, or URL. Using `NEXT_PUBLIC_` would leak it to the browser.
- **Tradeoff:** Server-only env vars are not available in Client Components. This is correct — the slug resolution happens in the Server Component (`app/page.tsx`) which calls the Edge Functions. The Client Component never needs the slug directly.

### PostgREST / anon Access Verification

Per `openspec/specs/public-context-read/spec.md` requirement "Edge Function/RPC-only read boundary":
> "Every public read MUST traverse the Edge Function/RPC boundary. `anon` MUST hold zero table grants and MUST gain none."

The migration (`phase9:123-128`) explicitly:
- `REVOKE EXECUTE ON FUNCTION public.public_context(text) FROM PUBLIC, anon, authenticated`
- `GRANT EXECUTE ON FUNCTION public.public_context(text) TO service_role`

So `anon` cannot call the RPCs directly. And `anon` has no table grants. The Edge Functions use `service_role` to call the RPCs. The Next.js app calls the Edge Functions via HTTP (with `anon` key for auth header, but the Edge Functions don't verify the bearer — they use `service_role` internally). This is safe.

---

## 4. Environment Variable Migration

### Current Variables

| Variable | Where Used | Value Source |
|---|---|---|
| `PUBLIC_SUPABASE_URL` | `src/lib/public-api.server.ts:35`, `tests/e2e/profile.spec.ts:3`, `playwright.config.ts:3`, `src/env.d.ts:5` | `.env` (Astro convention: `PUBLIC_` prefix exposed to client) |
| `PUBLIC_SUPABASE_ANON_KEY` | `src/lib/public-api.server.ts:37`, `tests/e2e/profile.spec.ts:4-5`, `playwright.config.ts:4-5`, `src/env.d.ts:6` | `.env` |
| `PUBLIC_SITE_ORIGIN` | `supabase/functions/_shared/http.ts:2` | Edge Function env (Deno) |
| `SUPABASE_URL` | `supabase/functions/_shared/supabase.ts:4` | Edge Function env (Deno) |
| `SUPABASE_SERVICE_ROLE_KEY` | `supabase/functions/_shared/supabase.ts:5` | Edge Function env (Deno) |

### Proposed Next.js Naming

| Current | Proposed Next | Server-only? | Rationale |
|---|---|---|---|
| `PUBLIC_SUPABASE_URL` | `NEXT_PUBLIC_SUPABASE_URL` | **No** (`NEXT_PUBLIC_*`) | Needed in Edge Functions for browser fetch; safe to expose (it's the public project URL, not a secret). Also needed in E2E tests via `process.env`. |
| `PUBLIC_SUPABASE_ANON_KEY` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **No** (`NEXT_PUBLIC_*`) | The anon key is designed to be public. It's used in the API client which runs server-side but the key itself is not secret. E2E tests also need it. |
| `PUBLIC_SITE_ORIGIN` | `PUBLIC_SITE_ORIGIN` (unchanged) | Edge Function only | Not a Next.js env var; stays in Supabase Edge Function env. |
| `SUPABASE_URL` | `SUPABASE_URL` (unchanged) | Edge Function only | Not a Next.js env var. |
| `SUPABASE_SERVICE_ROLE_KEY` | `SUPABASE_SERVICE_ROLE_KEY` (unchanged) | Edge Function only | Never reaches Next.js. Plan FORBIDS `service_role` in browser/bundle/`NEXT_PUBLIC_*`. |
| (new) `PUBLIC_BARBERSHOP_SLUG` | `PUBLIC_BARBERSHOP_SLUG` | **Yes** (server-only) | Resolves the single barbershop on `/`. Must not appear in client bundle or URL. |

### Critical Constraint

The plan explicitly states: "`SUPABASE_SERVICE_ROLE_KEY` solo en Edge Functions/entorno seguro; nunca `NEXT_PUBLIC_*`, HTML, logs o variables que se envíen al cliente." The `service_role` key must NEVER be in the Next.js codebase. The current Edge Functions already enforce this correctly.

---

## 5. Existing Spec Delta Surface

### `web-app-scaffold/spec.md`

**INVALIDATE** — requires delta.

Current requirement text:
> "The repository MUST provide an Astro + React islands + TypeScript app serving `/b/[slug]`, rendering context and services from the public DTO reads — never hardcoded."

This names Astro explicitly and the `/b/[slug]` route. The Next migration changes both. A delta spec must replace "Astro + React islands" with "Next.js App Router" and `/b/[slug]` with `/`.

### `public-context-read/spec.md`

**MODIFY** — requires delta for route change.

Current requirement text:
> "`Barberia` MUST expose a slug, unique by database constraint, resolving `/b/[slug]`."

The route changes from `/b/[slug]` to `/`. The slug resolution mechanism changes from URL param to env var. The requirement about slug uniqueness and not-found behavior is unchanged. Delta must update the route reference.

The "Edge Function/RPC-only read boundary" requirement is **UNCHANGED** — the Edge boundary stays.

### `public-service-catalog-read/spec.md`

**UNCHANGED** — the catalog DTO contract (`{ services: [{ name, durationMinutes, price, description? }] }`) and the DB-authoritative resolution are framework-agnostic. No delta needed.

### `public-theme-switch/spec.md`

**UNCHANGED** — the CSS token swap mechanism is framework-agnostic. The spec defines token names and font swapping, not framework implementation. No delta needed.

### `public-barber-selector/spec.md`

**UNAFFECTED for Fase 1** — the plan says "no selector explícito de barbero en este MVP." The barber selector spec describes a visual-only control. Fase 1 does not implement booking or the selector. No delta needed now; may need one if the spec's route reference (`/b/[slug]`) is updated.

---

## 6. Test and Verification Tooling Reality

### What Exists Today

| Command | Script in `package.json` | Status |
|---|---|---|
| `npm run lint` | **DOES NOT EXIST** | No `lint` script. No `.eslintrc`, `eslint.config.*`, or `.prettierrc` files. No linting tooling installed at all. |
| `npm run typecheck` | **DOES NOT EXIST** | No `typecheck` script. The `check` script runs `astro check` (Astro-specific). |
| `npm run build` | ✅ `astro build` | Works for Astro. Will need to become `next build`. |
| `npm test` | ✅ `vitest run` | Runs Vitest over `src/**/*.{test,spec}.{ts,tsx}` with jsdom environment. One test file exists: `src/lib/public-api.server.test.ts`. |
| `npx playwright test` | No npm script, but Playwright is installed | Config at `playwright.config.ts`. E2E tests in `tests/e2e/profile.spec.ts`. |

### What Fase 1 Verification Demands but Does Not Yet Exist

| Required | Status | Action Needed |
|---|---|---|
| `npm run lint` | ❌ Missing | Install ESLint + config (Next.js eslint-config-next recommended). Add `lint` script. |
| `npm run typecheck` | ❌ Missing | Install `typescript` (already in devDeps). Add `typecheck` script: `tsc --noEmit`. Next.js has its own tsconfig requirements. |
| `npm run build` | ⚠️ Astro-specific | Replace with `next build`. Package.json scripts must be rewritten entirely. |
| `npm test` | ✅ Exists | Vitest config needs update for Next.js module resolution (`~` alias → `@/` or keep `~`). Test file `public-api.server.test.ts` may need env var adjustments. |
| `npx playwright test` | ⚠️ Needs rewrite | See below. |

### `playwright.config.ts` Hardcoded Values That Must Change

| Line | Current Value | Must Change To |
|---|---|---|
| `baseURL` (line 15) | `http://localhost:4321` | `http://localhost:3000` (Next.js default) |
| `webServer.command` (line 25) | `npm run preview` | `npm run dev` or `npm run build && npm run start` |
| `webServer.url` (line 26) | `http://localhost:4321/b/conexion-barberia` | `http://localhost:3000/` (route changes from `/b/[slug]` to `/`) |
| `webServer.env` (lines 30-31) | `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or use `.env.local`) |
| Hardcoded Supabase URL (line 3) | `https://vcgyiyrboumimwgdsitf.supabase.co` | Should use `process.env` or `.env.local` instead of hardcoding |
| Hardcoded anon key (lines 4-5) | Full JWT string | Should use `process.env` or `.env.local` instead of hardcoding |

### E2E Test URL Changes

`tests/e2e/profile.spec.ts` hardcodes `/b/conexion-barberia` in 3 places (lines 24, 39, 56). These must change to `/` in the Next version.

---

## 7. Theme Mechanism

### How It Works Today

1. **Inline script in `PublicLayout.astro:26-38`:** Runs before paint. Reads `conexion-theme` from `localStorage`, falls back to `prefers-color-scheme: dark` media query, defaults to `light`. Sets `document.documentElement.dataset.theme`.
2. **`ThemeSwitch.tsx` (React island, `client:load`):** On mount, reads initial theme via `getInitialTheme()` (same logic as inline script). Toggles by calling `applyTheme()` which sets `document.documentElement.dataset.theme` and persists to `localStorage`.
3. **CSS:** `tokens.css` uses `:root[data-theme='dark']` selector to override CSS custom properties.

### Flash/Hydration Risk in Next.js

The risk: if the server renders with `data-theme="light"` (default) but the client has `dark` stored, there's a flash of light theme before the Client Component hydrates and applies dark.

### Concrete Solution for Next.js

1. **Inline `<script>` in `app/layout.tsx`** — identical to the current Astro inline script. This runs synchronously before paint, before React hydrates. Placed in `<head>` inside the `<body>` tag (Next.js App Router allows this).
2. **`suppressHydrationWarning`** on `<html>` tag — tells React to not warn about the server/client mismatch on the `data-theme` attribute. This is the standard Next.js pattern for theme bootstrap.
3. **`ThemeSwitch` becomes a Client Component** with `'use client'` directive. Same `useState`/`useEffect` logic.
4. **No full-layout hydration** — only the ThemeSwitch button hydrates as a Client Component. The layout itself remains a Server Component.

### Next.js-Specific Constraints

- The inline script must be a string literal (no template variables) to work as a standard `<script>` tag in the App Router.
- `suppressHydrationWarning` only applies to the element it's on and its children — it does not suppress all hydration warnings globally.
- The `localStorage` read in the inline script may fail in SSR/edge contexts — the `try/catch` already handles this.

---

## 8. Contradictions and Ambiguity

### Contradictions

1. **Plan says "No middleware initially" (§1) but also says "CSRF/origin" checks (§11).** If POST routes are added in later phases, CSRF protection via middleware or Route Handler logic will be needed. Fase 1 has no POST routes, so this is not blocking, but the design must decide where CSRF lives before Fase 3.

2. **Plan §6 says `public-api.server.ts` should use `process.env` server-only, but the current `anonKey` is safe to expose.** The plan says "No usar `NEXT_PUBLIC_*` para secretos" — this is correct for `service_role`, but the anon key IS designed to be public. The plan does not explicitly say the anon key should be `NEXT_PUBLIC_*`. This needs a design decision: the anon key must be available in the E2E test runner (browser-like context) AND in the server-side API client. Using `NEXT_PUBLIC_` is correct for the anon key; the plan's warning is about `service_role` specifically.

3. **Plan §6 says "Reemplazar por scripts Next equivalentes en una fase de migración separada" for package scripts, but Fase 1 verification REQUIRES `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`, `npx playwright test`.** These scripts MUST exist in Fase 1 for verification to pass. The plan contradicts itself: it says scripts are a separate phase but also requires them for Fase 1 verification.

### Ambiguities for Spec/Design Phase

1. **Cover image strategy.** Current implementation uses `picsum.photos/seed/{slug}/900/675`. The plan does not mention carrying this forward. Design must decide: keep placeholder, use a real image from the DTO (which doesn't have one), or remove the cover entirely.

2. **ServiceCatalog CTA behavior in Fase 1.** Plan says "CTA navega a `/reservar?service=...` usando token público estable, nunca índice/ID." But Fase 1 is "sin booking." Does the CTA link to `/reservar` (which doesn't exist yet in Fase 1) or remain inert? The plan is ambiguous.

3. **`prototypeDetails` fallback removal.** Plan says "No convertir los prototipos en fuente de datos." But the current `ServiceCatalog` falls back to hardcoded descriptions when the DTO has no `description`. The seed data NOW includes `descripcion` in the `Servicio` table (phase10 migration), so the fallback is dead code. But design must confirm: remove entirely, or keep as safety net?

4. **The `public_slug` env var name.** Plan says "resuelve la barbería por `public_slug` configurado" but does not name the env var. This exploration proposes `PUBLIC_BARBERSHOP_SLUG` (server-only). Design must confirm.

5. **Route for `/reservar` in Fase 1.** The plan says Fase 1 is "sin booking" but the route map includes `/reservar`. Should Fase 1 scaffold an empty placeholder page, or skip it entirely?

6. **`description` field in Context DTO.** The type `public.ts` has `description: string` (required), but the phase10 RPC uses `coalesce(b.description, '')` so it can be empty. The type should be `description: string` (always present, possibly empty). This is consistent but should be explicitly noted.

---

## 9. Migration Risk Surface

### Risks Ranked by Severity

1. **HIGH: Package.json and lockfile churn.** Replacing Astro with Next.js means removing `astro`, `@astrojs/node`, `@astrojs/react` and adding `next`, `@next/font` (or `next/font`). The lockfile will change dramatically. This is the single largest source of merge conflicts if the branch lives long. **Mitigation:** Do this atomically in one commit. Keep the Astro branch deployable until cutover.

2. **HIGH: `tsconfig.json` incompatibility.** Current tsconfig extends `astro/tsconfigs/strict`. Next.js has its own tsconfig requirements (`"moduleResolution": "bundler"`, `"jsx": "preserve"`, etc.). The `~` path alias must be preserved or migrated to `@/`. **Mitigation:** Next.js `create-next-app` generates a baseline tsconfig; merge carefully.

3. **MEDIUM: Route change `/b/[slug]` → `/`.** The plan says the slug comes from env, not URL. This means the current dynamic routing is replaced by a single static route with server-side env resolution. This is a semantic change, not just a path change. The E2E tests hardcode the old URL. **Mitigation:** Update all E2E URLs in the same commit as the route change.

4. **MEDIUM: CSS import mechanism.** Astro uses `<style is:global>@import '../styles/tokens.css'</style>`. Next.js App Router uses `import './globals.css'` in `layout.tsx`. The CSS itself is portable, but the import mechanism and any Astro-specific CSS processing may behave differently. **Mitigation:** Test theme switching immediately after migration.

5. **MEDIUM: `public-api.server.ts` env var access.** The current implementation uses `import.meta.env` (Astro) with a `process.env` fallback. Next.js uses `process.env` exclusively. The `envVar()` helper function must be simplified. **Mitigation:** Straightforward rewrite; the fallback logic becomes unnecessary.

6. **LOW: React version.** Current: React 18.3.1. Next.js 14+ supports React 18. Next.js 15 requires React 19. The plan does not specify which Next.js version. If Next.js 15 is chosen, React 19 migration is required (which has breaking changes for `useEffect`, `forwardRef`, etc.). **Mitigation:** Pin Next.js 14.x if React 19 migration is not in scope; or plan for React 19 if Next.js 15 is desired.

7. **LOW: `vitest.config.ts` alias.** The `~` alias resolves to `./src`. Next.js typically uses `@/`. The vitest config must be updated to match whatever the Next.js tsconfig uses. **Mitigation:** Update the alias in vitest config.

8. **OUT OF SCOPE but ROLLBACK RISK:** The plan says "mantener Astro desplegado y cambiar el origin al deployment anterior" for rollback. This requires the Astro deployment to remain active until the Next deployment is verified. If the Astro deployment is torn down before cutover, rollback becomes impossible. **Mitigation:** Keep Astro deployment alive until Next production is verified.

### Deployment Assumptions Explicitly Out of Cycle

- Vercel configuration
- DNS changes
- Domain pointing to new deployment
- CORS origin update (`PUBLIC_SITE_ORIGIN` in Edge Functions)

These are deferred but must be planned for — the Edge Functions' CORS allowlist currently only includes `localhost:4321`. The production domain must be added before go-live.

---

## Key Learnings

1. The `public_slug` lives in `Barberia.public_slug` (text, nullable, unique index) and is passed as a URL param today — the Next migration changes this to a server-only env var resolution.
2. The `prototypeDetails` hardcoded fallback in `ServiceCatalog.astro` is dead code since phase10 added `descripcion` to `Servicio` and the RPC returns it.
3. `npm run lint` and `npm run typecheck` scripts do not exist today — they must be created as part of Fase 1, contradicting the plan's claim that scripts are a separate phase.
4. The Playwright config hardcodes Supabase URL and anon key as string literals instead of reading from env — these must be externalized.
5. The Edge Functions' CORS allowlist only includes `localhost:4321` — the production domain must be added before go-live, but this is explicitly out of Fase 1 scope.
