# Delta for web-app-scaffold

## RENAMED Requirements

### Requirement: Scaffold, public route, and verification → Next public scaffold, route, parity, and verification

(Reason: Astro + `/b/[slug]` becomes Next.js 16 App Router + `/`; the previous name described the Astro scaffold and must no longer do so.)

## MODIFIED Requirements

### Requirement: Next public scaffold, route, parity, and verification

The repository MUST provide a Next.js 16 App Router application with React 19 and TypeScript. Server Components MUST be the default, and only the theme control MAY be a Client Component. The landing MUST be served at `/`, resolve `BARBERSHOP_PUBLIC_SLUG` server-side, and render the hero, barbershop information, and service catalog from the public DTO reads rather than hardcoded arrays. The dynamic `/b/[slug]` route MUST NOT exist. Astro dependencies, scripts, configuration, and `astro check` MUST be absent. The project MUST define `lint` as `eslint .` with flat configuration and `eslint-config-next`, `typecheck` as `tsc --noEmit`, `build` as `next build`, `test` as Vitest, and a Playwright E2E command; it MUST NOT use `next lint`.
(Previously: The repository provided an Astro + React islands + TypeScript app serving `/b/[slug]` with Astro build and typecheck verification.)

#### Scenario: Landing renders from public reads

- GIVEN published context and catalog DTOs
- WHEN `/` is requested
- THEN hero, barbershop information, and services render from those DTOs
- AND the approved Spanish copy and light/dark token values are preserved

#### Scenario: Private configuration is not exposed

- GIVEN `BARBERSHOP_PUBLIC_SLUG`, `SUPABASE_URL`, and `SUPABASE_ANON_KEY` are configured server-side
- WHEN the landing is rendered and its client bundle is inspected
- THEN the slug is absent from the URL, HTML, and client bundle
- AND no Supabase credential is present in the client bundle

#### Scenario: Verification surface is Next-based

- GIVEN a clean checkout with dependencies
- WHEN lint, typecheck, build, Vitest, and Playwright E2E commands run
- THEN each command exits successfully
- AND no Astro check or `next lint` command is required or invoked

#### Scenario: Missing public resource

- GIVEN the configured slug is unknown or unpublished
- WHEN `/` is requested
- THEN the application renders the public not-found experience
- AND it does not expose whether the slug was unknown or unpublished

#### Scenario: Phase-one booking posture

- GIVEN the service catalog is visible
- WHEN a visitor activates a service CTA
- THEN no booking operation occurs and the page does not navigate
- AND `/reservar` is not a route in this change

#### Scenario: Theme has no incorrect-theme flash

- GIVEN a visitor has a stored theme or a dark system preference
- WHEN the landing first paints
- THEN the corresponding theme tokens are applied before paint
- AND the wrong theme is not displayed before the theme control hydrates

#### Scenario: Cover asset is approved

- GIVEN the landing displays a cover image
- WHEN the page is rendered
- THEN the image comes from a local or configured asset
- AND it does not use a `picsum.photos` placeholder URL

#### Scenario: Domain remains configurable

- GIVEN the public domain is configured for the deployment
- WHEN metadata or links are generated
- THEN they use the configured domain
- AND `conexion-barberia.com` is not hardcoded
