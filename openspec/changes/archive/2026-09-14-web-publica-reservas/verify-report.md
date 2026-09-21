```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:7d4a52e2dfeeed939861919a0988fea7ca7241df7c6569dae79210a5a79339ff
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 8/8
scenarios: 10/10
test_command: npm test
test_exit_code: 0
test_output_hash: sha256:1dbd8528cfbb2fcc05ee47dd1aa573b720c077cf940a4bf3fce04e98ef24e872
build_command: npm run build
build_exit_code: 0
build_output_hash: sha256:d6d1c87fb488b6ac434b5eb0c6a040ea0b15cb6df11de33080a31705e517c535
```

## Verification Report

**Change**: web-publica-reservas
**Version**: N/A
**Mode**: Standard

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 8 |
| Tasks complete | 8 |
| Tasks incomplete | 0 |

All eight implementation tasks (1.1, 1.2, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3) are checked `[x]` in `tasks.md`. PR 1/2/3A/3B slices are all delivered as stacked local commits on top of `main` (`10ba175`).

### Build & Tests Execution

**Build**: ✅ Passed
```text
$ npm run build
> astro build
output: "server"
adapter: @astrojs/node
Server built in 1.86s
Complete!                        (exit 0)
```

**Typecheck**: ✅ Passed
```text
$ npm run check
> astro check
Result (14 files):
- 0 errors
- 0 warnings
- 0 hints                          (exit 0)
```

**Tests**: ✅ 11 passed / ❌ 0 failed / ⚠️ 0 skipped
```text
$ npm test
> vitest run
✓ src/lib/public-api.server.test.ts (5 tests)
✓ src/components/ThemeSwitch.test.tsx (3 tests)
✓ src/components/ProfessionalSelector.test.tsx (3 tests)
Test Files  3 passed (3)
     Tests  11 passed (11)          (exit 0)
```

**E2E**: ✅ 4 passed
```text
$ npx playwright test
✓ renders profile and catalog from DTOs with no internal IDs
✓ professional selector is data-driven and selectable
✓ theme switch toggles light and dark
✓ returns 404 for unknown slugs
4 passed (7.1s)                     (exit 0)
```

**Coverage**: ➖ Not available (no coverage command configured)

### Spec Compliance Matrix

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Scaffold, public route, and verification | Build and typecheck pass | `npm run check` + `npm run build` | ✅ COMPLIANT |
| Unique public identifier and non-enumeration | Duplicate slug rejected | `phase9_public_barberia_discovery.sql` unique index + PR1 runtime SQL probe | ✅ COMPLIANT |
| Unique public identifier and non-enumeration | Unknown versus unpublished | `public-api.server.test.ts` (identical error) + RPC not-found body + PR1 live probe | ✅ COMPLIANT |
| Context DTO | Exact field set | `public-api.server.test.ts` (deep-equal DTO) + `tests/e2e/profile.spec.ts` (no internal IDs) | ✅ COMPLIANT |
| Edge Function/RPC-only read boundary | Anonymous direct-table probe | migration `REVOKE` + PR2 live probe (HTTP 401 / 42501) | ✅ COMPLIANT |
| Catalog DTO | Exact field set | `public-api.server.test.ts` (numeric duration/price) | ✅ COMPLIANT |
| DB-authoritative resolution | Duration comes from the database | RPC `to_jsonb(s.duracion)` + PR1 live probe (numeric) | ✅ COMPLIANT |
| Selector rendered from the barbers list | Single barber today | `ProfessionalSelector.test.tsx` + `profile.spec.ts` | ✅ COMPLIANT |
| Selector rendered from the barbers list | Data-only expansion | `ProfessionalSelector.test.tsx` (two-barber data-driven) | ✅ COMPLIANT |
| Theme switch | Toggle swaps theme | `ThemeSwitch.test.tsx` + `profile.spec.ts` (light↔dark) | ✅ COMPLIANT |

**Compliance summary**: 10/10 scenarios compliant

### Correctness (Static Evidence)

| Requirement | Status | Notes |
|------------|--------|-------|
| Scaffold, public route, and verification | ✅ Implemented | Astro SSR `output: server` + Node adapter + React islands; `/b/[slug]` renders from DTOs only (no hardcoded data). |
| Unique public identifier and non-enumeration | ✅ Implemented | `public_slug` unique index; RPC returns byte-identical `PUBLIC_RESOURCE_NOT_FOUND` for unknown and unpublished. |
| Context DTO | ✅ Implemented | `public_context` returns `{barberia:{name,description}, barbers:[{name,alias,description,photoUrl}]}`; no internal ids, no `publicToken`. |
| Edge Function/RPC-only read boundary | ✅ Implemented | `SECURITY INVOKER` RPCs with `REVOKE` from anon/authenticated and `GRANT` to `service_role` only; Edge Functions use service_role. |
| Catalog DTO | ✅ Implemented | `public_catalog` returns `{services:[{name,durationMinutes,price}]}`; no ids. |
| DB-authoritative resolution | ✅ Implemented | `durationMinutes` = `to_jsonb(s.duracion)`; joins `Barberia → Barbero (activo) → Servicio`; no dedup. |
| Selector rendered from the barbers list | ✅ Implemented | `ProfessionalSelector` maps the `barbers` DTO; renders 0/1/N entries with no hardcoded names. |
| Theme switch | ✅ Implemented | `:root` / `:root[data-theme="dark"]` token swap matches both prototypes; Playfair↔Oswald heading swap; pre-paint inline script prevents FOUC. |

### Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| Migration home in this repo | ✅ Yes | `supabase/migrations/phase9_public_barberia_discovery.sql` + paired rollback present. |
| service_role-only RPC boundary | ✅ Yes | `SECURITY INVOKER`, `REVOKE ... FROM anon, authenticated`, `GRANT ... TO service_role`. |
| Nullable description → "" | ✅ Yes | RPC maps `coalesce(b.description, '')`. |
| Slug unique + publicado gate | ✅ Yes | Unique index on `public_slug`; reads require `publicado = true`. |
| Catalog join, no dedup | ✅ Yes | `Barberia → Barbero(activo) → Servicio`, no `barberia_id`, no dedup. |
| Astro SSR + 2 hydrated islands | ✅ Yes | `ProfessionalSelector.tsx` and `ThemeSwitch.tsx` are the only `client:load` islands; profile/catalog stay HTML. |
| Theme token/font swap | ✅ Yes | Tokens verified identical to prototypes (light `--paper:#FFFFFF`, dark `--paper:#1C1C1D`; Playfair ↔ Oswald). |
| CORS allow-list + security headers | ✅ Yes | `PUBLIC_SITE_ORIGIN` + `localhost:4321`; CSP/Referrer-Policy/X-Content-Type-Options/Permissions-Policy; no wildcard, no credentials. |

**Split boundary accuracy**: ✅ Verified. PR 3A (`fb28273`) = UI foundation/dependencies/selector/theme; PR 3B (`fd832ca`) = profile/layout/catalog/404/runtime-env-fallback/Playwright; `cbb642e` = docs only. The `package-lock.json` claim is exact: `fb28273` adds 986 lines (7311 → 8297) from the new dev deps, matching the maintainer-accepted size exception. Boundary text in `tasks.md` and `apply-progress.md` matches the actual commit contents.

### Issues Found

**CRITICAL**: None

**WARNING**:
- Playwright E2E is non-hermetic: `playwright.config.ts` and `tests/e2e/profile.spec.ts` target the live production project `vcgyiyrboumimwgdsitf` with a hardcoded anon key and depend on the seeded `conexion-barberia` slug. Tests will fail in a clean/offline CI or after the seed is removed. The design explicitly accepted this ("no non-production branch exists"), but it remains a repeatability risk.
- Three DB-boundary scenarios — duplicate-slug uniqueness, anonymous direct-table denial, and DB-authoritative `durationMinutes` — have no repeatable automated regression test in the repo. They are enforced by the migration (unique index, `REVOKE`) and were runtime-verified once via Supabase probes in PR 1/PR 2, but a future migration dropping the index or grants would not be caught by `npm test` or Playwright.

**SUGGESTION**:
- The publishable anon key and project URL are duplicated across `playwright.config.ts` and `tests/e2e/profile.spec.ts`; centralize in one place to avoid drift (not a secret leak — anon keys are public by design).
- `public-api.server.test.ts` "unknown versus unpublished" mocks a server that always returns 404, so it proves only client-side parity. Server-side parity is real (RPC returns the identical body) but could be asserted with a server-level test.

### Verdict

PASS WITH WARNINGS

All 8 requirements and 10 scenarios are compliant; `npm test`, `npm run check`, `npm run build`, and `npx playwright test` all exit 0. Two warnings concern test repeatability (live-project-dependent E2E and no automated regression tests for the DB security boundary), not correctness.
