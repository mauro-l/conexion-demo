# Exploration: public-ui-parity

## Answer first

- **No new data fetch, DTO, RPC, or Edge change is required.** Everything missing (A1–A7) renders from data already crossing the boundary. Bucketing is client-side. Details and evidence in "Data-contract verdict".
- **Three slices, each under the 400-line review budget**, delivered as a stacked chain to main: (1) date scroller, (2) bucketed times + step chrome, (3) tokens + visual fidelity + brand copy.
- **Rating row (A8) is excluded**, per the product decision already made — no data source exists. It must appear as an explicit exclusion in the proposal, not as a requirement.
- Settled in this exploration: the logo two-tone rule, the date-card states rule, the bucket boundaries and where they live, the default-selection rule, and back/close behavior. Open questions are short and listed at the end.

## Current State

The landing (`app/page.tsx` → `PublicHeader` / `PublicHero` / `PublicInfo` / `ServiceCatalog`) is largely faithful to the prototype. The booking step (`app/reservar/page.tsx` → `AvailabilityCalendar.tsx`) is structurally a different product: it renders a vertical list of every day with a flat slot list per day, selection starts at `null`, and the step reuses the home header. The prototype's step is a two-part interaction — a horizontal scroller of 14 date cards (today selected, non-working days disabled) plus the selected date's times bucketed into Mañana / Tarde / Noche — with modal chrome (back / crumb / close), a service chip, and two section labels.

The availability read already returns the full 14-day window in one response: `Availability = { service: { name, durationMinutes, price, description }, days: [{ date, day (0=Sunday..6=Saturday), slots: [{ start, end, availabilityToken }] }] }` (`types/booking.ts`, validated in `lib/availability.server.ts:31-69`). The island already documents the hydration constraint: the DTO carries Buenos Aires local strings plus a pre-computed weekday index so server and browser format identically without constructing `Date` (`AvailabilityCalendar.tsx:14-23`).

## Affected Areas

- `components/booking/AvailabilityCalendar.tsx` — rewrite from vertical day list to scroller + bucketed groups; owns selection state. Slices 1–2.
- `components/booking/AvailabilityCalendar.test.tsx` — unit coverage for buckets, disabled rule, default selection. Slices 1–2.
- `app/reservar/page.tsx` — step chrome (modal topbar), service chip, section labels, cal-jump button, professional pill markup. Slice 2.
- `app/globals.css` — date/time component styles, `--fill-strong` token, per-element letter-spacing, theme-correct shadows, slot sizing, prof pill. Slices 1–3.
- `components/public/PublicHeader.tsx` — two-tone logo split from DB name. Slice 3.
- `components/public/PublicInfo.tsx` — "Hoy " prefix on the hours row (UI copy). Slice 3.
- `components/public/ServiceCatalog.tsx` — "Qué incluye" chevron affordance. Slice 3.
- `components/ThemeSwitch.tsx` — untouched (plan-mandated, audit-confirmed fine).
- Explicitly NOT touched: Edge Function, RPC/migrations, `types/booking.ts`, `lib/availability.server.ts`, `openspec/audits/*`, `openspec/changes/archive/*`.

## Approaches

1. **Client-side derivation in the island (recommended)** — scroller filters `days`, buckets derive from `slot.start` hour via string slice, disabled = `slots.length === 0`, default = first day with slots. No contract change.
   - Pros: zero backend work; boundary rule stays presentation-only per E4; single-response read already covers 14 days; hydration-safe (no `Date` construction).
   - Cons: bucket rule lives in UI (accepted by E4); a fully-booked day is indistinguishable from a closed day (both unselectable — acceptable).
   - Effort: Medium.
2. **Server/Edge-derived buckets + working-day flags** — RPC returns `groups` or `isWorkingDay` per day.
   - Pros: explicit closed-vs-full distinction; bucket rule testable in pgTAP.
   - Cons: migration + Edge + DTO + parser changes for presentation logic; contradicts E4; larger blast radius for zero user-visible gain.
   - Effort: High.
3. **Single-slice delivery** — all A-items + B-items in one PR.
   - Pros: one review cycle.
   - Cons: ~700+ reviewable lines, violates the fixed 400-line budget with no exception; mixes interaction logic with cosmetic tokens, so rollback is all-or-nothing.
   - Effort: High (review load, not code).

## Recommendation

Approach 1, delivered as three stacked slices to main (auto-chain). Each slice is independently verifiable and revertible; each states its own rollback boundary (revert the single PR — no migration or contract change exists to unwind).

### Settled rules (proposal must encode these, not re-decide them)

| Question | Rule |
|---|---|
| Logo two-tone with DB name | Split on whitespace; **last word renders in `--brass`** (`name` → `head` + `<span>tail</span>`). Single-word name renders plain (no span, no fake split). Multi-word: all but last plain, last in brass. E.g. "Conexión Barbería" → `Conexión <span>Barbería</span>`. Implemented as a tiny pure helper (unit-testable) in the Server Component. |
| Date-card content | `dow` (short weekday from DTO `day` index via existing `WEEKDAYS`, capitalized display), `dnum` (day of month from `date` string slice), `mon` (short month). Source: prototype `:426-429`; labels already Spanish in the DTO contract. |
| Date-card states | Default (card), `selected` (brass bg/border per prototype `:137-139`), `disabled` (`opacity:0.4`, `pointer-events:none` per prototype `:140`). **Disabled ⇔ `day.slots.length === 0`.** Never hardcode Sunday: the plan explicitly rejects the prototype's Sunday closure and the DB owns working days. |
| Bucket boundaries | `hour < 12` → Mañana, `< 18` → Tarde, else Noche (prototype `bucket()` `:442`). Pure function in the island parsing the hour from `slot.start` (`"HH:MM"` string slice — no `Date`, hydration-safe). |
| Default selection | First day with `slots.length > 0`, computed in the `useState` initializer from props (deterministic on server and client). Generalises prototype `i===0` for DB-owned working days: if day 0 is closed, day 0 is disabled and the first open day is selected; if none, the existing empty state renders. |
| Back / close | Deterministic links to `/` (`aria-label` "Volver" / "Cerrar"), not `history.back()` — testable in Playwright, no dead end. Crumb shows the shop name (see open question on its data source). |
| Service chip | `service.name` + `duration · price` reusing the existing duration/price formatting (extract `formatDuration`/`formatPrice` from `ServiceCatalog.tsx` to a shared helper rather than duplicating). Data already validated at `availability.server.ts:39-41`. |
| `--fill-strong` | First-class token in `:root` (`#0E0E0F` dark per prototype; light value = `--ink` per light prototype `:125` where the avatar uses `--ink`). Avatar uses `var(--fill-strong)`; `--brand-mark-bg` folds to it or stays as an alias — proposal's call, spec pins one. |

## Requirement list (grouped by slice, testable phrasing)

### Slice 1 — Date scroller (`A1, A4-part, A7`)

1. The step MUST render one card per day in the returned window (14 cards when the window is full), each showing weekday, day number, and month.
2. A day with zero slots MUST render `disabled` and MUST NOT be selectable.
3. Exactly one non-disabled card MUST be selected at all times; the initial selection MUST be the first day with slots (today when open).
4. Clicking a non-disabled card MUST move selection to it and update the times below (times wiring may land fully in slice 2, but selection state must be slice-1 complete).
5. The "Elegí una fecha" label MUST render above the scroller.

### Slice 2 — Bucketed times + step chrome (`A2, A3, A5, A6`, prof-pill part of `B5`)

6. The selected date's slots MUST render grouped under Mañana / Tarde / Noche with the `<12 / <18` rule; empty groups MUST NOT render a heading.
7. The step MUST render a service chip with service name and duration · price.
8. The "Elegí un horario" label MUST render above the groups.
9. The step MUST render modal chrome: back link (`/`), crumb (shop name), close link (`/`); the home header MUST NOT render on `/reservar`.
10. The professional affordance MUST be a pill with avatar and chevron (prototype `:124-127, :250-255`), replacing the full-width card + "Profesional" label; still exactly one static "Cualquier profesional" option.
11. The calendar-jump button (`aria-label` "Ir a una fecha específica") MUST render; its behavior is scroll-to-selected/focus within the scroller (no calendar dialog in this change).
12. The existing read-only end state (chosen summary + "Elegir otro horario") MUST keep working against the new selection model; step gating (prototype sticky bar) stays out of scope per audit section C.

### Slice 3 — Tokens + fidelity + brand copy (`B1–B4, B6`, logo rule, Hoy prefix, `--fill-strong`)

13. Brand-mark and ticket shadows MUST use the dark values in dark theme and the light values in light theme (no cross-theme leak).
14. Letter-spacing MUST be per-element: logo `0.04em`, services `h2` `0.03em` (dark Oswald) / `0.06em` muted label (light), hero `h1` and ticket names none — the single `--heading-letter-spacing` applied to all four MUST be removed.
15. The logo MUST render the last-word brass split (single-word → plain); the dead `.logo span` rule MUST fire.
16. Slot buttons MUST be `14.5px / 600 / radius 12px` mono (prototype `:143`); the group-label style (`12px/600/muted/uppercase`) MUST render.
17. "Qué incluye" MUST render a chevron affordance that rotates 180° on expand (accessible `button` + `aria-expanded`, replacing bare `<details>/<summary>`).
18. `--fill-strong` MUST exist as a first-class token in both themes and back the professional avatar.
19. The hours row MUST render the "Hoy " prefix (UI copy) before the DB hours value.
20. EXCLUSION (not a requirement): the rating row MUST NOT be implemented — no column, no DTO field exists; recorded in the proposal with that reason.

## Proposed slices (400-line verdicts)

Estimates count reviewable changed lines (code + tests + CSS), calibrated against current file sizes (`AvailabilityCalendar.tsx` 85, `reservar/page.tsx` 73, `globals.css` 537).

| Slice | Contents | Est. lines | 400-line verdict |
|---|---|---|---|
| 1 — Date scroller | Island date-selection rewrite (~+110), scroller/card CSS (~+90), Vitest for disabled/default/labels (~+80) | ~280 | ✅ fits |
| 2 — Times + chrome | Island bucket groups (~+90), `reservar/page.tsx` chrome/chip/pill (~+60), related CSS (~+70), Vitest + Playwright additions (~+90) | ~310 | ✅ fits |
| 3 — Tokens + fidelity | `globals.css` token/shadow/spacing/slot edits (~±70), `PublicHeader` + helper, `PublicInfo`, `ServiceCatalog` chevron (~+70 total), tests (~+60) | ~220 | ✅ fits |

Order rationale: slice 1 fixes the reported symptom first and is independently shippable; slice 2 completes the interaction; slice 3 is cosmetic-only and can land last or be deferred without leaving broken structure. Rollback per slice: revert its single PR; no data migration or contract change to unwind in any slice.

## Verification (which layer proves what)

| Requirement | Layer |
|---|---|
| Bucket rule, disabled rule, default-selection rule, logo-split helper, duration/price format | Vitest (`npm test`) — pure functions + island state via existing `AvailabilityCalendar.test.tsx` pattern |
| 14 cards render, one selected by default, click moves selection, groups render for selected date, chrome links present, chip content | Playwright (`npm run test:e2e`) |
| No DTO/contract drift | `typecheck` + existing `availability.server.test.ts` (unchanged, must stay green) |
| Every slice | `typecheck`, `lint`, `build` green |
| **Cannot be proven by an executable check — stated explicitly**: exact computed styles (shadow `rgba` values, letter-spacing, 14.5px/600 slot type, pill radius). jsdom has no layout; Playwright `computedStyle` assertions are possible but brittle across browsers. Slice 3 verifies these by token-presence assertions (custom property values in source) where cheap, plus documented human visual comparison against the prototype. A screenshot is reviewed, not asserted — it is not a test. |

`strict_tdd` is false for this repo; slices follow test-with-code, not test-first ceremony.

## Data-contract verdict: NO new fetch, DTO, RPC, or Edge change

- **No new fetch**: `loadAvailability` already returns the whole 14-day window in one uncached response; the scroller filters client-side. Evidence: `lib/availability.server.ts:88-107`, `types/booking.ts:33-36`.
- **No DTO change**: `AvailabilityDay { date, day, slots }` carries everything the cards need (weekday index + date string + emptiness signal); `AvailabilityService { name, durationMinutes, price, description }` carries the chip. Evidence: `types/booking.ts:17-31`, parser `availability.server.ts:37-46`.
- **No RPC / Edge change**: working days already derive from the database in the RPC (audit section C; plan explicitly rejects assuming Sunday closure). Client treats `slots.length === 0` as non-selectable — no `isWorkingDay` flag needed.
- **One judgment call for the proposal**: the crumb needs the *shop* name, but `/reservar` currently loads only availability (which carries the *service* name). Recommend a cached `loadPublicPageData` read alongside `loadAvailability` (60s revalidation, same pattern as the landing) — a server-composition addition, not a contract change. Alternative (open question): omit the crumb or reuse the service name — both deviate from the prototype.

## Risks

- **Hydration mismatch (primary)**: a date selector is exactly the component class that reintroduces it. Mitigations already identified: never construct `Date` in render; derive weekday/month labels from DTO `day` index + `date` string slices; compute default selection in the `useState` initializer from props so server and client agree. Any `Intl.DateTimeFormat` use must run identically on both sides or move behind mount-gating.
- **Closed-vs-fully-booked conflation**: `slots.length === 0` covers both; a visitor cannot distinguish "closed" from "full". Accepted for this change; a future `isWorkingDay` flag would need an RPC + DTO change (explicitly deferred).
- **Window-length assumption**: island must not assume exactly 14 days — render `days.length` cards and keep the empty state when none have slots.
- **Slice-1 size pressure**: at ~280 lines it fits, but bucket CSS creeping into slice 1 would push it over; keep group styles strictly in slice 2.
- **`<details>` → button chevron (B6)**: changes keyboard/AT behavior; keep `aria-expanded` + focus styles, cover with a Vitest/Playwright assertion.
- **Theme-token rename fallout**: splitting `--heading-letter-spacing` touches four selectors across two themes; verify both themes in slice 3 (Playwright can set `data-theme`).

## Open questions (short, concrete)

1. Crumb data source: cached context read on `/reservar` (recommended) vs. omit vs. service name?
2. Post-selection summary copy: keep the existing honest dead-end panel verbatim, or restyle toward the prototype recap (sticky bar itself stays out of scope)?
3. Cal-jump beyond scroll-to-selected: acceptable as specified, or must it open a native date picker?
4. Single-word shop name logo: plain render (recommended) — confirmed acceptable?

## Ready for Proposal

Yes. The orchestrator can tell the proposal phase: encode the settled-rules table verbatim, carry requirements 1–19 plus the A8 exclusion, deliver in the three slices above, and resolve the four open questions (defaults recommended inline).
