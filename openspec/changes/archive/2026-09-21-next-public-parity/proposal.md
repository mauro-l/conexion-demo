# Proposal: next-public-parity

## Intent

Migrate the public landing from Astro SSR to Next.js 16 App Router with parity, without activating booking or changing the backend boundary.

## Scope

### In Scope
- Scaffold Next.js 16.2.9 with React 19; port layout, `/`, components, metadata, tokens, and theme.
- Resolve the barbershop through server-only `BARBERSHOP_PUBLIC_SLUG`; remove `/b/[slug]` and update E2E URLs.
- Rewrite the client for `SUPABASE_URL` and `SUPABASE_ANON_KEY`; preserve Edge/RPC reads and zero grants.
- Create `lint` (`eslint .` with flat config) and `typecheck` (`tsc --noEmit`); replace Astro scripts.
- Remove `prototypeDetails`; replace `picsum.photos` with a local/configured cover asset.

### Out of Scope
- Availability, slots, booking, idempotency, cancellation, tokens, new Edge Functions, private panel, deployment/Vercel/DNS, RLS, or grants.
- `/reservar` and booking behavior; CTAs remain non-booking presentation.

## Capabilities

### New Capabilities
- None: the existing scaffold capability is modified rather than duplicated.

### Modified Capabilities
- `web-app-scaffold`: Astro and `/b/[slug]` become Next App Router and `/`, with React 19 and new verification commands.
- `public-context-read`: resolve the published slug from server-only configuration while retaining not-found parity and Edge/RPC reads.
- `public-barber-selector`: update its route scenario to `/`; selector behavior remains unchanged.

`public-service-catalog-read` and `public-theme-switch` stay untouched.

## Approach

Use Server Components for page/data composition and hydrate only the theme control. Preserve tokens/copy and externalize credentials. `next lint` is not used because Next 16 removed it.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `package.json`, lockfile, `app/`, components, styles | Modified | Next scaffold, UI, client, verification |
| `tests/e2e/`, `playwright.config.ts`, `openspec/specs/` | Modified | Routes and capability deltas |
| Supabase Edge Functions/RPC/migrations | Untouched | Contracts and grants |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Migration exceeds review budget | High | **400-line budget risk: High; Chained PRs recommended: Yes.** |
| `node_modules` drift (`astro` 7.3.2 vs locked 4.16.19) invalidates baseline | High | Verify clean dependencies; do not fix drift here. |
| Credential or slug leakage | Medium | Server-only envs and bundle inspection. |
| Astro rollback unavailable | Medium | Keep Astro deployed; switch origin back. |

## Rollback Plan

Revert the application/lockfile migration or point the origin back to Astro. No reservation tables, RLS, or grants change.

## Dependencies

- Approved public contracts and Edge Functions.
- Node.js `>=20.9.0` (repository uses Node 24).

## Success Criteria

- [ ] Next 16.2.9/React 19 serves `/` with parity, metadata, theme, and consistent not-found behavior.
- [ ] `/b/[slug]` and booking behavior are absent; client bundles contain no Supabase credentials.
- [ ] `lint`, `typecheck`, `build`, `test`, and Playwright E2E pass reproducibly.
- [ ] Edge/RPC contracts, DTO privacy, and `anon` zero-table-grant posture remain unchanged.
