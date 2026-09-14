import { defineConfig, devices } from '@playwright/test';

const PUBLIC_SUPABASE_URL = 'https://vcgyiyrboumimwgdsitf.supabase.co';
const PUBLIC_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZjZ3lpeXJib3VtaW13Z2RzaXRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyMjY3MTMsImV4cCI6MjEwMjgwMjcxM30.fkvg_r4Cggv3v3v1tIV2WdXkd4LjD2cXXvyzITB5zC4';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4321',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4321/b/conexion-barberia',
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
    env: {
      PUBLIC_SUPABASE_URL,
      PUBLIC_SUPABASE_ANON_KEY,
    },
  },
});
