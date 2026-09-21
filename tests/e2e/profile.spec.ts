import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import nodePath from 'node:path';

// Ensure the gitignored local environment is available even when the suite is
// launched outside the Playwright config process.
if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile('.env');
  } catch {
    // .env is optional.
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}. Copy .env.example to .env before running E2E.`);
  }
  return value;
}

type PublicContextBody = {
  barberia: {
    name: string;
    address: string | null;
    hours: string | null;
    whatsappUrl: string | null;
    instagramHandle: string | null;
  };
};

type PublicCatalogBody = {
  services: unknown[];
};

async function fetchPublic<T>(pathname: string): Promise<{ status: number; body: T }> {
  const base = requiredEnv('SUPABASE_URL').replace(/\/$/, '');
  const response = await fetch(`${base}${pathname}`, {
    headers: { Authorization: `Bearer ${requiredEnv('SUPABASE_ANON_KEY')}` },
  });
  return { status: response.status, body: (await response.json()) as T };
}

function readClientBundle(dir: string): string {
  if (!fs.existsSync(dir)) return '';
  const chunks: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = nodePath.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|mjs|json|map)$/.test(entry.name)) chunks.push(fs.readFileSync(full, 'utf8'));
    }
  };
  walk(dir);
  return chunks.join('\n');
}

test.describe('public landing at /', () => {
  test('renders hero and service catalog from the public DTOs', async ({ page }) => {
    const slug = requiredEnv('BARBERSHOP_PUBLIC_SLUG');
    const [context, catalog] = await Promise.all([
      fetchPublic<PublicContextBody>(`/functions/v1/public-context?slug=${slug}`),
      fetchPublic<PublicCatalogBody>(`/functions/v1/public-catalog?slug=${slug}`),
    ]);
    expect(context.status).toBe(200);
    expect(catalog.status).toBe(200);

    const response = await page.goto('/');
    expect(response?.status()).toBe(200);

    await expect(page.locator('h1.hero-title')).toContainText(context.body.barberia.name);
    await expect(page.locator('.section-title')).toHaveText('Servicios');
    await expect(page.locator('.ticket')).toHaveCount(catalog.body.services.length);
  });

  test('renders only the information rows that have values', async ({ page }) => {
    const slug = requiredEnv('BARBERSHOP_PUBLIC_SLUG');
    const { body } = await fetchPublic<PublicContextBody>(`/functions/v1/public-context?slug=${slug}`);
    const barberia = body.barberia;

    await page.goto('/');

    const expectedRows = [barberia.address, barberia.hours, barberia.whatsappUrl, barberia.instagramHandle].filter(
      (value) => Boolean(value)
    ).length;
    await expect(page.locator('.info-row')).toHaveCount(expectedRows);
  });

  test('does not expose internal identifiers, credentials, or the configured slug', async ({ page }) => {
    await page.goto('/');

    const html = await page.content();
    for (const forbidden of ['barberia_id', 'barbero_id', 'users_id', 'publicToken', '"id":']) {
      expect(html).not.toContain(forbidden);
    }
    expect(html).not.toContain(requiredEnv('SUPABASE_ANON_KEY'));
    expect(html).not.toContain(requiredEnv('BARBERSHOP_PUBLIC_SLUG'));

    const bundle = readClientBundle(nodePath.resolve(process.cwd(), '.next/static'));
    expect(bundle).not.toContain(requiredEnv('SUPABASE_ANON_KEY'));
    expect(bundle).not.toContain(requiredEnv('BARBERSHOP_PUBLIC_SLUG'));
  });

  test('keeps booking controls out of the landing and invents no defaults', async ({ page }) => {
    const slug = requiredEnv('BARBERSHOP_PUBLIC_SLUG');
    const { body } = await fetchPublic<PublicContextBody>(`/functions/v1/public-context?slug=${slug}`);

    await page.goto('/');

    await expect(page.locator('.prof-select')).toHaveCount(0);
    await expect(page.locator('.cal-jump-btn')).toHaveCount(0);
    await expect(page.getByText('Iniciar sesión')).toHaveCount(0);

    // Removed fallbacks must not reappear when the DTO has no value for them.
    const html = await page.content();
    if (!body.barberia.address) expect(html).not.toContain('Av. Gral. Mosconi 3429');
    if (!body.barberia.hours) expect(html).not.toContain('Hoy 10:00–20:00');
    if (!body.barberia.instagramHandle) expect(html).not.toContain('@conexion.barber');

    // The catalog CTA is now a real link into the read-only booking route; its
    // navigation and the slot flow are covered by public-availability.spec.ts.
    await expect(page.locator('.ticket-cta').first()).toHaveAttribute('href', /^\/reservar\?service=/);
  });

  test('serves the approved local cover asset', async ({ page }) => {
    await page.goto('/');

    const cover = page.locator('.cover-photo img').first();
    const src = await cover.getAttribute('src');
    expect(src).toContain('cover.jpg');

    const naturalWidth = await cover.evaluate((element) => (element as HTMLImageElement).naturalWidth);
    expect(naturalWidth).toBeGreaterThan(0);

    const html = await page.content();
    expect(html).not.toContain('picsum.photos');
  });

  test('applies the stored theme before paint and toggles it', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('conexion-theme', 'dark'));
    await page.goto('/');

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.locator('header .icon-btn').first().click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('returns 404 for the removed dynamic route and unknown paths', async ({ page }) => {
    const slug = requiredEnv('BARBERSHOP_PUBLIC_SLUG');

    const removed = await page.goto(`/b/${slug}`);
    expect(removed?.status()).toBe(404);
    await expect(page.locator('h1.hero-title')).toContainText('no encontrada');

    const unknown = await page.goto('/no-such-page');
    expect(unknown?.status()).toBe(404);
  });
});
