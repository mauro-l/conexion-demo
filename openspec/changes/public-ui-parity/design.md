# Design: Public UI Parity

## Technical Approach

Keep Next.js App Router and server-only reads. `ReservarPage` composes cached shop context with uncached availability; `AvailabilityCalendar` remains the booking island and derives presentation, selection, and groups locally. Deliver three stacked, revertible slices; no backend contract changes.

## Architecture Decisions

| Decision | Pin |
|---|---|
| Crumb data | `ReservarPage` calls `loadPublicPageData(slug)` beside `loadAvailability`; use verified `context.barberia.name`. Cost: two cached public reads (context/catalog), bounded to 60 seconds. A narrow read later needs a helper/endpoint; moving the name into availability needs DTO/Edge/RPC work. |
| Strong fill | Light `--fill-strong: #1A1A1A`; dark `#0E0E0F`. Keep `--brand-mark-bg: var(--fill-strong)` as a compatibility alias; the avatar uses `var(--fill-strong)`. |
| Buckets | Island-local in `AvailabilityCalendar.tsx`: `export function bucketSlots(slots: AvailabilitySlot[]): Record<TimeBucket, AvailabilitySlot[]>`, with `type TimeBucket = 'Mañana' | 'Tarde' | 'Noche'`. Parse the hour before `T` (or `HH:MM`), never `Date`; output is deterministic. |
| Logo | `components/public/PublicHeader.tsx` exports pure `splitLogoName(name: string): { head: string; tail: string | null }`. Split trimmed whitespace; all but the last word are `head`, the last is `tail`; a single word has `tail: null` and no span. |
| Formatting | Create `lib/public-format.ts` with `formatDuration` and `formatPrice`. `ServiceCatalog.tsx` imports them; the booking chip uses the same helpers. |
| Selection | `CalendarSelection = { dayIndex: number; slot: AvailabilitySlot | null }`; initialize with `dayIndex: days.findIndex(day => day.slots.length > 0)` and `slot: null`. `-1` is the all-empty state. Disabled is exactly `slots.length === 0`, with no activation handler. No effect or post-hydration flip. |
| Final/jump | Preserve the honest summary copy and `Elegir otro horario` verbatim; do not restyle it into the prototype recap. A `useRef` jump handler only scrolls/focuses the selected card inside `.date-scroller`; it never opens a date dialog. |

## Data Flow and Interfaces

```text
ReservarPage ── loadAvailability(no-store) + loadPublicPageData(60s)
             └─ service chip/topbar ── AvailabilityCalendar(days)
                                      └─ selection → bucketSlots → rendered groups
```

No new fetch endpoint, DTO, RPC, Edge Function, or migration. Leave `types/booking.ts`, `lib/availability.server.ts`, the `public-availability` Edge Function, and migrations untouched. Render `days.length` cards; labels use DTO `day`, date slices, and fixed months. The chip renders service name plus duration · price. Landing components retain database description/hours; `PublicInfo` prefixes literal `Hoy `; no rating is added. The topbar uses `/` links labelled `Volver` and `Cerrar`; `/reservar` omits `PublicHeader`. The page passes database shop name to `PublicHeader`; its not-found fallback remains safe.

## File Changes and Slice Budget

| Slice | Exact creates/changes | Estimate / rollback |
|---|---|---|
| 1 — date scroller | Modify `components/booking/AvailabilityCalendar.tsx`, `components/booking/AvailabilityCalendar.test.tsx`, `app/globals.css`. | ~280 lines; **fits** 400. Revert this slice only; no migration/contract unwind. |
| 2 — groups/chrome | Modify `components/booking/AvailabilityCalendar.tsx`, `components/booking/AvailabilityCalendar.test.tsx`, `app/reservar/page.tsx`, `app/globals.css`, `components/public/ServiceCatalog.tsx`, `tests/e2e/public-availability.spec.ts`; create `lib/public-format.ts`. | ~310; **fits**. Revert to slice 1; no migration/contract unwind. |
| 3 — tokens/fidelity/copy | Modify `app/globals.css`, `app/page.tsx`, `components/public/PublicHeader.tsx`, `components/public/PublicInfo.tsx`, `components/public/ServiceCatalog.tsx`, `components/public/ServiceCatalog.test.tsx`, `components/public/PublicInfo.test.tsx`; create `components/public/ServiceDisclosure.tsx`, `components/public/PublicHeader.test.tsx`. | ~220; **fits**. Revert to slice 2; no migration/contract unwind. |

## CSS and Accessibility

Set prototype shadows: brand mark light `rgba(21,23,26,0.18)` / dark `rgba(0,0,0,0.35)`; ticket light `rgba(21,23,26,0.04)` / dark `rgba(0,0,0,0.2)`. Remove `--heading-letter-spacing`; replace uses in `.logo` (`0.04em`), `.hero-title` (none), `.section-title` (light `0.06em`, dark `0.03em`), and `.ticket-name` (none). Set `.availability-slot` to `14.5px/600` mono, radius `12px`; `.group-label` is muted uppercase `12px/600`; `.prof-select` is the avatar/chevron pill with 26px avatar and `border-radius: 999px`. Replace `<details>/<summary>` with client `ServiceDisclosure`: native `button`, `aria-expanded`, `aria-controls`, hidden region, focus-visible styling, and rotating chevron.

## Testing Strategy

- **Vitest:** `bucketSlots` boundaries, labels, disabled/default/selection state, `splitLogoName`, formatters, and disclosure toggle.
- **Playwright:** returned cards, selection, group omission, chip content, chrome links to `/`, no home header, professional pill, jump behavior, and unchanged read-only completion/no mutation.
- **Gates:** `npm test`, `npm run test:e2e`, `npm run typecheck`, `npm run lint`, and `npm run build`; typecheck/build guard contract drift. `strict_tdd` is false: test-with-code.
- Exact shadow rgba, letter-spacing, slot type, and pill radius cannot be robustly proven by executable checks; token/source checks plus human screenshots against both prototypes are review evidence, not tests.

## Risks, Threat Matrix, and Rollout

| Severity | Risk / mitigation |
|---|---|
| High | Hydration mismatch: string slices, DTO weekday, fixed months, deterministic initializer, no `Date`/mount effect. |
| Medium | Closed and fully booked both mean disabled; accepted. An `isWorkingDay` distinction later requires DTO/RPC/Edge change. |
| Medium | Do not assume 14 days; use `days.length` and retain the empty state. |
| Medium | Token rename fallout: audit the four named selectors in both themes. `<details>` to button changes AT behavior: test `aria-expanded`, `aria-controls`, keyboard focus, and hidden content. |

Threat matrix is N/A for documentation paths, repository selection, commit/push state, PR commands, shell, subprocess, and process integration: only links/rendering are added. No migration; run gates after each slice.

## Open Questions

None. `loadPublicPageData` was verified to return `context.barberia.name`; all eight design decisions are pinned above.
