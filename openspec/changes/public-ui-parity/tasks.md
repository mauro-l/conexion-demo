# Tasks: Public UI Parity

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~810 total (s1 ~280, s2 ~310, s3 ~220) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Decision needed before apply | No |
| Suggested work-unit boundaries | S1 scroller → S2 groups/chrome → S3 tokens/copy, stacked to main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High
Estimated changed lines: ~810 total (s1 ~280, s2 ~310, s3 ~220)

### Suggested Work Units

| Unit | Goal | Test | Harness | Rollback |
|---|---|---|---|---|
| S1 | Scroller, selection, `Elegí una fecha` | `npm test` | E2E scroller `/reservar` | Revert island + test + `app/globals.css` |
| S2 | Groups, chip, pill, jump, chrome, `Elegí un horario` | `npm test` + `npm run test:e2e` | E2E chrome + read-only completion | Revert to S1 (delete `lib/public-format.ts`) |
| S3 | Tokens, shadows, logo, `Hoy `, disclosure | `npm test` + `typecheck` + `build` | Screenshots vs prototypes | Revert to S2 (delete 2 new files) |

No slice needs a migration/contract unwind.

## Slice 1 — Scroller (ships symptom fix; blocks S2–S3)

- [x] 1.1 `components/booking/AvailabilityCalendar.tsx`: `CalendarSelection`, first-open-day init (`-1` all-empty), disabled ⇔ `slots.length === 0`, no `Date`/effect. Req: scroller. Verify: `npm test`.
- [x] 1.2 `components/booking/AvailabilityCalendar.tsx` + `app/globals.css`: card per `days.length` (DTO labels), literal `Elegí una fecha`, click moves selection. Req: scroller. Verify: `npm run test:e2e`.
- [x] 1.3 `components/booking/AvailabilityCalendar.test.tsx`: disabled rule, closed-leading-day default, click replaces selection/slots. Req: scroller. Verify: `npm test`.

## Slice 2 — Groups + chrome (needs S1; not S3)

- [x] 2.1 `components/booking/AvailabilityCalendar.tsx`: `bucketSlots` (`<12`/`<18`, parse before `T`, no `Date`), omit empty groups, literal `Elegí un horario`. Req: groups (11:59/12:00/17:59/18:00). Verify: `npm test`.
- [x] 2.2 `app/reservar/page.tsx`: `Volver`/`Cerrar` → `/`, shop crumb via cached `loadPublicPageData`, no `PublicHeader`. Req: structure. Verify: `npm run test:e2e`.
- [x] 2.3 Create `lib/public-format.ts`; chip (DB name + duration · price) in `app/reservar/page.tsx`; `Cualquier profesional` pill + `Ir a una fecha específica` scroll/focus (no dialog) in island; keep `Elegir otro horario`. Req: structure. Verify: `npm run test:e2e`.
- [x] 2.4 `components/booking/AvailabilityCalendar.test.tsx` + `tests/e2e/public-availability.spec.ts` + `app/globals.css`: omission, chip, pill, jump, read-only completion. Req: groups + structure. Verify: `npm test` + `npm run test:e2e`.

## Slice 3 — Tokens + copy (needs S2; cosmetic-only)

- [ ] 3.1 `app/globals.css`: `--fill-strong` both themes (light ink, dark `#0E0E0F`), theme-correct shadow rgba, per-element spacing, drop `--heading-letter-spacing`; slot 14.5px/600 mono r12, label 12px/600 uppercase muted, pill 26px avatar r999. Req: theme-switch + fidelity + booking-fidelity. Verify: `typecheck` + `build`; exact rgba/spacing are screenshots, not tests.
- [ ] 3.2 `components/public/PublicHeader.tsx` + create `components/public/PublicHeader.test.tsx`: `splitLogoName` (last word `var(--brass)`; single word plain: `Conexión`/`Barbería`); avatar uses `var(--fill-strong)`. Req: fidelity + theme-switch. Verify: `npm test`.
- [ ] 3.3 `components/public/PublicInfo.tsx` (`Hoy ` prefix; accept `Hoy 10:00–20:00`) + create `components/public/ServiceDisclosure.tsx` (button, `aria-expanded`/`aria-controls`, 180° chevron) in `components/public/ServiceCatalog.tsx`; `app/page.tsx` DB values only. Req: db-copy + disclosure. Verify: `npm test` + `npm run test:e2e`.
- [ ] 3.4 `components/public/ServiceCatalog.test.tsx` + `components/public/PublicInfo.test.tsx`; negative: `★★★★★ · 5.0 · 37 reseñas` nowhere, no rating column/DTO field (non-goal). Req: no-rating. Verify: `npm test` + literal sweep (`Elegí una fecha`, `Elegí un horario`, `Ir a una fecha específica`, `Cualquier profesional`, `Volver`, `Cerrar`, `Elegir otro horario`, `Hoy `).

## Requirement → task map (9/9)

| Requirement | Tasks |
|---|---|
| Scroller | 1.1, 1.2, 1.3 |
| Time groups | 2.1, 2.4 |
| Step structure/controls | 2.2, 2.3, 2.4 |
| DB-authoritative copy | 3.3 |
| No rating (exclusion) | 3.4 (negative check) |
| Booking visual fidelity | 2.4, 3.1 |
| Theme switch (`--fill-strong`) | 3.1, 3.2 |
| Fidelity tokens + brand mark | 3.1, 3.2 |
| Service disclosure | 3.3 |

Guard: no task touches `types/booking.ts`, `lib/availability.server.ts`, the `public-availability` Edge Function, or any migration. `typecheck` + `build` prove non-drift each slice. Open questions: none blocking.
