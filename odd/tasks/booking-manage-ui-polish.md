# Booking manage UI polish (continuation)

Continuation of the already-authorized UI work on the pushed feature branch — not SDD. Delivers one coherent manage/cancel flow polish work unit, with tracked sub-tasks and the stale e2e selector update.

## Quick path

1. Finish the full Vitest, typecheck and lint checks; keep the local-only E2E blocker visible.
2. Commit the complete flow correction as one work unit with its tests and docs.
3. Push the branch with the accepted `size:exception`; open a PR only after a relevant approved issue is available.

## Authorized scope

| Topic | Decision |
|-------|----------|
| Branch | `feat/manage-booking-ui` in its isolated linked worktree (already pushed; this task continues it) |
| Authorized actions | Fixes, work-unit commits, push, and a PR (user-authorized) |
| Relevant files | `components/booking/ManageBooking.tsx`, `components/booking/ManageBooking.test.tsx`, `app/globals.css`, `tests/e2e/public-booking-lookup.spec.ts` (stale — updated with implementation) |
| No database changes | No migrations, no RLS, no Edge Function, no schema change |
| Out of scope | Booking behavior changes, cancellation behavior changes (owned by `odd/tasks/public-cancellation.md`), lookup UI acceptance beyond BMP-1/BMP-2 (owned by `odd/tasks/booking-lookup.md`) |
| Sibling task docs | `odd/tasks/public-cancellation.md` and `odd/tasks/booking-lookup.md` received concise owner-authorized addenda in this work unit |
| Artifact language | English for all artifact text (code, comments, UI copy, tests, commits, PR) |

## Objective / problem / why

The manage-booking UI is functionally complete on the branch but has three review-visible polish gaps: (1) the `Volver` / `Buscar turno` buttons in the lookup modal are unevenly sized; (2) the red final-cancellation CTA text is low-contrast in one or both themes; (3) after a successful cancellation the user has a rebooking exit (`Reservar otro turno`) but no distinct, clear home exit. Fixing these keeps booking behavior identical while making the flow look consistent, keeping destructive confirmation readable for all users, and giving cancelled users both exits.

## Constraints

- BMP-1 button sizing is scoped to the lookup modal only — the separate booking form row must remain unchanged.
- BMP-1 contrast fix must reach WCAG >= 4.5:1 computed foreground/background in each theme (light and dark); do not change booking behavior.
- BMP-2 must reuse the existing `Volver al inicio` copy/style for the home link; retain `Reservar otro turno` and all existing behavior.
- Testing/TDD: `openspec/testing-capabilities.md` records `strict_tdd: false` (its stack-description portion is stale, but the `strict_tdd` flag is the latest recorded setting). RDD mode was read as globally off. Commands: `npm test` (Vitest), `npm run typecheck`, `npm run lint`, `npm run test:e2e` (Playwright).
- All artifact text in English.

## Tasks

- [x] BMP-1 Visual consistency — equal-size `Volver` / `Buscar turno` in the lookup modal only (booking form row unchanged); red final-cancellation CTA text visually coherent and accessible in light/dark themes.
- [x] BMP-2 Cancellation exit — after cancellation succeeds, render a distinct, clear home link with existing `Volver al inicio` copy/style; keep `Reservar otro turno` and all existing behavior.
- [x] BMP-3 Stale e2e selectors — update `tests/e2e/public-booking-lookup.spec.ts` to the current `.recap`, `Sí, cancelar`, and `.note-box` UI.

## Acceptance checks

- [x] Unit (`ManageBooking.test.tsx`) and e2e selectors match the current UI; the stale `public-booking-lookup.spec.ts` expectations are fixed.
- [ ] Playwright asserts the lookup modal `Volver` and `Buscar turno` bounding-box dimensions match (width and height) — spec written; execution blocked locally.
- [x] Computed foreground/background contrast is >= 4.5:1 in light (`5.98:1`) and dark (`5.41:1`) themes; browser assertion is written but not run.
- [x] Cancelled view offers both `Reservar otro turno` and `Volver al inicio` — unit-asserted; browser assertion is written but not run.
- [x] Full Vitest (`npm test`), typecheck and lint pass. Playwright E2E is blocked by missing local env/build and unavailable mounted Edge source; no remote fallback.

## Progress / verification slots

| Work unit | Commit | Focused test + result | E2E / harness + result | Rollback boundary |
|-----------|--------|----------------------|------------------------|-------------------|
| Manage-flow UI polish (BMP-1–3) | `b975041` (pushed) | Focused Vitest 19/19; full `npm test` 128/128; typecheck and lint clean | Playwright assertions written; execution blocked locally | Revert modal/action CSS, home link, and matching test/doc updates; booking behavior untouched |

Recorded checks: `npx vitest run components/booking/ManageBooking.test.tsx components/booking/ManageBookingLookup.test.tsx` — 19 passed (parent spot-check); `npm test` — 17 files, 128 passed; `npm run typecheck` — clean; `npm run lint` — clean.

## Observed results (2026-09-27)

One coherent work unit, committed as `b975041` and pushed to `origin/feat/manage-booking-ui`:

- Kept the in-progress `--danger-bg` / `--danger-fg` tokens (`#a8432f` light, `#b04a36` dark, white text) after verifying the commented ratios computationally: light 5.98:1, dark 5.41:1 — both >= 4.5:1, both clearly red.
- Lookup-modal parity is a `.modal-panel`-scoped rule only; the booking-form action row keeps its existing sizing.
- Cancelled view renders `Reservar otro turno` plus the unconditional `.manage-exit` `Volver al inicio` (`/`).
- E2E spec now matches the current UI (`.manage-booking .recap`, `Sí, cancelar`, `.note-box` cancelled copy) and asserts modal size equality plus destructive contrast in both themes, including two backend-independent tests.
- Focused unit command `npx vitest run components/booking/ManageBooking.test.tsx components/booking/ManageBookingLookup.test.tsx` passed 19/19; this result was independently repeated by the parent.
- Full `npm test` passed: 17 files, 128 tests.
- `npm run typecheck` passed (`tsc --noEmit`); `npm run lint` passed (`eslint .`).
- GitHub issue scan found only approved issue #7, which is unrelated; the PR remains blocked until a relevant approved issue is identified or approved.
- Blocker: `npm run test:e2e` was not run in this checkout — it has no env files and no production build, and the shared edge runtime's bind source is unavailable on this host. No remote fallback was used.

## Delivery decision

- `origin/main...HEAD` is 836 changed lines after this work; default delivery strategy is `ask-on-risk`.
- On 2026-09-27, the owner explicitly accepted one PR with `size:exception` for the accumulated branch. No chained-PR strategy is needed for this route.
- Repo PR policy: every PR requires a relevant approved issue and exactly one `type:*` label. The only approved issue found (#7) is unrelated, so the push is complete but PR creation remains blocked until a relevant approved issue is available.

## Next step

The implementation commit is pushed. Supply a relevant approved issue before the PR can be created; local Playwright E2E is also still blocked by missing build/environment prerequisites.

## Rationale

The modal parity, destructive-action contrast, cancelled-state exit and their selectors form one coherent manage/cancel journey. The only behavior addition is a home link; booking and cancellation semantics remain untouched.
