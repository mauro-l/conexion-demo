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
  await expect(page.locator('.confirm-card')).toContainText(service.name);

  // Cancel through the real management UI.
  await page.getByRole('button', { name: 'Cancelar turno' }).click();
  await page.getByRole('button', { name: 'Sí, cancelar turno' }).click();
  await expect(page.locator('.confirm-note')).toContainText('Este turno ya está cancelado.');

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
