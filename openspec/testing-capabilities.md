# Testing Capabilities — SDD Initialization (conexion-demo)

**Discovered Projects:**
- conexion-demo

**Stack:**
- Astro SSR (`@astrojs/node`, standalone) + React 18 islands
- TypeScript (strict, via `astro/tsconfigs/strict`)
- Supabase Edge Functions (Deno)
- PostgreSQL + RLS

**Automated Test Runner:** Vitest (unit/integration) and Playwright (E2E)

**Detected:** 2026-09-21 (re-detection; supersedes the 2026-09-11 greenfield result)

**Strict TDD:** false

## Detected Commands

| Layer | Command | Scripted? | Observed result |
| ----- | ------- | --------- | --------------- |
| Unit + integration | `npm test` (`vitest run`) | Yes (`package.json` `test` script) | 2 files, 8 tests passed, exit 0 |
| E2E | `npx playwright test` | No npm script | 4 tests passed, exit 0 (Chromium) |
| Type check | `npm run check` (`astro check`) | Yes | 12 files, 0 errors / 0 warnings / 0 hints, exit 0 |

## Test Layers

| Relative path | Layer       | Available | Tool |
| ------------- | ----------- | --------- | ---- |
| `.` | Unit        | ✅ | Vitest 2 (jsdom, globals, `vitest.setup.ts`) |
| `.` | Integration | ✅ | Vitest 2 + `@testing-library/react` + Node `http` mock server |
| `.` | E2E         | ✅ | Playwright (Chromium, `tests/e2e`, `http://localhost:4321`) |

Existing test files:
- `src/components/ThemeSwitch.test.tsx` — 3 tests (theme bootstrap and toggle persistence)
- `src/lib/public-api.server.test.ts` — 5 tests (DTO shape, Edge Function path, error parity, slug validation)
- `tests/e2e/profile.spec.ts` — 4 tests (profile render, DTO-only output, no booking controls, theme toggle, 404)

## Coverage

| Relative path | Available | Command |
| ------------- | --------- | ------- |
| `.` | ❌ | — (no `@vitest/coverage-v8` / `@vitest/coverage-istanbul` installed, no coverage script) |

Coverage cannot be measured or gated in the current state. Actual coverage is partial: the public API client and `ThemeSwitch` are tested; the Supabase Edge Functions (`supabase/functions/public-context`, `supabase/functions/public-catalog`, `supabase/functions/_shared/*`) and the Astro pages/layouts have no tests.

## Quality Tools

| Relative path | Tool         | Available | Command |
| ------------- | ------------ | --------- | ------- |
| `.` | Linter       | ❌ | — (no ESLint/Biome dependency, config, or script) |
| `.` | Type checker | ✅ | `npm run check` (`astro check`) |
| `.` | Formatter    | ❌ | — (Prettier is present only as a transitive binary; not a declared dependency, no config, no script) |

## CI

No CI workflow exists (`.github/`, `.gitlab-ci.yml`, `.circleci/` are all absent). Nothing runs the suite automatically on changes.

## Configuration References

- `vitest.config.ts` — jsdom environment, globals enabled, `include: ['src/**/*.{test,spec}.{ts,tsx}']`, setup `./vitest.setup.ts`, alias `~` → `./src`.
- `vitest.setup.ts` — loads `@testing-library/jest-dom/vitest` and stubs `window.matchMedia`.
- `playwright.config.ts` — Chromium project, `testDir: './tests/e2e'`, `baseURL: http://localhost:4321`, `webServer` runs `npm run preview` (requires a prior build). The E2E suite calls a live remote Supabase project using the URL and anon key embedded in this config.

## Explanation

This project is no longer greenfield. When SDD init first ran on 2026-09-11 there was no `package.json`, no test runner, and no CI, so `has_tests: false` and `test_command: null` were accurate. Today Vitest and Playwright are installed, configured, and green (8 unit/integration tests and 4 E2E tests, all passing), and `astro check` reports zero diagnostics.

`strict_tdd` remains false, on evidence rather than inertia:

1. **No complete workspace-level command.** `npm test` runs Vitest only, over `src/**`. The Playwright suite lives outside that include and has no npm script, so no single command from the repo root covers the full in-scope test set.
2. **Coverage is partial and unmeasured.** The Edge Function boundary and the Astro pages/layouts are untested, and no coverage provider is installed, so coverage cannot be quantified or enforced.
3. **No CI enforcement.** Nothing runs tests on change; a strict TDD gate would be self-reported only.
4. **A Next.js migration is the next change.** Most current tests are Astro-coupled (page routes, `astro check`, the `~` alias); enforcing strict TDD now would lock in tests scheduled for replacement.

This is a reversible call. Once the E2E command is scripted (for example `test:e2e`), a coverage provider is added, and CI runs the suite, the runner set becomes strong enough to justify raising `strict_tdd` to true.
