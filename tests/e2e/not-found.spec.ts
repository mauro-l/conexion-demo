import { test, expect } from '@playwright/test';

test.describe('public not-found experience', () => {
  test('renders the same not-found page for an unknown slug on `/` and `/reservar`', async ({
    page,
  }) => {
    const home = await page.goto('/');
    expect(home?.status()).toBe(404);
    await expect(page.locator('h1.hero-title')).toContainText('Página no encontrada');
    await expect(
      page.getByText('El perfil que buscás no existe o no está publicado.')
    ).toBeVisible();

    // An unknown-but-well-formed service token resolves through the same public
    // not-found boundary, so the response is byte-for-byte the same page and
    // never distinguishes "unknown" from "unpublished".
    const reservar = await page.goto('/reservar?service=00000000000000000000000000000000');
    expect(reservar?.status()).toBe(404);
    await expect(page.locator('h1.hero-title')).toContainText('Página no encontrada');
    await expect(
      page.getByText('El perfil que buscás no existe o no está publicado.')
    ).toBeVisible();

    // A booking link without a token is a broken link, not a server error, and
    // it renders the exact same copy as the two cases above.
    const missing = await page.goto('/reservar');
    expect(missing?.status()).toBe(404);
    await expect(page.locator('h1.hero-title')).toContainText('Página no encontrada');
    await expect(
      page.getByText('El perfil que buscás no existe o no está publicado.')
    ).toBeVisible();
  });

  test('does not reveal the configured slug', async ({ page }) => {
    await page.goto('/');

    const html = await page.content();
    expect(html).not.toContain('zz-unknown-slug');
  });
});
