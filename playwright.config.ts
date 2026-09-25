import fs from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// Load the gitignored environment the same way Next does, so the E2E suite
// targets the local scratch stack that actually carries this change. Precedence
// matters: `process.loadEnvFile` never overwrites an existing key, so loading
// `.env.local` first makes it win over `.env` (Next's own `.env.local > .env`
// order). CI supplies real environment variables and both files are optional.
// Credentials are never embedded in this file.
for (const file of ['.env.local', '.env']) {
  if (typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile(file);
    } catch {
      // Optional file.
    }
  }
}

// The suite exercises the production build, not the dev server
// (design.md: "`npm run build` first, then `npx playwright test`"). Fail loudly
// when no build exists instead of silently running against `next dev`, because
// the private-configuration check inspects the real production bundles.
if (!fs.existsSync('.next/BUILD_ID')) {
  throw new Error(
    'Playwright requires a production build. Run `npm run build` before `npm run test:e2e`.'
  );
}

const LANDING_PORT = 3000;
const NOT_FOUND_PORT = 3100;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // The suite drives one shared, mutable scratch database, and
  // `public-availability.spec.ts` asserts the reservation tables are untouched
  // while it runs. Serial is the only isolation that holds: a parallel worker
  // that books a slot (the cancellation flow) breaks that invariant. CI already
  // forced this; local now matches.
  workers: 1,
  reporter: 'list',
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'landing',
      testMatch: [
        /profile\.spec\.ts/,
        /public-availability\.spec\.ts/,
        /public-cancellation\.spec\.ts/,
      ],
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${LANDING_PORT}` },
    },
    {
      name: 'not-found',
      testMatch: /not-found\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${NOT_FOUND_PORT}` },
    },
  ],
  webServer: [
    {
      // Production server over the shared `.next` build. The catalog, booking
      // route, and slot flow all resolve against the local scratch stack from
      // the environment loaded above.
      command: `npm run start -- --port ${LANDING_PORT}`,
      url: `http://localhost:${LANDING_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
    {
      // Unknown configured slug: exercises the not-found boundary for both `/`
      // and `/reservar`. It reads the same production build as the landing
      // server on purpose: the configured slug comes from the runtime
      // environment and is never baked into the build, so a second
      // `NEXT_DIST_DIR` would only buy a second, byte-identical build. Unlike
      // `next dev`, `next start` never rebuilds; the only thing it writes under
      // `.next` is the shared fetch cache (`cache/fetch-cache`), which Next
      // designs to be shared across instances and which both servers benefit
      // from. Readiness polls a static public asset because every app route
      // returns 404 here.
      command: `npm run start -- --port ${NOT_FOUND_PORT}`,
      url: `http://localhost:${NOT_FOUND_PORT}/cover.jpg`,
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
      env: {
        BARBERSHOP_PUBLIC_SLUG: 'zz-unknown-slug',
        PUBLIC_SITE_ORIGIN: `http://localhost:${NOT_FOUND_PORT}`,
      },
    },
  ],
});
