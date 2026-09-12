# Proposal: web-publica-reservas

## Intent

Build a read-only public discovery MVP for one barbershop with one currently published barber. The repository has no scaffold (`package.json`, `src/`, Astro config, or test runner), so bootstrapping Astro + React islands + TypeScript is in scope and is the bulk of the implementation. The demo must preserve the prototype's professional selector so the client can see that multiple barbers are planned, even though only one is shown today.

## Scope

### In Scope
- Bootstrap the Astro/React/TypeScript web application and its minimal verification commands.
- Add and expose a unique public identifier on `Barberia`; use it for `/b/[slug]`.
- Implement context and catalog reads through Edge Function/RPC only, with `anon` receiving no table grants.
- Render the prototype’s public profile and services; keep the functional-looking “Cualquier profesional” selector exactly as a selectable UI control, backed by a `barbers` DTO list containing one entry.
- Add a light/dark `:root` token swap plus Playfair Display/Oswald heading-font swap.

### Out of Scope
- Booking, availability, OTP, cancellation, email, CAPTCHA, waitlist, or mutations.
- A second barber or multi-barber data rollout; the selector remains present as a future-facing demo affordance.
- Any catalog migration: `Servicio.barbero_id` already points to the single barber, so those services are the public catalog. No `barberia_id` is needed.

## Capabilities

### New Capabilities
- `web-app-scaffold`: bootstrapped Astro + React islands + TypeScript app serving `/b/[slug]`, with passing build and typecheck verification.
- `public-context-read`: public barbershop context resolved by a `Barberia` identifier and returned with `barbers: [{ name, alias, description, photoUrl }]`. A per-barber public token is deferred until a second barber exists (see Approach).
- `public-service-catalog-read`: catalog returned as `{ name, durationMinutes, price }`, without internal IDs or storage shape.
- `public-barber-selector`: prototype-matching selector backed by the context `barbers` list; one barber is displayed now and additional barbers can be added through data.
- `public-theme-switch`: light/dark token and heading-font switch matching both prototypes.

### Modified Capabilities
- None.

## Approach

Use a narrow Edge Function/RPC read path and DTOs that never leak internal IDs or storage shape. Add a unique public identifier on `Barberia` for `/b/[slug]`. The context DTO returns the `barbers` list so the selector is wired to real data. A per-barber opaque public token is explicitly DEFERRED: with a single barber nothing needs filtering, and adding a DTO field later is additive rather than a rewrite. Read the existing `Servicio` rows through the single `Barbero`; do not add `barberia_id` or perform read-time deduplication. Reuse the prototype structure, including the selector, but omit booking flows and login.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| Repository root | New | Astro, React islands, TypeScript, package/config/scaffold |
| `supabase/migrations/` | New | `Barberia` public identifier only |
| Edge Functions/RPC | New | Context and catalog DTO reads |
| `src/pages/b/[slug].astro`, components/styles | New | Public profile, catalog, selector, theme switch |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Greenfield bootstrap exceeds review budget | High | This change WILL exceed 400 changed lines; split naturally after bootstrap + read infrastructure, before UI/theme delivery. |
| Internal ID/storage leak | Medium | Contract tests assert exact DTO fields and deny direct `anon` table access. |
| Selector suggests unavailable choices | Low | Render the prototype control as functional, but show only the single DTO barber and document the future expansion behavior. |

## Rollback Plan

Remove the new web/Edge artifacts and revert the `Barberia` identifier migration. Do not alter `Servicio`, mobile catalog behavior, or `anon` grants.

## Dependencies

- `plan_web_publica.md` and `db-baseline.md` for technical/security truth; both HTML prototypes for visual truth.

## Success Criteria

- [ ] `/b/[slug]` renders context and catalog through Edge Function/RPC.
- [ ] Context returns the specified `barbers` DTO list with one entry; the selector remains visible and functional-looking.
- [ ] DTOs contain no internal IDs and catalog fields are exactly name, durationMinutes, and price.
- [ ] `anon` has no table grants; direct table reads are impossible.
- [ ] Light/dark tokens and Playfair/Oswald heading swap match the prototypes.
- [ ] Astro build/typecheck succeed after scaffold bootstrap.
- [ ] Delivery is split before apply into reviewable slices because the 400-line budget is exceeded.
