# Archive Report — public-availability

**Verdict: archived, `pass_with_warnings`.** The change is complete and verified at close: 20/20 tasks complete, `verify = all_done`, 0 blockers, 0 CRITICAL findings. Candidate commit `664e1c0` (`docs(sdd): refresh the verification report for the current candidate`). Nothing was pushed; no upstream exists.

## Quick path

1. Canonical specs now carry the change: `public-availability-read` created; `public-barber-selector`, `public-service-catalog-read`, `web-app-scaffold` updated via `gentle-ai sdd-archive-compose`.
2. What is proven: 27 of 29 spec scenarios fully; 2 partial are documented deferrals (D8 token rotation, two-barber fixture), not defects.
3. What remains open: deferred entries D2, D4, D6, D8, D9; preconditions P1–P8; production undeployed (migrations `phase11`/`phase12` and the Edge function not live).

## Evidence at close (final state, not the snapshots)

These numbers supersede the intermediate `apply-progress` (observation 374) and earlier verify snapshots. The refreshed `verify-report.md` re-ran the full suite against the current candidate.

| Suite | Result |
|---|---|
| Vitest (`npm test`) | 9 files / **61** tests pass |
| pgTAP (`npm run test:db`) | **79** assertions, PASS |
| Edge HTTP (`npm run test:edge`, repo-bound) | **28** checks / 0 failed |
| Playwright (`npm run test:e2e`) | **12** tests pass |
| `typecheck`, `lint`, `build` | all exit 0 |

Verify verdict: `pass_with_warnings` — 8/8 requirements, 29/29 scenarios with a passing covering test (27 fully COMPLIANT, 2 PARTIAL). Warnings: W1 (`tsconfig.json` excludes `supabase/**`, no `tsc` gate on the token module/Edge function) and W2 (committed `test:e2e` not self-binding to the repo's Edge files, D9).

## Work completed after the apply-progress snapshot

1. Task 4.1 corrected: shared token module (`supabase/functions/_shared/availability-token.ts`) holds signer + verifier (rejects at or past `exp`, 5 s pre-`iat` skew, constant-time compare); Edge imports it; named expiry case proven.
2. Task 4.3 corrected after an independent verifier showed the result was not reproducible: render gate against false privacy-leak reports, SQL no-mutation probe, `/_next/static` bundle scan, missing not-found body assertion. The flake never reproduced in 10 runs; the per-slot HMAC key import was memoized with measured justification.
3. Phase 5: four pinned semantics explicit in the delta specs with proving artefacts; `deferred-coverage.md` records unproven cases.
4. Post-verify closure: `scripts/edge-test.sh` + `npm run test:edge` prove `no-store` and every stable error branch over real HTTP; lead-time proof non-vacuous; shop-NULL response shape asserted; token documented as **signed, not encrypted**.
5. Lead-time fixture fixed after a real defect (window wrapped past midnight both directions): boundaries clamped to the local day, expected grid steps derived from the same anchors, 48-clock whole-day sweep, last 60 minutes before local midnight an explicit `skip` with reason.
6. `scripts/edge-test.sh` made repo-bound (serves this repo's `supabase/functions`); proven by mutation (removing `no-store` fails 7/28).
7. Verify report re-run and refreshed for the current candidate.

## Specs synced

| Domain | Action | Details |
|---|---|---|
| `public-availability-read` | Created | Full spec copied mechanically (new capability: contract, window, occupancy, tokens) |
| `public-barber-selector` | Updated | Landing selector-free; single "Cualquier profesional" affordance on `/reservar`; no per-barber resolution |
| `public-service-catalog-read` | Updated | Five-field tokenized DTO; DB-authoritative resolution; NULL-duration 200-empty-days |
| `web-app-scaffold` | Updated | Real `/reservar` route; active catalog CTA; awaited `searchParams`; not-found for `/` and `/reservar` |

Deliberately unchanged: `public-context-read` and `public-theme-switch` — the change touches neither. `verify-report.md` and `deferred-coverage.md` were not edited (no entry became newly proven during archive). Partially proven requirements were synced as requirements with their limitations carried here and in `deferred-coverage.md`, not silently dropped: two-barber "Data-only expansion" (PARTIAL, S4) and token re-read "Server-side token resolution" (PARTIAL, D8/S3).

## Remaining limitations (carried, not hidden)

- Open deferred entries: D2 (live-data occupancy/blocks), D4 (intersection with differing values), D6 (Fase 3 lead-time, out of scope), D8 (token rotation), D9 (E2E still bound to the scratch stack's Edge copy — evidence gap for that suite only). Closed: D1, D3, D5, D7.
- Preconditions P1–P8 hold for any re-run (stack up, `sg docker`, `.env.local` keys, prior build, published shop with future slots, `EDGE_TEST_PROJECT_ID=conexion-db`, Edge must be served after `test:edge` stops it).
- `tsconfig.json` excludes `supabase/**`: token module and Edge function have no `tsc` gate (W1).
- Production undeployed: `phase11`, `phase12`, Edge function not live; E2E targets the local stack (S5).

## Commits on the local branch

Stacked, nothing pushed, no upstream: `18e2218` test(web) · `fb8b644` docs(sdd) · `af9bbd1` feat(web) · `0015a4e` feat(web) · `8623625` refactor(web) · `ada43ad` docs(sdd) · `65588b0` feat(edge) · `0fb560e` docs(sdd) · `d7995ee` refactor(db) · `d62a0a7` feat(db) · `16c4bf5` docs(sdd) · `8bf8b19` chore · `b3d74ef` test(db) · `57b994f` test(edge) · `5a79e06` test(e2e) · `c58bb04` test(edge) · `06a08b2` docs(sdd) · `08a7f0c` test(db) · `5e6b164` test(edge) · `664e1c0` docs(sdd). Note: history contains `d62a0a7`, whose files `d7995ee` later removed, so a clean squash requires rewriting history.

## Checklist

- [ ] `tasks.md` shows 20/20 checked; no stale unchecked implementation tasks
- [ ] `verify-report.md` verdict `pass_with_warnings`, 0 blockers, 0 CRITICAL
- [ ] Canonical specs composed via `sdd-archive-compose` (3 updates) + mechanical copy (1 new)
- [ ] Archive artefacts left in the working tree; orchestrator commits (no `git mv`/archive move performed here — `git` operations were forbidden for this phase)
- [ ] Engram observations read: 367, 368, 372, 373, 374, 375, 376, 384, 386, 397, 400, 404

## Next step

Orchestrator commits the working tree (canonical specs + this report), then proceeds to delivery/merge of `feat/public-availability`.
