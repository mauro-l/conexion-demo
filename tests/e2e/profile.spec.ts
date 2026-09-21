import { test, expect } from '@playwright/test';

const PUBLIC_SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL ?? 'https://vcgyiyrboumimwgdsitf.supabase.co';
const PUBLIC_SUPABASE_ANON_KEY =
  process.env.PUBLIC_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZjZ3lpeXJib3VtaW13Z2RzaXRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyMjY3MTMsImV4cCI6MjEwMjgwMjcxM30.fkvg_r4Cggv3v3v1tIV2WdXkd4LjD2cXXvyzITB5zC4';

async function fetchJson(path: string) {
  const res = await fetch(`${PUBLIC_SUPABASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${PUBLIC_SUPABASE_ANON_KEY}` },
  });
  return { status: res.status, body: await res.json() };
}

test.describe('public barbershop profile page', () => {
  test('renders profile and catalog from DTOs with no internal IDs', async ({ page }) => {
    const [context, catalog] = await Promise.all([
      fetchJson('/functions/v1/public-context?slug=conexion-barberia'),
      fetchJson('/functions/v1/public-catalog?slug=conexion-barberia'),
    ]);
    expect(context.status).toBe(200);
    expect(catalog.status).toBe(200);

    const response = await page.goto('/b/conexion-barberia');
    expect(response?.status()).toBe(200);

    await expect(page.locator('h1.hero-title')).toContainText(context.body.barberia.name);
    await expect(page.locator('.ticket')).toHaveCount(catalog.body.services.length);

    const html = await page.content();
    expect(html).not.toContain('barberia_id');
    expect(html).not.toContain('barbero_id');
    expect(html).not.toContain('users_id');
    expect(html).not.toContain('publicToken');
    expect(html).not.toContain('"id":');
  });

  test('landing keeps booking controls out of the discovery view', async ({ page }) => {
    await page.goto('/b/conexion-barberia');

    await expect(page.locator('.prof-select')).toHaveCount(0);
    await expect(page.locator('.cal-jump-btn')).toHaveCount(0);
    await expect(page.getByText('Iniciar sesión')).toHaveCount(0);
    await expect(page.getByText('@conexion.barber')).toBeVisible();
  });

  test('theme switch toggles light and dark', async ({ page }) => {
    await page.goto('/b/conexion-barberia');

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.locator('header .icon-btn').first().click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('returns 404 for unknown slugs', async ({ page }) => {
    const response = await page.goto('/b/no-such-slug');
    expect(response?.status()).toBe(404);
    await expect(page.locator('h1.hero-title')).toContainText('no encontrada');
  });
});
