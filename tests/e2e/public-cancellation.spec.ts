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

type ErrorBody = { error?: { code?: string } };

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

test('manages and cancels a booking over the public Edge endpoints', async () => {
  const foreignToken = 'Z'.repeat(43);
  const manageProbe = await fetch(
    `${API_BASE}/functions/v1/public-booking-manage?token=${foreignToken}`,
    {
      method: 'POST',
      headers: { Authorization: AUTHORIZATION, 'Content-Type': 'application/json' },
      body: '{}',
    }
  ).catch(() => null);
  const cancelProbe = await fetch(`${API_BASE}/functions/v1/public-booking-cancel`, {
    method: 'GET',
    headers: { Authorization: AUTHORIZATION },
  }).catch(() => null);

  test.skip(
    manageProbe === null ||
      manageProbe.status === 404 ||
      cancelProbe === null ||
      cancelProbe.status === 404,
    'the local edge runtime does not serve public-booking-manage and public-booking-cancel; re-run `supabase start` in the scratch stack'
  );

  expect(manageProbe?.status).toBe(405);
  expect(cancelProbe?.status).toBe(405);

  const { services } = await catalog();
  const service = services[0];
  if (!service) throw new Error('the local scratch stack exposes a public service');

  const before = await availability(service.publicServiceToken);
  const target = before.days.slice(1).find((day) => day.slots.length > 0);
  if (!target) throw new Error('no future day with slots');
  const chosen = target.slots[0];

  const idempotencyKey = `cancel-e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
      apellido: 'Cancelacion',
      telefono: phone,
      telefonoRaw: `11${localPhone}`,
      email: `${idempotencyKey}@example.com`,
    }),
  });
  expect(bookingResponse.status, 'public booking').toBe(201);

  const bookingBody = (await bookingResponse.json()) as BookingBody;
  expect(bookingBody.booking?.serviceName).toBe(service.name);
  const managementToken = bookingBody.management?.token;
  expect(typeof managementToken === 'string' && /^[A-Za-z0-9_-]{43}$/.test(managementToken)).toBe(
    true
  );
  if (typeof managementToken !== 'string') throw new Error('booking did not return a management token');

  const foreignResponse = await fetch(
    `${API_BASE}/functions/v1/public-booking-manage?token=${foreignToken}`,
    { headers: { Authorization: AUTHORIZATION } }
  );
  expect(foreignResponse.status, 'foreign management token').toBe(404);
  expect(((await foreignResponse.json()) as ErrorBody).error?.code).toBe(
    'PUBLIC_RESOURCE_NOT_FOUND'
  );

  const malformedResponse = await fetch(
    `${API_BASE}/functions/v1/public-booking-manage?token=malformed`,
    { headers: { Authorization: AUTHORIZATION } }
  );
  expect(malformedResponse.status, 'malformed management token').toBe(400);
  expect(((await malformedResponse.json()) as ErrorBody).error?.code).toBe('INVALID_INPUT');

  const manageUrl = `${API_BASE}/functions/v1/public-booking-manage?token=${encodeURIComponent(
    managementToken
  )}`;
  const managedResponse = await fetch(manageUrl, {
    headers: { Authorization: AUTHORIZATION },
  });
  expect(managedResponse.status, 'booking management read').toBe(200);
  const managedBody = (await managedResponse.json()) as ManagedBody;
  expect(managedBody.booking?.serviceName).toBe(service.name);
  expect(managedBody.booking?.status).not.toBe('cancelado');
  const managedJson = JSON.stringify(managedBody);
  expect(managedJson.includes(managementToken)).toBe(false);
  expect(managedJson.includes(phone)).toBe(false);
  expect(managedJson.includes(`${idempotencyKey}@example.com`)).toBe(false);

  const cancelUrl = `${API_BASE}/functions/v1/public-booking-cancel`;
  const cancel = async () =>
    fetch(cancelUrl, {
      method: 'POST',
      headers: { Authorization: AUTHORIZATION, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: managementToken }),
    });

  const cancelResponse = await cancel();
  expect(cancelResponse.status, 'first cancellation').toBe(200);
  const cancelledBody = (await cancelResponse.json()) as ManagedBody;
  expect(cancelledBody.booking?.status).toBe('cancelado');
  expect(JSON.stringify(cancelledBody).includes(managementToken)).toBe(false);
  expect(JSON.stringify(cancelledBody).includes(phone)).toBe(false);

  const cancelledReadResponse = await fetch(manageUrl, {
    headers: { Authorization: AUTHORIZATION },
  });
  expect(cancelledReadResponse.status, 'management read after cancellation').toBe(200);
  const cancelledReadBody = (await cancelledReadResponse.json()) as ManagedBody;
  expect(cancelledReadBody.booking?.status).toBe('cancelado');
  expect(JSON.stringify(cancelledReadBody).includes(managementToken)).toBe(false);
  expect(JSON.stringify(cancelledReadBody).includes(phone)).toBe(false);

  const repeatedCancelResponse = await cancel();
  expect(repeatedCancelResponse.status, 'idempotent cancellation').toBe(200);
  const repeatedBody = (await repeatedCancelResponse.json()) as ManagedBody;
  expect(repeatedBody.booking?.status).toBe('cancelado');

  const after = await availability(service.publicServiceToken);
  expect(
    after.days.some((day) => day.slots.some((slot) => slot.start === chosen.start)),
    'cancellation releases the selected slot'
  ).toBe(true);
});
