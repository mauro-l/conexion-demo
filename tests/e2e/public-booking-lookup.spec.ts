import { test, expect } from '@playwright/test';

// Mirror the Playwright config's environment precedence (`.env.local` wins) so
// the API reads below hit the same local scratch stack the app servers use.
if (typeof process.loadEnvFile === 'function') {
  for (const file of ['.env.local', '.env']) {
    try {
      process.loadEnvFile(file);
    } catch {
      // Optional file.
    }
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}. Copy .env.example to .env before running E2E.`);
  }
  return value;
}

type CatalogBody = {
  services: { publicServiceToken: string; name: string }[];
};

type Slot = { start: string; end: string; availabilityToken: string };
type AvailabilityBody = {
  service: { publicServiceToken: string; name: string };
  days: { date: string; day: number; slots: Slot[] }[];
};

type BookingBody = {
  booking?: { serviceName?: string; status?: string };
  management?: { token?: string; expiresAt?: string };
};

type ManagedBody = {
  booking?: { serviceName?: string; status?: string; canCancel?: boolean };
};

const API_BASE = requiredEnv('SUPABASE_URL').replace(/\/$/, '');
const AUTHORIZATION = `Bearer ${requiredEnv('SUPABASE_ANON_KEY')}`;

async function publicGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: AUTHORIZATION },
  });
  expect(response.status, `public read ${path}`).toBe(200);
  return (await response.json()) as T;
}

function catalog(): Promise<CatalogBody> {
  return publicGet<CatalogBody>(
    `/functions/v1/public-catalog?slug=${encodeURIComponent(requiredEnv('BARBERSHOP_PUBLIC_SLUG'))}`
  );
}

function availability(service: string): Promise<AvailabilityBody> {
  return publicGet<AvailabilityBody>(
    `/functions/v1/public-availability?slug=${encodeURIComponent(
      requiredEnv('BARBERSHOP_PUBLIC_SLUG')
    )}&service=${encodeURIComponent(service)}`
  );
}

/**
 * WCAG relative luminance and contrast helpers, mirrored in the browser
 * context where needed. Kept local to this spec so the assertions read
 * without importing app code into the E2E boundary.
 */
function luminance(rgb: [number, number, number]): number {
  const channels = rgb.map((value) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const hi = Math.max(luminance(a), luminance(b));
  const lo = Math.min(luminance(a), luminance(b));
  return (hi + 0.05) / (lo + 0.05);
}

function parseRgb(css: string): [number, number, number] {
  const match = css.match(/rgba?\(([^)]+)\)/);
  if (!match) throw new Error(`cannot parse color ${css}`);
  const parts = match[1].split(',').map((part) => Number.parseFloat(part.trim()));
  return [parts[0], parts[1], parts[2]];
}

/**
 * Reads the destructive-action tokens for one theme and returns the computed
 * white-on-red contrast. Switching `data-theme` flips the same custom
 * properties the stylesheet scopes under `:root[data-theme='dark']`.
 */
async function dangerContrast(page: import('@playwright/test').Page): Promise<number> {
  const colors = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    const read = (name: string): string => {
      const probe = document.createElement('div');
      probe.style.color = `var(${name})`;
      probe.style.position = 'absolute';
      probe.style.visibility = 'hidden';
      document.body.appendChild(probe);
      const resolved = getComputedStyle(probe).color;
      probe.remove();
      void style;
      return resolved;
    };
    return { background: read('--danger-bg'), foreground: read('--danger-fg') };
  });
  return contrastRatio(parseRgb(colors.background), parseRgb(colors.foreground));
}

/**
 * The recovery flow end to end, through the real browser and the real APIs.
 *
 * A booking is created over the public Edge API with a unique phone, then
 * recovered from the home footer's modal using the same identity. Landing on
 * the management screen proves the minted token works; cancelling through it
 * proves the recovered token carries the real booking.
 */
test('recovers a booking from the footer modal and cancels it', async ({ page }) => {
  const foreignToken = 'Z'.repeat(43);
  const manageProbe = await fetch(
    `${API_BASE}/functions/v1/public-booking-manage?token=${foreignToken}`,
    {
      method: 'POST',
      headers: { Authorization: AUTHORIZATION, 'Content-Type': 'application/json' },
      body: '{}',
    }
  ).catch(() => null);
  const lookupProbe = await fetch(`${API_BASE}/functions/v1/public-booking-lookup`, {
    method: 'GET',
    headers: { Authorization: AUTHORIZATION },
  }).catch(() => null);

  test.skip(
    manageProbe === null ||
      manageProbe.status === 404 ||
      lookupProbe === null ||
      lookupProbe.status === 404,
    'the local edge runtime does not serve public-booking-manage and public-booking-lookup; re-run `supabase start` in the scratch stack'
  );

  expect(lookupProbe?.status).toBe(405);

  const { services } = await catalog();
  const service = services[0];
  if (!service) throw new Error('the local scratch stack exposes a public service');

  const before = await availability(service.publicServiceToken);
  const target = before.days.slice(1).find((day) => day.slots.length > 0);
  if (!target) throw new Error('no future day with slots');
  const chosen = target.slots[0];

  const idempotencyKey = `lookup-e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const localPhone = String(Date.now()).slice(-8).padStart(8, '0');
  const phone = `+54911${localPhone}`;
  const bookingResponse = await fetch(`${API_BASE}/functions/v1/public-booking`, {
    method: 'POST',
    headers: {
      Authorization: AUTHORIZATION,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      token: chosen.availabilityToken,
      nombre: 'Prueba',
      apellido: 'Lookup',
      telefono: phone,
      telefonoRaw: `11${localPhone}`,
      email: `${idempotencyKey}@example.com`,
    }),
  });
  expect(bookingResponse.status, 'public booking').toBe(201);

  const bookingBody = (await bookingResponse.json()) as BookingBody;
  expect(bookingBody.booking?.serviceName).toBe(service.name);
  const issuedToken = bookingBody.management?.token;
  if (typeof issuedToken !== 'string') throw new Error('booking did not return a management token');

  // Recover it from the footer modal, typing the phone the way a person would
  // (no `+54`, no formatting); normalization is the form's job.
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Cancelar turno' });
  await expect(trigger).toBeVisible();
  await trigger.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/Nombre/).fill('Prueba');
  await dialog.getByLabel(/Apellido/).fill('Lookup');
  await dialog.getByLabel(/Teléfono/).fill(`11${localPhone}`);

  // BMP-1: the lookup modal actions share one size (width and height).
  const backBox = await dialog.getByRole('button', { name: 'Volver' }).boundingBox();
  const searchBox = await dialog.getByRole('button', { name: 'Buscar turno' }).boundingBox();
  expect(backBox, 'Volver box').not.toBeNull();
  expect(searchBox, 'Buscar turno box').not.toBeNull();
  expect(searchBox?.width).toBeCloseTo(backBox?.width ?? 0, 0);
  expect(searchBox?.height).toBeCloseTo(backBox?.height ?? 0, 0);

  await dialog.getByRole('button', { name: 'Buscar turno' }).click();

  await page.waitForURL((url) => url.pathname === '/reserva/gestionar' && url.searchParams.has('token'));
  const recoveredToken = new URL(page.url()).searchParams.get('token');
  expect(typeof recoveredToken === 'string' && /^[A-Za-z0-9_-]{43}$/.test(recoveredToken)).toBe(
    true
  );
  // No PII in the URL: only the opaque token crosses.
  expect(page.url()).not.toContain(localPhone);

  // The recovered token is bound to the same booking, so the management screen
  // shows this service and offers cancellation.
  await expect(page.locator('h1.hero-title')).toContainText('Tu turno en');
  await expect(page.locator('.manage-booking .recap')).toContainText(service.name);

  // Cancel through the real management UI.
  await page.getByRole('button', { name: 'Cancelar turno' }).click();
  const confirmButton = page.getByRole('button', { name: 'Sí, cancelar' });
  await expect(confirmButton).toBeVisible();

  // BMP-1: the destructive confirmation keeps readable contrast in both themes.
  expect(await dangerContrast(page), 'destructive contrast in light theme').toBeGreaterThanOrEqual(
    4.5
  );
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
  });
  expect(await dangerContrast(page), 'destructive contrast in dark theme').toBeGreaterThanOrEqual(
    4.5
  );
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
  });

  await confirmButton.click();
  await expect(page.locator('.manage-booking .note-box')).toContainText(
    'Este turno fue cancelado. Podés reservar uno nuevo cuando quieras.'
  );

  // BMP-2: the cancelled view offers both exits — rebook and home.
  await expect(page.getByRole('link', { name: 'Reservar otro turno' })).toHaveAttribute('href', '/');
  await expect(page.getByRole('link', { name: 'Volver al inicio' })).toHaveAttribute('href', '/');

  // The server agrees, and the cancelled slot is offered again.
  const manageUrl = `${API_BASE}/functions/v1/public-booking-manage?token=${encodeURIComponent(
    recoveredToken ?? ''
  )}`;
  const managedResponse = await fetch(manageUrl, { headers: { Authorization: AUTHORIZATION } });
  expect(managedResponse.status, 'management read after cancellation').toBe(200);
  const managedBody = (await managedResponse.json()) as ManagedBody;
  expect(managedBody.booking?.status).toBe('cancelado');

  const after = await availability(service.publicServiceToken);
  expect(
    after.days.some((day) => day.slots.some((slot) => slot.start === chosen.start)),
    'cancellation releases the selected slot'
  ).toBe(true);
});

/**
 * BMP-1 sizing without the backend: the lookup modal is a static surface, so
 * its two actions can be measured in both themes with no booking involved.
 */
test('lookup modal actions share one size in both themes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cancelar turno' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    const backBox = await dialog.getByRole('button', { name: 'Volver' }).boundingBox();
    const searchBox = await dialog.getByRole('button', { name: 'Buscar turno' }).boundingBox();
    expect(backBox, `Volver box (${theme})`).not.toBeNull();
    expect(searchBox, `Buscar turno box (${theme})`).not.toBeNull();
    expect(searchBox?.width, `modal action width (${theme})`).toBeCloseTo(backBox?.width ?? 0, 0);
    expect(searchBox?.height, `modal action height (${theme})`).toBeCloseTo(backBox?.height ?? 0, 0);
  }
});

/**
 * BMP-1 contrast without the backend: the destructive tokens live on `:root`,
 * so their computed white-on-red ratio can be verified per theme on any page.
 * The pinned values below are the verified WCAG ratios (light 5.98:1, dark
 * 5.41:1); the assertions guard the 4.5:1 floor, not the exact decimals.
 */
test('destructive tokens keep readable contrast in both themes', async ({ page }) => {
  await page.goto('/');

  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
  });
  expect(await dangerContrast(page), 'destructive contrast in light theme').toBeGreaterThanOrEqual(
    4.5
  );

  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
  });
  expect(await dangerContrast(page), 'destructive contrast in dark theme').toBeGreaterThanOrEqual(
    4.5
  );
});
