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

function availability(service: string): Promise<AvailabilityBody> {
  return publicGet<AvailabilityBody>(
    `/functions/v1/public-availability?slug=${encodeURIComponent(
      requiredEnv('BARBERSHOP_PUBLIC_SLUG')
    )}&service=${encodeURIComponent(service)}`
  );
}

const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

/** Same text the island renders for the final summary, so the test can target a day. */
function dayTitle(day: AvailabilityDay): string {
  const [, month, dayOfMonth] = day.date.split('-');
  return `${WEEKDAYS[day.day]} ${Number(dayOfMonth)}/${Number(month)}`;
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

  test('reaches the read-only end of flow without creating, updating, or reserving anything', async ({
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
    await page.locator('.availability-slots .availability-slot').first().click();

    const final = page.locator('.availability-final');
    await expect(final).toContainText(dayTitle(target));
    await expect(final).toContainText('todavía no se reservó nada');
    await expect(final).toContainText('próxima etapa');

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
});
