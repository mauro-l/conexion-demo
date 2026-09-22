# Pre-Proposal State: public-ui-parity

schema: gentle-ai.sdd-preproposal/v1
revision: 1
change: public-ui-parity
artifact_store: openspec (repo-local) — mirrored to Engram

## Exploration

- outcome: done
- reference (OpenSpec): `openspec/changes/public-ui-parity/exploration.md`
- reference (Engram): topic `sdd/public-ui-parity/explore` — observation #410
- summary: 19 requirements grouped into 3 slices; no new fetch, DTO, RPC, or Edge change is needed.

## Research: UNSELECTED by owner decision (2026-09-22)

The lane was selected first and then explicitly deselected by the owner after it failed terminally.
Per the Research and Pre-Proposal Gate, unselected research skips only the research condition, so the
proposal may proceed on the confirmed decisions below.

History, retained for the record:

- request_id: `sdd-research/public-ui-parity/2026-09-22-001`
- revision: 1
- requested source classes: `documentation`, `open-web`
- questions:
  1. Accessible pattern for a horizontally scrolling date picker (roles and ARIA state for single selection, exposing disabled days, full keyboard operability, known pitfalls).
  2. Deterministic rendering of the 14-day strip to avoid hydration mismatch in Next.js App Router (`new Date()` drift, timezone/locale differences, safe label formatting).
  3. Accessible replacement for native `<details>/<summary>` when a custom chevron and full styling control are required.
- admission: **FAILED**
- observed runtime grants: `documentation = denied`, `open-web = denied`
- outcome: **blocked** — the lane never produced evidence. Two independent causes:
  1. `agent.sdd-research.model` was `opencode/muse-spark-1.3-contributor-free`. Every dispatch died with
     `Error from provider (Console): OpenCode's free tier can only be used from within OpenCode`
     (3 of 3 attempts, non-transient).
  2. The agent's runtime capability for both requested classes was denied by permission
     (`"webfetch": "deny"`, `"websearch": "deny"`), so even a successful run would have returned
     `blocked` with no claims.
- evidence references: none (no sources were collected)
- remediation applied (2026-09-22):
  - `model` -> `opencode-go/deepseek-v4-pro`
  - `webfetch` -> `allow`, `websearch` -> `allow`
  - backup: `~/.config/opencode/opencode.jsonc.bak-before-research-model`
  - OpenCode loads config once at startup and does NOT hot-reload it. A dispatch issued after the edit
    still failed with the free-tier error, confirming the running session kept the old config.
  - the agent block is `"__managed_by": "gentle-ai/sdd"`; a future `gentle-ai sync` may regenerate it
    and revert both fields.
- after the restart the model fix did take effect (`taskModel: opencode-go/deepseek-v4-pro` in the
  failure envelope), and the lane then failed terminally with `sdd_task_result_malformed`: the child
  output contained a task tag but did not match the anchored task-result envelope. That latched SDD
  dispatch for the session, so no further SDD phase can launch until the next restart.

## Product decisions: CONFIRMED

- E1 — The mockup governs structure, labels, and UI copy. Barber data (name, description, opening
  hours) comes from the database. Consequence: "Conexión Barbería" stays (renaming it is a data change,
  not a template change); the tagline keeps coming from `barberia.description`; the "Hoy " prefix
  returns as UI copy; the gold logo accent returns under the rule "last word in `--brass`".
- E2 — The rating row (`★★★★★ · 5.0 · 37 reseñas`) is EXCLUDED until a data source exists. No column
  and no DTO field carries it. Record as an explicit exclusion in the proposal.
- E3 — The step is the two-part interaction from the prototype: a horizontal scroller of 14 date cards
  with one selected and non-bookable days disabled, plus the chosen date's time slots grouped
  Morning / Afternoon / Evening.
- E4 — Buckets are derived client-side in the island. The data contract does not change.
- E5 — `--fill-strong` is promoted to a first-class token.
- Post-selection panel: keep the current honest copy (read-only dead end); do not restyle it toward the
  prototype's recap.

## Proposal readiness

proposal_ready: **true**

reason: research is unselected by owner decision, so the gate's research condition is skipped. Product
decisions are confirmed (E1-E5 above) and the artifact store is ready.

## Pipeline status (2026-09-22, post-restart session)

The three `next` items above are DONE. Recorded outcome of the resumed session:

- Session preflight re-collected (runtime-confirmed): pace `auto`, artifact store `hybrid`
  (repo-local OpenSpec + Engram mirror), delivery strategy `auto-chain`.
- Chain strategy, collected after the `sdd-tasks` forecast: **`stacked-to-main`**.
- `sdd-propose` -> `proposal.md` (Engram obs #414).
- `sdd-spec` -> delta specs for `public-availability-read` (6 requirements / 8 scenarios) and
  `public-theme-switch` (3 / 5), Engram obs #416. A first pass carried a misstated `MODIFIED`
  block on the token-contract requirement; it was removed in one corrective re-run so the
  canonical token scenarios cannot be dropped at archive.
- `sdd-design` -> `design.md`, Engram obs #418. Validated by a fresh-context contract validator:
  PASS, all 8 pinned decisions resolved, no unresolved paths, no scope drift.
- `sdd-tasks` -> `tasks.md`, 11 tasks in 3 slices, 9/9 requirement coverage, Engram obs #419.
  Review Workload Forecast: ~810 lines total, 400-line risk High, chained PRs Yes.
- `sdd-apply` slice 1 -> done and GREEN. Tasks 1.1-1.3 checked. ~350 changed lines.
  All five gates pass: `npm test` 66/66, `npm run typecheck`, `npm run lint`, `npm run build`,
  `npm run test:e2e` 12/12. Native attempt settled `passed` (state `complete`).

### Proven harness gotcha (cost a full verification cycle)

The apply phase first reported `partial` on a single e2e failure, and blamed a Turbopack chunk
resolution bug. That diagnosis was wrong. The real cause: the writer's own baseline experiment
(`git stash` + rebuild) left `.next` holding a **pre-slice-1 production build**, and
`playwright.config.ts` sets `reuseExistingServer: !CI`, so a stale `next start` process that had
been alive for 6,634 seconds kept serving the OLD page HTML while the on-disk chunks had already
been replaced. The privacy test then saw zero resolvable chunks and both `/reservar` tests failed.
Rebuilding after restoring the changes made the suite 12/12.

Rule for the remaining slices: after any `git stash` experiment or any change to `.next`, kill
stray `next-server` processes and rebuild before trusting an e2e result. Do not diagnose an e2e
failure from a reused server.

### Open at the time of writing

- Slices 2 and 3 are not implemented. Tasks 2.1-2.4 and 3.1-3.4 remain unchecked.
- Per-slice commits were authorized after slice 1 was verified, so the `stacked-to-main` chain can
  become real PRs. Nothing is pushed and no PR exists; those stay separate human decisions.
- `sdd-verify` runs only after every task is complete, so it is not yet reachable.

### Deferred findings from the slice-1 verification (not fixed on purpose)

The independent verifier raised three Low-severity items. They are deliberately NOT fixed now,
because slice 1's native attempt is already settled `passed` and mutating its source would drift
the recorded evidence revision and force an audited `sdd-attempt reset` before the next acquire.
They are cosmetic or semantic, so carrying them is cheaper than resetting the ledger.

- Dead CSS: `app/globals.css` groups `.availability-empty, .availability-day-empty`, but no
  component renders `availability-day-empty` any more — a leftover from the removed vertical list.
- `AvailabilityCalendar.tsx` attaches `onClick` to every date card, including disabled ones.
  Activation is blocked by the native `disabled` attribute plus `pointer-events: none`, so it is
  inert, but the design pin says "no activation handler" and the handler is still there.
- Date cards use `aria-pressed` as the selection indicator. `aria-pressed` is a toggle-button
  semantic; a single-select group is more faithfully a `radiogroup`/`radio` or `aria-current`.
  This one is tied to the unresolved accessibility research lane (picker roles, keyboard behavior,
  disabled semantics), so it should be settled together with that question, not guessed now.
