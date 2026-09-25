# Proposal: Public UI Parity

## Intent

Align the public landing and read-only booking step with the mockup without changing database contracts. The existing 14-day read supports the intended interaction.

## Scope

### In Scope
- Three chained slices: date scroller; bucketed times and step chrome; tokens, fidelity, and brand copy.
- Preserve database-authoritative shop/service data while deriving presentation state in the booking island.

### Explicitly Excluded
- **Rating row (`★★★★★ · 5.0 · 37 reseñas`)**: no data source exists; add no column or DTO field.
- New fetch endpoint, DTO, RPC, Edge Function, migration, barber selector, or prototype sticky booking gate.
- Restyling the post-selection panel: retain its current honest read-only copy and dead-end behavior.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `public-availability-read`: change the entry-point presentation to a selectable scroller and grouped slots while preserving its contract and final state.
- `public-theme-switch`: promote `--fill-strong` as a shared token in both themes.

## Delivery Slices

1. **Date scroller** — render returned days, disabled empty days, deterministic first-open-day selection, and labels; fixes the primary mismatch first (~280 lines).
2. **Bucketed times + step chrome** — add Morning/Afternoon/Evening groups, service chip, modal links, professional pill, and calendar jump (~310 lines).
3. **Tokens + fidelity + brand copy** — finish tokens, shadows, typography, disclosure, brass logo, and “Hoy ” prefix (~220 lines).

## Approach

Target the current `app/` Next.js App Router (`components/booking`, `components/public`, `app/globals.css`). Keep `types/booking.ts` and `lib/availability.server.ts` unchanged; derive buckets from strings without `Date`. Constraints: E1 mockup structure/copy with DB name, description, and hours; E2 no rating; E3 14-card scroller plus grouped slots; E4 client buckets; E5 first-class token; post-selection copy stays honest.

`package.json` confirms Next.js 16 + React 19; config/testing notes still say Astro SSR + React 18. Target is the actual `app/` layer; this drift is a risk.

## Affected Areas

`components/booking/AvailabilityCalendar.tsx` and test; `app/reservar/page.tsx`; `app/globals.css`; public components and tests.

## Risks and Open Questions

- **High:** hydration mismatch; use DTO weekday/date strings and deterministic state initialization.
- **Medium:** empty means closed or full; accepted and deferred.
- **Medium:** failed research left these unanswered: (1) accessible picker roles, keyboard behavior, and disabled semantics; (2) deterministic labels across hydration, timezone, and locale; (3) accessible custom disclosure semantics. Validate manually.
- **Low:** crumb source and calendar-jump behavior remain open; prefer cached context and scroll-to-selected. Single-word logos render plain.

## Rollback Plan

Revert any slice independently; no data or contract rollback is required.

## Dependencies and Success Criteria

- Existing reads and test stack.
- [ ] Three slices remain reviewable under 400 changed lines.
- [ ] `npm test`, `npm run test:e2e`, `npm run typecheck`, and `npm run build` pass; manual theme/mockup review confirms fidelity.
