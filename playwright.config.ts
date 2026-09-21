import { defineConfig, devices } from '@playwright/test';

// Load the gitignored local environment so credentials and the configured slug
// are never embedded in this file. CI supplies real environment variables.
if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile('.env');
  } catch {
    // .env is optional.
  }
}

const LANDING_PORT = 3000;
const NOT_FOUND_PORT = 3100;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'landing',
      testMatch: /profile\.spec\.ts/,
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
      command: `npm run dev -- --port ${LANDING_PORT}`,
      url: `http://localhost:${LANDING_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
    {
      // Unknown configured slug: exercises the not-found boundary. Readiness
      // polls a static public asset because every app route returns 404 here.
      command: `npm run dev -- --port ${NOT_FOUND_PORT}`,
      url: `http://localhost:${NOT_FOUND_PORT}/cover.jpg`,
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
      env: {
        BARBERSHOP_PUBLIC_SLUG: 'zz-unknown-slug',
        PUBLIC_SITE_ORIGIN: `http://localhost:${NOT_FOUND_PORT}`,
        NEXT_DIST_DIR: '.next-unknown-slug',
      },
    },
  ],
});
