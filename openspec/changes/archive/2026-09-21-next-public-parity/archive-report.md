# Archive Report — next-public-parity

**Schema**: gentle-ai.sdd-archive-report/v1
**Change**: next-public-parity
**Archived to**: `openspec/changes/archive/2026-09-21-next-public-parity/`
**Archive date**: 2026-09-21
**Artifact store**: openspec (native status) + Engram mirror `sdd/next-public-parity/archive-report` (hybrid per session preflight)
**Action context**: repo-local; allowed edit root `/home/mauro/conexion-demo`
**Review budget note**: delivery context carries a maintainer-approved `size:exception` for a single PR; the 400-changed-line review budget does not apply to this phase.

## Archive Readiness

Structured status was superseded by the orchestrator launch prompt, which carries explicit final-state facts and directs archive. The Task Completion Gate below passed and the final verification verdict is non-CRITICAL, so archive proceeded under the strict policy.

## Task Completion Gate

Persisted `tasks.md` inspected before sync/move:

- Unchecked implementation tasks: **0**
- Checked implementation tasks: **15** (1.1–1.4, 2.1–2.4, 3.1–3.4, 4.1–4.3)
- No stale-checkbox reconciliation was required.
- The archived `tasks.md` retains 0 unchecked / 15 checked.

## Final-State Facts (post-snapshot, authoritative)

Sources ranked per the Final-State Authority hierarchy. The orchestrator launch prompt carries explicit final-state facts that outrank the intermediate `apply-progress.md` snapshot. Where the snapshots below state earlier claims, the facts here describe the state AT CLOSE.

1. **Verification FAILED once, then PASSED.** The first `sdd-verify` run returned FAIL with 1 CRITICAL: `npm run lint` exited 1 with 5030 findings, all generated output under `.next-unknown-slug/`, because `eslint.config.mjs` ignored `.next/**` but not that directory. The command sequence was therefore order-dependent.
2. **The CRITICAL was fixed after `apply-progress.md` was written.** `eslint.config.mjs` now ignores `.next*/**` instead of `.next/**`. This fix is NOT recorded in `apply-progress.md`; this archive report is the artifact that carries it. `apply-progress.md` and `verify-report.md` were moved unmodified as historical record.
3. **The final verification verdict is PASS WITH WARNINGS**: 18/18 scenarios and 7/7 requirements compliant, 0 CRITICAL, 1 WARNING, 3 SUGGESTIONs. All five commands exit 0 when run in the previously-breaking order (`npx playwright test` first, then `npm run lint`), with `.next-unknown-slug/` present.
4. **Final observed command results** (highest-ranked source, at close):
   - `npx playwright test` — exit 0, 9 passed (2 projects)
   - `npm run lint` — exit 0, no output
   - `npm run typecheck` — exit 0, no output
   - `npm test` — exit 0, 5 files / 27 tests
   - `npm run build` — exit 0 (`ƒ /` dynamic, `○ /_not-found` static)
5. **Production database changed during this change.** `phase10_public_landing_details` was applied to the live Supabase project and the demo data was seeded, including a backfill of `Servicio.descripcion` for the four existing services (the seed's `NOT EXISTS` guard would not populate a newly added column). Before that, the live DTOs were still in the `phase9` shape and the landing's detail rows and service descriptions rendered empty. This resolves the BLOCKER recorded in `apply-progress.md` ("phase10 not applied"); that snapshot claim is stale and is superseded here.
6. **Nothing is committed.** The working tree is intentionally left uncommitted: 35 entries in `git status`, including deleted `src/**` and `astro.config.mjs`; modified `package.json` / `package-lock.json` / `tsconfig.json` / `vitest.config.ts` / `vitest.setup.ts` / `playwright.config.ts` / `.gitignore`; new `app/`, `components/`, `lib/`, `types/`, `eslint.config.mjs`, `next.config.ts`, `.env.example`, `next-env.d.ts`, `public/cover.jpg`, and new E2E specs. Commit and pull request are explicitly NOT part of this change's work.
7. **Open, non-blocking items** (current at close, carried from the final verification):
   - 1 WARNING: `next dev` auto-rewrites the tracked `tsconfig.json`, appending the second dist dir's types paths — largely inherent to Next.
   - 3 SUGGESTIONs: stale Astro env names remain in the local `.env`; E2E assertions are count-based rather than value-based; E2E depends on the live backend.
8. **Verification gap, stated honestly**: the slug-uniqueness constraint and the `anon` zero-table-grant posture were NOT re-probed against the live database in the final verification run (verify is read-only). They remain evidenced by the unchanged `phase9` migrations and prior archived probes, not by a fresh probe at close.

No unrankable contradiction was found between the launch prompt, the final `verify-report.md`, and repository evidence. Snapshot-derived claims below are attributed to their source and time.

## Verification (intermediate snapshot, attributed)

Per the final `verify-report.md` (evidence_revision `sha256:a7c9afdd...`, at verification time): verdict `pass_with_warnings`, 7/7 requirements, 18/18 scenarios, 0 blockers, 0 CRITICAL findings, with the five command results listed above. The WARNING and 3 SUGGESTIONs in that report remain current at close (see item 7 above) and were not superseded by later work.

Per `apply-progress.md` (written before the lint fix and before the production migration): its command table, file inventory, and design-deviation notes remain valid history; its "BLOCKER for full spec parity" section is SUPERSEDED by final-state fact 5 above, and its lint result predates final-state fact 2. Do not read that snapshot as current state.

## Specs Synced

All four delta specs were merged into existing canonical specs through the native `sdd-archive-compose` command (rename matched before modify, unrelated requirements preserved byte-for-byte). No canonical spec was edited by hand for requirement content.

| Domain | Action | Details |
|--------|--------|---------|
| web-app-scaffold | Updated (RENAMED + MODIFIED) | 1 requirement renamed and rewritten; 8 scenarios; Astro references removed |
| public-context-read | Updated (MODIFIED) | 3 requirements: server-only slug resolution at `/`, seven-field `barberia` + four-field barber DTO, Edge/RPC-only boundary kept |
| public-service-catalog-read | Updated (MODIFIED) | 2 requirements: four-field catalog DTO incl. nullable `description`, DB-authoritative resolution kept |
| public-barber-selector | Updated (MODIFIED) | 1 requirement: selector DEFERRED to Fase 2 booking flow; no selector on Fase 1 landing; `barbers[]` DTO field retained |

Source of truth now at: `openspec/specs/{domain}/spec.md` for all four domains. `public-theme-switch` was untouched by this change and was not synced.

### Delta-shape repair (recorded, native composition preserved)

The as-authored `web-app-scaffold` delta declared only a MODIFIED section under the new requirement name, so the first native compose run refused with: `unapplied MODIFIED delta for requirement "Next public scaffold, route, parity, and verification": no canonical requirement named "Next public scaffold, route, parity, and verification"` (canonical still held "Scaffold, public route, and verification"). The delta's `(Previously: ...)` note showed rename intent but no RENAMED section. Before composing, a single RENAMED section was prepended to the archived delta file:

- `### Requirement: Scaffold, public route, and verification → Next public scaffold, route, parity, and verification`
- `(Reason: Astro + /b/[slug] becomes Next.js 16 App Router + /; the previous name described the Astro scaffold and must no longer do so.)`

Every canonical-spec write thereafter still ran exclusively through `sdd-archive-compose` (zero exit each); no requirement body was merged by hand. The repaired delta travels with the archive, so the audit trail shows exactly what was composed.

### Purpose-line reconciliation (recorded, outside composer scope)

The native composer preserves non-requirement sections byte-for-byte and offers no Purpose mechanism (probed: a Purpose-only delta is rejected with `delta spec declares no ADDED, MODIFIED, REMOVED, or RENAMED requirements`). Two Purpose lines directly contradicted their newly composed requirements and the explicit orchestrator direction that the baseline must no longer name Astro, so they were corrected by direct edit — requirement bodies untouched:

- `web-app-scaffold` Purpose: "Bootstrapped Astro + React islands + TypeScript app and its verification surface (greenfield repo)." → "Next.js 16 App Router + React + TypeScript public landing at `/` and its verification surface."
- `public-barber-selector` Purpose: "Prototype-matching professional selector backed by the context DTO `barbers` list." → "Professional selector deferred to the Fase 2 booking flow; the Fase 1 landing renders no selector while the context DTO retains the `barbers` list."

`public-context-read` and `public-service-catalog-read` Purposes were already accurate and were left untouched.

## Mechanical Copy Evidence (verbatim, empty = pass)

### Step 2 — native composition invocations (zero exit = applied)

```text
gentle-ai sdd-archive-compose --canonical "openspec/specs/web-app-scaffold/spec.md" --delta "openspec/changes/next-public-parity/specs/web-app-scaffold/spec.md" --output "openspec/specs/web-app-scaffold/spec.md.compose-tmp" && mv "openspec/specs/web-app-scaffold/spec.md.compose-tmp" "openspec/specs/web-app-scaffold/spec.md"  → exit 0
gentle-ai sdd-archive-compose --canonical "openspec/specs/public-context-read/spec.md" --delta "openspec/changes/next-public-parity/specs/public-context-read/spec.md" --output "openspec/specs/public-context-read/spec.md.compose-tmp" && mv "openspec/specs/public-context-read/spec.md.compose-tmp" "openspec/specs/public-context-read/spec.md"  → exit 0
gentle-ai sdd-archive-compose --canonical "openspec/specs/public-service-catalog-read/spec.md" --delta "openspec/changes/next-public-parity/specs/public-service-catalog-read/spec.md" --output "openspec/specs/public-service-catalog-read/spec.md.compose-tmp" && mv "openspec/specs/public-service-catalog-read/spec.md.compose-tmp" "openspec/specs/public-service-catalog-read/spec.md"  → exit 0
gentle-ai sdd-archive-compose --canonical "openspec/specs/public-barber-selector/spec.md" --delta "openspec/changes/next-public-parity/specs/public-barber-selector/spec.md" --output "openspec/specs/public-barber-selector/spec.md.compose-tmp" && mv "openspec/specs/public-barber-selector/spec.md.compose-tmp" "openspec/specs/public-barber-selector/spec.md"  → exit 0
```

Each compose was verified by reading back the synced canonical spec: no Astro references remain in `web-app-scaffold`; the seven-field/four-field DTO contracts, Edge/RPC-only boundary, non-enumeration, DB-authoritative resolution, and Fase-2 selector deferral are present as the deltas specify.

### Step 3 — archive move readback

`git mv` refused with `fatal: source directory is empty` (the change directory is untracked in git), so the mechanical fallback ran: pre-move recursive snapshot via `cp -R` to a temp dir, plain `mv` of the source to the destination, then `diff -r` of snapshot vs. destination:

```text
--- diff -r snapshot vs archived (empty = pass) ---
--- end diff ---
```

The readback produced no output (empty diff). Source is gone from `openspec/changes/`; no truncation or alteration detected. This report file is additive-only and excluded from that comparison.

## Archive Contents

- `proposal.md` ✅
- `specs/` ✅ (4 domains)
- `design.md` ✅
- `tasks.md` ✅ (15/15 complete, 0 unchecked)
- `apply-progress.md` ✅ (historical; BLOCKER section superseded — see Final-State Facts)
- `verify-report.md` ✅ (final PASS WITH WARNINGS verdict)
- `exploration.md` ✅ (carried)
- Main specs updated: `openspec/specs/{web-app-scaffold,public-context-read,public-service-catalog-read,public-barber-selector}/spec.md`

## SDD Cycle Complete

The change was proposed, specified, designed, implemented in a single uncommitted PR surface (maintainer-approved `size:exception`), independently verified (`pass_with_warnings` after one FAIL→fix cycle), and archived. The active changes directory no longer contains `next-public-parity`. One WARNING and three SUGGESTIONs remain open as documented follow-ups, plus the honestly stated live-DB probe gap; none blocks closure. Commit and pull request remain explicitly out of scope for the next reader to arrange.
