# Archive Report — web-publica-reservas

**Schema**: gentle-ai.sdd-archive-report/v1
**Change**: web-publica-reservas
**Archived to**: `openspec/changes/archive/2026-09-14-web-publica-reservas/`
**Archive date**: 2026-09-14
**Artifact store**: openspec (native status) + Engram mirror `sdd/web-publica-reservas/archive-report` (hybrid per session preflight)
**Action context**: repo-local; allowed edit root `/home/mauro/conexion-demo`

## Archive Readiness

Refreshed native status (`gentle-ai sdd-status web-publica-reservas --cwd /home/mauro/conexion-demo --json`) reported:

- `artifactStore`: `openspec`
- artifacts: proposal `done`, specs `done`, design `done`, tasks `done`, applyProgress `done`, verifyReport `done`
- `taskProgress`: 8/8 complete, 0 pending, `allComplete: true`
- `dependencies.archive`: `ready`
- `nextRecommended`: `archive`

Archive proceeded under the strict policy: Task Completion Gate passed and verification is non-CRITICAL.

## Task Completion Gate

Persisted `tasks.md` inspected before sync/move:

- Unchecked implementation tasks: **0**
- Checked implementation tasks: **8** (1.1, 1.2, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3)
- No exceptional stale-checkbox reconciliation was required.
- The archived `tasks.md` retains 0 unchecked / 8 checked.

## Final-State Facts (post-snapshot, authoritative)

Sources ranked per the Final-State Authority hierarchy. The launch prompt carries explicit final-state facts that outrank the intermediate `verify-report`/`apply-progress` snapshots:

- PR3 was split after a native budget block into stacked local commits:
  - `fb28273` — foundation/dependencies/interactions; carries the maintainer-approved size exception because generated `package-lock.json` adds 986 lines.
  - `fd832ca` — profile/catalog/404/runtime fallback/Playwright smoke.
  - `cbb642e` — documentation recording the split boundaries (docs only).
- All 8 tasks are checked in the persisted tasks artifact.
- Final test evidence (highest-ranked sources): `npm test` 11 passed, `npm run check` clean, `npm run build` passed, `npx playwright test` 4 passed.

No unrankable contradiction was found between the launch prompt, native status, and repository evidence. Where the snapshots below state warnings, those warnings remain current and are recorded verbatim — they were not superseded by later work.

## Verification (intermediate snapshot, attributed)

Per `verify-report.md` (`evidence_revision: sha256:7d4a52e2...`, written 2026-09-14 13:56, at verification time):

- Verdict: `pass_with_warnings`
- Requirements: 8/8
- Scenarios: 10/10
- Blockers: 0
- Critical findings: 0
- `npm test`: exit 0 (11 passed / 3 files)
- `npm run check`: 0 errors / 0 warnings / 0 hints
- `npm run build`: exit 0
- `npx playwright test`: 4 passed

### Carried-forward warnings (non-critical, current)

1. Playwright E2E is non-hermetic: `playwright.config.ts` and `tests/e2e/profile.spec.ts` target the live Supabase project `vcgyiyrboumimwgdsitf` with a hardcoded anon key and depend on the seeded `conexion-barberia` slug. Repeatability risk; the design explicitly accepted it.
2. Three DB security-boundary scenarios (duplicate-slug uniqueness, anonymous direct-table denial, DB-authoritative `durationMinutes`) are documented runtime probes rather than repeatable automated regressions. A future migration dropping the unique index or `REVOKE` grants would not be caught by `npm test` or Playwright.

Suggestions (non-blocking) are preserved in the archived `verify-report.md`.

The final-state facts did not alter warning #1 or #2; no warning was fixed after verification.

## Specs Synced

Main spec directory (`openspec/specs/`) did not exist, so each delta spec was treated as a full spec (`## Requirements`, no `ADDED/MODIFIED/REMOVED/RENAMED` delta sections) and copied mechanically. `sdd-archive-compose` was not required because no canonical spec existed to compose into.

| Domain | Action | Details |
|--------|--------|---------|
| public-barber-selector | Created | 1 requirement (new full spec) |
| public-context-read | Created | 3 requirements (new full spec) |
| public-service-catalog-read | Created | 2 requirements (new full spec) |
| public-theme-switch | Created | 1 requirement (new full spec) |
| web-app-scaffold | Created | 1 requirement (new full spec) |

Source of truth now at: `openspec/specs/{domain}/spec.md` for all five domains.

## Mechanical Copy Evidence (verbatim, empty = pass)

### Step 2 — delta spec → main spec readbacks

Command per domain: `diff -r "openspec/changes/web-publica-reservas/specs/{domain}/spec.md" "<mktemp temp>"`

```text
--- diff -r openspec/changes/web-publica-reservas/specs/public-barber-selector/spec.md openspec/specs/public-barber-selector/.spec.md.mk0vs9 (empty = pass) ---
--- end diff public-barber-selector ---
--- diff -r openspec/changes/web-publica-reservas/specs/public-context-read/spec.md openspec/specs/public-context-read/.spec.md.4ApbQ1 (empty = pass) ---
--- end diff public-context-read ---
--- diff -r openspec/changes/web-publica-reservas/specs/public-service-catalog-read/spec.md openspec/specs/public-service-catalog-read/.spec.md.e4cxb2 (empty = pass) ---
--- end diff public-service-catalog-read ---
--- diff -r openspec/changes/web-publica-reservas/specs/public-theme-switch/spec.md openspec/specs/public-theme-switch/.spec.md.9Jc4bt (empty = pass) ---
--- end diff public-theme-switch ---
--- diff -r openspec/changes/web-publica-reservas/specs/web-app-scaffold/spec.md openspec/specs/web-app-scaffold/.spec.md.dG6tlW (empty = pass) ---
--- end diff web-app-scaffold ---
```

### Step 3 — archive move readback

`git mv openspec/changes/web-publica-reservas openspec/changes/archive/2026-09-14-web-publica-reservas`, then `diff -r` against the pre-move recursive snapshot:

```text
--- diff -r snapshot vs archived (empty = pass) ---
--- end diff ---
```

Both readbacks produced no output (empty diff). No truncation or alteration detected.

## Archive Contents

- `proposal.md` ✅
- `specs/` ✅ (5 domains)
- `design.md` ✅
- `tasks.md` ✅ (8/8 complete, 0 unchecked)
- `apply-progress.md` ✅
- `verify-report.md` ✅
- `exploration.md` ✅ (carried)
- `db-baseline.md` ✅ (carried)
- Main specs updated: `openspec/specs/{domain}/spec.md` × 5

## SDD Cycle Complete

The change was proposed, specified, designed, implemented across four stacked commits, independently verified (`pass_with_warnings`), and archived. The active changes directory no longer contains `web-publica-reservas`. The two non-critical repeatability warnings remain open as documented follow-ups and do not block closure.
