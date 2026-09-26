import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import nodePath from 'node:path';

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
type AvailabilityDay = { date: string; day: number; slots: Slot[] };
type AvailabilityBody = {
  service: { publicServiceToken: string; name: string };
  days: AvailabilityDay[];
};

type ContextBody = { barberia: { name: string } };

const API_BASE = requiredEnv('SUPABASE_URL').replace(/\/$/, '');

async function publicGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${requiredEnv('SUPABASE_ANON_KEY')}` },
  });
  expect(response.status, `public read ${path}`).toBe(200);
  return (await response.json()) as T;
}

function catalog(): Promise<CatalogBody> {
  return publicGet<CatalogBody>(
    `/functions/v1/public-catalog?slug=${encodeURIComponent(requiredEnv('BARBERSHOP_PUBLIC_SLUG'))}`
  );
}

/** The public context read, for the database shop name shown in the modal crumb. */
function context(): Promise<ContextBody> {
  return publicGet<ContextBody>(
    `/functions/v1/public-context?slug=${encodeURIComponent(requiredEnv('BARBERSHOP_PUBLIC_SLUG'))}`
  );
}

function availability(service: string): Promise<AvailabilityBody> {
  return publicGet<AvailabilityBody>(
    `/functions/v1/public-availability?slug=${encodeURIComponent(
      requiredEnv('BARBERSHOP_PUBLIC_SLUG')
    )}&service=${encodeURIComponent(service)}`
  );
}

const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

/** Full month labels, spelled out independently of the island's own table. */
const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** Same text the island renders in its footer and recap, so the test can target a day. */
function dayTitle(day: AvailabilityDay): string {
  const [, month, dayOfMonth] = day.date.split('-');
  return `${WEEKDAYS[day.day]} ${Number(dayOfMonth)} de ${MONTHS[Number(month) - 1]}`;
}

/** The date card for a returned day, addressed by its DTO date string. */
function dateCard(page: Page, day: AvailabilityDay) {
  return page.getByTestId(`date-card-${day.date}`);
}

/** Every request that is not a safe read would be a booking-flow mutation. */
function mutationProbe(page: Page): string[] {
  const mutations: string[] = [];
  page.on('request', (request) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      mutations.push(`${request.method()} ${request.url()}`);
    }
  });
  return mutations;
}

/**
 * Client chunks the browser actually loads for a page. The landing spec audits
 * the whole `.next/static` tree; the booking route needs its own audit of the
 * chunks it really receives, so a secret that only ships there cannot hide
 * behind the landing route's clean bundle.
 */
function servedClientScripts(page: Page): Set<string> {
  const scripts = new Set<string>();
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith('/_next/static/') && path.endsWith('.js')) scripts.add(path);
  });
  return scripts;
}

/** Reads the served client chunks from the production build directory. */
function readServedBundle(scripts: Set<string>): string {
  const chunks: string[] = [];
  for (const path of scripts) {
    const file = nodePath.join('.next/static', path.replace('/_next/static/', ''));
    if (fs.existsSync(file)) chunks.push(fs.readFileSync(file, 'utf8'));
  }
  return chunks.join('\n');
}

const DB_CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_conexion-db';

/**
 * Read-only snapshot of every table a booking flow could write to, taken
 * straight from the local scratch database (there is no `Reserva` table here;
 * reservations live in `Turno`). Each entry is `rowCount/maxId`, so the check
 * catches a row that was created and then removed as well as a plain insert.
 * The probe never writes: it runs a single `SELECT` through `psql`.
 *
 * `sg docker` mirrors the documented access path for the scratch stack; if the
 * database cannot be reached the test fails loudly rather than passing on an
 * empty snapshot.
 */
function reservationState(): Record<string, string> {
  const sql = `
select 'Turno', count(*)::text, coalesce(max(id), 0)::text from public."Turno"
union all select 'Cliente', count(*)::text, coalesce(max(id), 0)::text from public."Cliente"
union all select 'BloqueoHorario', count(*)::text, coalesce(max(id), 0)::text from public."BloqueoHorario"
union all select 'CodigoVerificacion', count(*)::text, coalesce(max(id), 0)::text from public."CodigoVerificacion"
union all select 'Barberia', count(*)::text, coalesce(max(id), 0)::text from public."Barberia"
order by 1;
`;
  const output = execFileSync(
    'sg',
    ['docker', '-c', `docker exec -i ${DB_CONTAINER} psql -U postgres -d postgres -At`],
    { input: sql, encoding: 'utf8' }
  );

  const state: Record<string, string> = {};
  for (const line of output.trim().split('\n')) {
    const [table, count, maxId] = line.split('|');
    if (!table || count === undefined || maxId === undefined) {
      throw new Error(`Unexpected database probe output: ${line}`);
    }
    state[table] = `${count}/${maxId}`;
  }
  if (Object.keys(state).length !== 5) {
    throw new Error(`Incomplete database probe output: ${output}`);
  }
  return state;
}

/**
 * Read-only map of published service token to its barber's working days,
 * taken straight from the local scratch database through the same `sg docker`
 * path as reservationState. The probe never writes: it runs a single SELECT.
 * A NULL `dias_habiles` renders empty under `-At` and maps to `[]` (unknown or
 * schedule-less barber). If the database cannot be reached the test fails
 * loudly rather than passing on an empty map.
 */
function serviceBarberDays(): Record<string, number[]> {
  const sql = `
select s.public_service_token, ba.dias_habiles
from public."Servicio" s
join public."Barbero" ba on ba.id = s.barbero_id
where s.public_service_token is not null;
`;
  const output = execFileSync(
    'sg',
    ['docker', '-c', `docker exec -i ${DB_CONTAINER} psql -U postgres -d postgres -At`],
    { input: sql, encoding: 'utf8' }
  );

  const days: Record<string, number[]> = {};
  for (const line of output.trim().split('\n')) {
    if (!line) continue;
    const [token, raw] = line.split('|');
    if (!token || raw === undefined) {
      throw new Error(`Unexpected database probe output: ${line}`);
    }
    // Postgres int[] renders as {2,4,5,6}; NULL renders as an empty field.
    days[token] = raw
      .replace(/[{}]/g, '')
      .split(',')
      .filter(Boolean)
      .map(Number);
  }
  return days;
}

/**
 * Read-only lookup of one published service whose barber is active but keeps
 * no usable schedule (NULL working days or hours). Returns null when the
 * scratch stack has no such fixture. Never writes: a single SELECT.
 */
function scheduleLessServiceToken(): string | null {
  const sql = `
select s.public_service_token
from public."Servicio" s
join public."Barbero" ba on ba.id = s.barbero_id
where s.public_service_token is not null
  and ba.activo = true
  and (ba.dias_habiles is null or ba.hora_apertura is null or ba.hora_cierre is null)
limit 1;
`;
  const output = execFileSync(
    'sg',
    ['docker', '-c', `docker exec -i ${DB_CONTAINER} psql -U postgres -d postgres -At`],
    { input: sql, encoding: 'utf8' }
  );
  const token = output.trim().split('\n')[0]?.trim();
  return token ? token : null;
}

test.describe('public availability surface', () => {
  test('activates the catalog CTA into the read-only booking route without a mutation', async ({
    page,
  }) => {
    const { services } = await catalog();
    const tokens = new Set(services.map((service) => service.publicServiceToken));
    const mutations = mutationProbe(page);

    await page.goto('/');
    const cta = page.locator('.ticket-cta').first();
    const href = await cta.getAttribute('href');
    expect(href).toMatch(/^\/reservar\?service=[a-f0-9]{32}$/);
    if (!href) throw new Error('catalog CTA is missing its href');

    const token = new URL(href, 'http://localhost').searchParams.get('service');
    expect(tokens.has(token ?? '')).toBe(true);

    await cta.click();
    await page.waitForURL(
      (url) => url.pathname === '/reservar' && url.searchParams.get('service') === token
    );

    // Navigating to the read-only entry point must not book anything.
    expect(mutations).toEqual([]);
  });

  test('keeps the server-only slug and Supabase credentials out of the booking page', async ({
    page,
  }) => {
    const { services } = await catalog();
    const service = services[0];
    const scripts = servedClientScripts(page);

    await page.goto(`/reservar?service=${service.publicServiceToken}`);

    // Gate the privacy assertions on the booking UI having rendered at all.
    // Without this, a backend timeout renders the error page and the
    // "availabilityToken is present" assertion below reports a backend hiccup
    // as a privacy leak. A privacy test must fail as "backend down" instead.
    await expect(page.locator('h1.hero-title')).toHaveText(service.name);
    await expect(page.locator('.date-scroller, .availability-empty').first()).toBeVisible();

    const html = await page.content();
    expect(html).not.toContain(requiredEnv('BARBERSHOP_PUBLIC_SLUG'));
    expect(html).not.toContain(requiredEnv('SUPABASE_ANON_KEY'));
    for (const forbidden of ['barberia_id', 'barbero_id', 'users_id', 'SUPABASE_URL']) {
      expect(html).not.toContain(forbidden);
    }

    // Deliberate, documented exception: the island receives each slot's signed
    // availability token because a later stage needs it. Its payload embeds the
    // slug, but only inside the opaque HMAC token, never as readable config.
    expect(html).toContain('availabilityToken');

    // Same audit the landing route gets, applied to the chunks the booking
    // route itself loads. The build emits a flat chunk directory shared by both
    // routes, so this is the only route-scoped view of what `/reservar` ships.
    expect(scripts.size).toBeGreaterThan(0);
    const bundle = readServedBundle(scripts);
    // Guard against a vacuous scan: the served chunks must resolve to real files.
    expect(bundle.length).toBeGreaterThan(0);
    expect(bundle).not.toContain(requiredEnv('BARBERSHOP_PUBLIC_SLUG'));
    expect(bundle).not.toContain(requiredEnv('SUPABASE_ANON_KEY'));
  });

  test('hands the chosen slot to the customer form without creating, updating, or reserving anything', async ({
    page,
  }) => {
    const { services } = await catalog();
    const service = services[0];
    const before = await availability(service.publicServiceToken);
    expect(before.service.publicServiceToken).toBe(service.publicServiceToken);

    // A future day keeps the 30-minute lead-time rule from invalidating the
    // chosen slot while the test runs, so the check below is not clock-racy.
    const target = before.days.slice(1).find((day) => day.slots.length > 0);
    expect(target, 'the local scratch stack exposes at least one future day').toBeTruthy();
    if (!target) throw new Error('no future day with slots');
    const chosen = target.slots[0];

    const mutations = mutationProbe(page);
    const dbBefore = reservationState();

    await page.goto(`/reservar?service=${service.publicServiceToken}`);
    await expect(page.locator('h1.hero-title')).toHaveText(before.service.name);
    await expect(page.locator('.prof-select-value')).toHaveText('Cualquier profesional');

    const day = dateCard(page, target);
    await day.click();
    await expect(day).toHaveAttribute('aria-pressed', 'true');
    // The selected day's slots render under at least one non-empty time group.
    await expect(page.locator('.availability-slots .group-label').first()).toBeVisible();
    await page.locator('.availability-slots .availability-slot').first().click();

    // The slot is staged behind the footer, not handed to the form yet: the
    // visitor has to see which time they are confirming before typing anything.
    await expect(page.locator('.sticky-summary')).toContainText(dayTitle(target));
    await expect(page.getByLabel(/Nombre/)).toBeHidden();
    await expect(page.getByRole('button', { name: 'Siguiente' })).toBeEnabled();

    await page.getByRole('button', { name: 'Siguiente' }).click();

    // Reaching the form is still not a booking — nothing leaves the browser until
    // the visitor submits, and this test never submits.
    await expect(page.locator('.booking-recap')).toContainText(dayTitle(target));
    await expect(page.getByLabel(/Nombre/)).toBeVisible();
    await expect(page.getByLabel(/Apellido/)).toBeVisible();
    await expect(page.getByLabel(/Email/)).toBeVisible();
    await expect(page.getByLabel(/Teléfono/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirmar turno' })).toBeEnabled();

    // Real evidence of no mutation: a fresh authoritative read still offers the
    // selected slot, the browser issued no state-changing request, and the
    // reservation tables are byte-for-byte the same rows as before the flow.
    const after = await availability(service.publicServiceToken);
    const stillOffered = after.days.some((dayEntry) =>
      dayEntry.slots.some((slot) => slot.start === chosen.start)
    );
    expect(stillOffered).toBe(true);
    expect(mutations).toEqual([]);

    const dbAfter = reservationState();
    expect(dbAfter).toEqual(dbBefore);
    expect(dbAfter.Turno).toBe(dbBefore.Turno);
  });

  test('renders the read-only step chrome, chip, professional pill and jump control', async ({
    page,
  }) => {
    const [ctx, catalogBody] = await Promise.all([context(), catalog()]);
    const avail = await availability(catalogBody.services[0].publicServiceToken);

    await page.goto(`/reservar?service=${avail.service.publicServiceToken}`);

    // The home header must not render on the booking route; modal chrome replaces it.
    await expect(page.locator('header.topbar, .logo')).toHaveCount(0);

    // Deterministic `/` links for both back and close.
    const volver = page.getByRole('link', { name: 'Volver' });
    const cerrar = page.getByRole('link', { name: 'Cerrar' });
    await expect(volver).toHaveAttribute('href', '/');
    await expect(cerrar).toHaveAttribute('href', '/');

    // The crumb shows the database shop name.
    await expect(page.locator('.topbar-crumb')).toHaveText(ctx.barberia.name);

    // Chip: database service name plus the shared duration · price treatment.
    const chip = page.locator('.service-chip');
    await expect(chip.locator('.name')).toHaveText(avail.service.name);
    await expect(chip.locator('.meta')).toContainText('·');

    // Both section labels render.
    await expect(page.getByText('Elegí una fecha', { exact: true })).toBeVisible();
    await expect(page.getByText('Elegí un horario', { exact: true })).toBeVisible();

    // Exactly one static professional affordance: pill, avatar and chevron, no selector.
    const pill = page.locator('.prof-select');
    await expect(pill).toHaveCount(1);
    await expect(pill).toContainText('Cualquier profesional');
    await expect(pill.locator('.prof-avatar')).toHaveCount(1);
    await expect(pill.locator('.prof-chevron')).toHaveCount(1);
    await expect(page.locator('.prof-select-label')).toHaveCount(0);

    // The calendar-jump control is present with its accessible label.
    await expect(page.getByRole('button', { name: 'Ir a una fecha específica' })).toBeVisible();

    // The default-selected open day renders its slots under a non-empty group heading.
    const openDay = avail.days.find((day) => day.slots.length > 0);
    if (!openDay) throw new Error('the local scratch stack exposes at least one open day');
    await expect(dateCard(page, openDay)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.availability-slots .time-group').first()).toBeVisible();

    // The prototype's rating row has no database source and must never render here.
    const html = await page.content();
    expect(html).not.toContain('★');
    expect(html).not.toContain('reseñas');
  });

  test('jumps to the selected date card without opening a date dialog', async ({ page }) => {
    const { services } = await catalog();
    const avail = await availability(services[0].publicServiceToken);
    const openDays = avail.days.filter((day) => day.slots.length > 0);
    const last = openDays[openDays.length - 1];
    if (!last) throw new Error('the local scratch stack exposes at least one open day');

    await page.goto(`/reservar?service=${services[0].publicServiceToken}`);

    const card = dateCard(page, last);
    await card.click();
    await expect(card).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: 'Ir a una fecha específica' }).click();

    // The jump only scrolls and focuses the selected card; it never opens a dialog
    // and never navigates.
    await expect(card).toBeFocused();
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe('/reservar');
  });

  test('books the chosen slot from the browser and shows the inline confirmation', async ({
    page,
  }) => {
    // The local edge runtime serves a bundle that `supabase start` builds from
    // the scratch stack's own functions directory — `edge-runtime start
    // --main-service`. Copying a new function into that directory is therefore
    // not enough for it to be served. Skip with the reason instead of failing on
    // an environment gap that has nothing to do with this change.
    const endpoint = `${process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'}/functions/v1/public-booking`;
    const probe = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }).catch(() => null);
    test.skip(
      probe === null || probe.status === 404,
      'the local edge runtime does not serve public-booking; re-run `supabase start` in the scratch stack'
    );

    const { services } = await catalog();
    const service = services[0];
    const before = await availability(service.publicServiceToken);

    // A future day keeps the 30-minute lead-time rule out of the way.
    const target = before.days.slice(1).find((day) => day.slots.length > 0);
    if (!target) throw new Error('no future day with slots');
    const chosen = target.slots[0];

    await page.goto(`/reservar?service=${service.publicServiceToken}`);
    await dateCard(page, target).click();
    await page.locator('.availability-slots .availability-slot').first().click();
    await page.getByRole('button', { name: 'Siguiente' }).click();

    // The phone is typed the way a person types it, not canonically: normalizing
    // it is the form's job, and the server rejects anything that is not `+549...`.
    await page.getByLabel(/Nombre/).fill('Prueba');
    await page.getByLabel(/Apellido/).fill('E2E');
    await page.getByLabel(/Email/).fill(`e2e-${Date.now()}@example.com`);
    await page.getByLabel(/Teléfono/).fill('221 681 9377');

    await page.getByRole('button', { name: 'Confirmar turno' }).click();

    const confirmation = page.locator('.booking-confirm');
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toContainText('¡Gracias por agendar');
    await expect(confirmation).toContainText(service.name);
    await expect(confirmation).toContainText('Prueba E2E');

    /*
     * The regression this guards: the grid was rendered before this visitor's
     * booking, so it still offered the slot the booking had just taken, with a
     * token the server still accepted. Leaving the confirmation has to re-read
     * the window. Wait for the grid — it replaces the "Actualizando horarios…"
     * status — so the assertions below run against the refreshed props and not
     * against the momentary disabled state of the refresh.
     */
    await page.getByRole('button', { name: 'Agendar otra cita' }).click();
    await expect(page.locator('.availability-slots')).toBeVisible();

    const chosenLabel = chosen.start.slice(11, 16);
    const bookedCard = dateCard(page, target);
    if (await bookedCard.isEnabled()) {
      await bookedCard.click();
      await expect(
        page
          .locator('.availability-slots')
          .getByRole('button', { name: chosenLabel, exact: true })
      ).toHaveCount(0);
    } else {
      // The booking took that day's last slot, which is the other true answer.
      await expect(bookedCard).toBeDisabled();
    }

    // The real proof: a fresh authoritative read no longer offers that slot,
    // because the booking landed.
    const after = await availability(service.publicServiceToken);
    const stillOffered = after.days.some((dayEntry) =>
      dayEntry.slots.some((slot) => slot.start === chosen.start)
    );
    expect(stillOffered).toBe(false);
  });

  test('scopes availability slots to the working days of the requested service barber', async () => {
    // Regression for phase18: the RPC computed slots from every active barber
    // of the shop and only used the service for its duration, so a service
    // answered days its own barber never works (live: servicio 20 / barbero 11
    // answered Mondays and Wednesdays). Every offered slot must now fall on a
    // working day of the service's own barber.
    const { services } = await catalog();
    expect(services.length).toBeGreaterThan(0);
    const barberDays = serviceBarberDays();

    let checked = 0;
    for (const service of services) {
      const body = await availability(service.publicServiceToken);
      if (!Array.isArray(body.days)) continue;
      const allowed = barberDays[service.publicServiceToken];
      expect(allowed, `the scratch stack knows the barber days of ${service.name}`).toBeDefined();
      if (!allowed || allowed.length === 0) {
        // A schedule-less barber contributes no slots: every day stays empty.
        for (const day of body.days) expect(day.slots).toEqual([]);
        continue;
      }
      for (const day of body.days) {
        for (const slot of day.slots) {
          expect(
            allowed,
            `slot ${slot.start} of ${service.name} falls on its own barber working day`
          ).toContain(day.day);
        }
        checked += day.slots.length;
      }
    }
    expect(checked, 'the local scratch stack exposes at least one slot').toBeGreaterThan(0);
  });

  test('returns an empty 14-day window when the service barber keeps no schedule', async () => {
    // Post-fix contract: no fallback to other barbers' hours, just honest
    // emptiness — the full window with every day's slots array empty.
    const token = scheduleLessServiceToken();
    test.skip(
      token === null,
      'the local scratch stack has no published service whose active barber lacks a schedule'
    );
    if (!token) throw new Error('unreachable: skipped above when null');

    const body = await availability(token);
    expect(body.days).toHaveLength(14);
    for (const day of body.days) expect(day.slots).toEqual([]);
  });
});
