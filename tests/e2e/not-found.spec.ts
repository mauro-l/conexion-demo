import { test, expect } from '@playwright/test';

test.describe('public not-found experience', () => {
  test('renders the not-found page for an unknown configured slug', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(404);

    await expect(page.locator('h1.hero-title')).toContainText('Página no encontrada');
    await expect(
      page.getByText('El perfil que buscás no existe o no está publicado.')
    ).toBeVisible();
  });

  test('does not reveal the configured slug or offer a booking route', async ({ page }) => {
    await page.goto('/');

    const html = await page.content();
    expect(html).not.toContain('zz-unknown-slug');

    const booking = await page.goto('/reservar');
    expect(booking?.status()).toBe(404);
  });
});
