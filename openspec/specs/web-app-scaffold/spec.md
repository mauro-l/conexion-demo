# web-app-scaffold Specification

## Purpose

Next.js 16 App Router + React + TypeScript public landing at `/` and its verification surface.

## Requirements

### Requirement: Next public scaffold, route, parity, and verification

The repository MUST provide a Next.js 16 App Router application with React 19 and TypeScript. Server Components MUST be the default, and only the theme control and booking interaction island MAY be Client Components. The landing MUST be served at `/`, resolve `BARBERSHOP_PUBLIC_SLUG` server-side, and render the hero, barbershop information, and service catalog from public DTO reads rather than hardcoded arrays. The dynamic `/b/[slug]` route MUST NOT exist. The project MUST define `lint` as `eslint .` with flat configuration and `eslint-config-next`, `typecheck` as `tsc --noEmit`, `build` as `next build`, `test` as Vitest, and a Playwright E2E command; it MUST NOT use `next lint`. A real `/reservar` route MUST render the read-only availability entry flow. Catalog service CTAs MUST navigate to `/reservar?service=<opaque-token>`. In the Next.js 16 App Router a page's `searchParams` prop is a `Promise`, so the `/reservar` Server Component MUST await it before reading any query value.

(Previously: `/reservar` was not a route and catalog CTAs were deliberately inert.)

#### Scenario: Landing renders from public reads
- GIVEN published context and catalog DTOs
- WHEN `/` is requested
- THEN hero, barbershop information, and services render from those DTOs
- AND approved copy and theme tokens are preserved

#### Scenario: Private configuration is not exposed
- GIVEN server-side public slug and Supabase credentials
- WHEN the landing and booking routes render
- THEN the slug and credentials are absent from client bundles

#### Scenario: Verification surface is Next-based
- GIVEN a clean checkout with dependencies
- WHEN lint, typecheck, build, Vitest, and Playwright commands run
- THEN each command exits successfully

#### Scenario: Missing public resource
- GIVEN the configured slug is unknown or unpublished
- WHEN `/` or `/reservar` is requested
- THEN the public not-found experience renders without revealing the distinction

#### Scenario: Active catalog CTA and route
- GIVEN a catalog service with an opaque public token
- WHEN its `Reservar` CTA is activated
- THEN the browser navigates to `/reservar?service=<token>`
- AND no booking mutation occurs

#### Scenario: Search params are awaited
- GIVEN Next.js 16 App Router page props where `searchParams` is a `Promise`
- WHEN `/reservar?service=<token>` is requested
- THEN the Server Component awaits `searchParams` before reading `service`
- AND the route resolves from the awaited object, never from the promise itself

#### Scenario: Theme has no incorrect-theme flash
- GIVEN a stored theme or dark system preference
- WHEN the landing first paints
- THEN corresponding theme tokens apply before hydration

#### Scenario: Cover asset is approved
- GIVEN the landing displays a cover image
- WHEN rendered
- THEN it uses a local or configured asset, never `picsum.photos`

#### Scenario: Domain remains configurable
- GIVEN a configured public domain
- WHEN metadata or links are generated
- THEN they use that domain and do not hardcode `conexion-barberia.com`
