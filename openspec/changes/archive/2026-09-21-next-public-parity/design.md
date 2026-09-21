# Design: next-public-parity

## Technical Approach

Replace Astro SSR with one Next.js 16 App Router route, `/`. `app/page.tsx` reads the server-only slug, fetches context and catalog through the existing Edge Functions, validates the DTOs, and composes the landing. It renders only the local cover, hero, barbershop information, and service catalog—no selector or barber list. This matches the verified current `src/pages/b/[slug].astro` and `src/layouts/PublicLayout.astro` surfaces. `barbers[]` remains in the context DTO and types for Fase 2 but is not rendered in Fase 1. Edge Functions, RPCs, grants, database, booking, and `/reservar` remain unchanged.

## Architecture Decisions

| Decision | Choice and rationale |
|---|---|
| Server/client boundary | `RootLayout`, `PublicPage`, `PublicHeader`, `PublicHero`, `PublicInfo`, `ServiceCatalog`, and `NotFoundPage` are Server Components. Only `ThemeSwitch` is a Client Component for browser storage and click state. |
| Route and configuration | Remove `app/b/[slug]`; `/` calls `getConfiguredSlug()` for server-only `BARBERSHOP_PUBLIC_SLUG`. The value is never rendered, placed in a URL, or referenced by client code. |
| Read, caching, and failure policy | `public-api.server.ts` remains server-only, reads `SUPABASE_URL` and `SUPABASE_ANON_KEY` from `process.env` (never `NEXT_PUBLIC_*`), validates the slug/DTOs, and uses a five-second abort timeout. Both context and catalog GETs use `next: { revalidate: 60 }`: these approved public DTOs contain no tokens/private PII, change infrequently, and receive a one-minute staleness bound. A newly published or unpublished barbershop, including a not-found result, may therefore remain stale for up to 60 seconds; this bounded eventual consistency is accepted. These are the only cached reads. Token/PII responses and availability reads remain uncached. `Promise.allSettled` prioritizes any non-404 failure; only `PUBLIC_RESOURCE_NOT_FOUND` reaches `notFound()`, and other failures use the 500 boundary. |
| Origin and metadata | `PUBLIC_SITE_ORIGIN` supplies a validated `URL` to root `metadataBase`; relative canonical metadata resolves from it. Development may fall back to `http://localhost:3000`; production fails clearly on missing/malformed configuration. No production domain is hardcoded. |
| Asset and DTO rendering | Render supplied local `public/cover.jpg` (baseline JPEG, 950x634, approximately 370 KB) with `next/image`; no remote host or `images.remotePatterns` entry is required. No webp converter is available. Nullable fields render conditionally, never with fabricated defaults. The fallbacks at `src/pages/b/[slug].astro:39-45` match byte-for-byte seed values at `supabase/seed_demo.sql:67-73`, so removal is parity-preserving. The seed's `whatsapp_url` is `'#'`, so that row currently links nowhere; this data issue is out of scope. |

Theme uses `app/layout.tsx` with `<html lang="es" data-theme="light" suppressHydrationWarning>`, the verified raw bootstrap script, and the preserved `conexion-theme`/system fallback. Lazy `ThemeSwitch` state and existing theme utilities/tokens are ported to `app/globals.css`.

## Module Layout and Data Flow

```text
app/layout.tsx ──→ ThemeSwitch (Client)
app/page.tsx ──→ public-api.server.ts ──→ public-context/public-catalog Edge Functions ──→ RPCs
       └──────→ PublicHero + PublicInfo + ServiceCatalog (Server)
app/not-found.tsx (Server, Spanish “Página no encontrada” UI)
```

```text
app/{layout,page,not-found,globals.css}
components/{ThemeSwitch.tsx,public/{PublicHeader,PublicHero,PublicInfo,ServiceCatalog}.tsx}
lib/{public-api.server.ts,site-config.server.ts,theme.ts}
types/public.ts
public/cover.jpg
```

`Context` retains seven `barberia` fields and `barbers[]` with `name`, `alias`, `description`, and `photoUrl`; `Catalog.services` retains `name`, `durationMinutes`, `price`, and nullable `description` from `phase10_public_landing_details.sql`. The landing consumes no barber entries in this phase.

## File Changes and Tooling

Delete Astro pages/layout/components and configuration; create the tree above. Replace dependencies/scripts with Next 16.2.9, React 19, flat ESLint, `next dev`, `eslint .`, `tsc --noEmit`, `next build`, `next start`, Vitest, and Playwright; omit `next lint` and `astro check`. `tsconfig.json` uses Next settings and maps `~/* -> ./*`.

Vitest retains jsdom/setup and maps `~` to `path.resolve(__dirname, './')` in `vitest.config.ts`; the exact `~/*` → `./*` mapping replaces `./src`. Existing tests use relative imports and no `~` imports, so none needs rewriting. Playwright uses `http://localhost:3000`, `/`, `npm run dev`, and required environment values without literals; `profile.spec.ts` removes URL-slug assumptions and tests `/b/...` absence.

## Testing, Threat Matrix, and Rollout

Unit tests cover timeout, error mapping, DTO rejection, 60-second revalidation, all-settled 404/500 precedence, Edge-only paths, slug privacy, retained `barbers[]`, and no selector rendering. E2E covers `/`, nullable fields, inert CTAs, local cover, theme bootstrap, no IDs/credentials/slug in HTML or `.next/static`, no selector, and unknown/unpublished not-found fixtures. Establish a clean `npm ci` baseline: the observed install is invalid evidence (`astro` 7.3.2 installed versus 4.16.19 locked; `npm ls astro` reports `ELSPROBLEMS`). Re-run after migration.

| Matrix row | Status and reason |
|---|---|
| Documentation-like paths | N/A: route migration has no executable documentation boundary. |
| Git repository selection | N/A: build and tests use the configured project root; no repository selector is implemented. |
| Commit state | N/A: design does not automate commits or inspect index/worktree state. |
| Push state | N/A: no remote operation is implemented. |
| PR commands | N/A: no PR automation is implemented. |

No migration or backend rollout is required; keep Astro available for rollback. Review forecast: **400-line budget risk High; chained PRs recommended; ask-on-risk applies**.

## Open Questions

None. The approved artwork is present at `public/cover.jpg`; no asset-supply decision remains.
