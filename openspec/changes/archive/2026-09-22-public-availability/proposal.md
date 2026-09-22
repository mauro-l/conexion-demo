# Proposal: public-availability

## Intent

Add database-authoritative, read-only availability to the Next.js public flow with an explicit handoff to booking.

## Scope

### In Scope
- A 14-day read through a service-role-only Edge Function and RPC.
- Effective hours, blocks, occupying appointments, fixed Buenos Aires time, and 30-minute minimum lead time.
- Opaque service token, tokenized CTA, `/reservar?service=<token>`, “Cualquier profesional,” calendar/slots, and next-stage state.
- Short-expiry availability-token contract; persistence is resolved during specification.

### Out of Scope
- Booking creation, customer data, idempotency, cancellation, management tokens, and mutations.
- Per-barber selection, booking-time resolution, private-panel changes, and demo fixtures.

## Capabilities

### New Capabilities
- `public-availability-read`: Expose uncached availability and the read-only booking-entry flow.

### Modified Capabilities
- `web-app-scaffold`: `/reservar` becomes a real route and the catalog CTA navigates to it.
- `public-barber-selector`: Restore only the “Cualquier profesional” affordance on `/reservar`; the landing remains selector-free.
- `public-service-catalog-read`: Add the opaque service token while retaining database-authoritative service fields and no internal IDs.

## Approach

Extend the Edge/RPC boundary with validation, stable errors, least-privilege grants, and no-store responses. PostgreSQL computes the intersection of shop and barber schedules; `pendiente`, `confirmado`, and `completado` occupy intervals. Use a server-only Next read and minimal Client Components. Specs must pin day numbering, window edges, NULL-hour fallback, token storage, and migration details. NULL duration excludes a service. CORS must reconcile ports `4321` and `3000`, or avoid browser-to-Edge calls.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `app/reservar`, `components/booking`, `lib`, `types` | New/Modified | Route and UI |
| `components/public/ServiceCatalog.tsx` | Modified | Tokenized CTA |
| `supabase/functions`, RPC migration, `Servicio` | New/Modified | Availability and token |
| `openspec/specs/*` | Modified/New delta | Capability deltas |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| CORS allows `localhost:4321` only | High | Fix allowlist or route server-side |
| Published shop lacks fixtures | High | Test empty-calendar behavior; fixture later |
| Anti-overlap migration is unversioned and differently named | Medium | Verify the live predicate before implementation |
| Review exceeds 400 changed lines | High | **400-line budget risk: High; Chained PRs recommended: Yes.** |

## Rollback Plan

Disable the CTA and `/reservar`, return to landing, and disable the read endpoint. Retain or revert the token migration after review; no booking data exists to delete.

## Dependencies

- Fase 1’s shipped Next and Edge/RPC boundary.
- Fase 3 must consume this contract and enforce the same lead-time rule server-side.
- Specs must resolve scheduling and token semantics before design.

## Success Criteria

- [ ] Valid service links show only computable, currently available slots.
- [ ] Responses expose no internal IDs or mutation capability; rollback returns to landing.
