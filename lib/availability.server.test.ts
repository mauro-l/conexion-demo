// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createAvailabilityClient, loadAvailability } from '~/lib/availability.server';
import { PublicApiError } from '~/lib/public-http.server';
import type { Availability } from '~/types/booking';

type TestInit = RequestInit & { next?: { revalidate?: number } };

const fullAvailability: Availability = {
  service: {
    publicServiceToken: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    name: 'Corte',
    durationMinutes: 40,
    price: 23000,
    description: 'Incluye',
  },
  days: [
    {
      date: '2026-09-21',
      day: 1,
      slots: [
        { start: '2026-09-21T09:00', end: '2026-09-21T09:40', availabilityToken: 'tok.one.sig' },
        { start: '2026-09-21T09:30', end: '2026-09-21T10:10', availabilityToken: 'tok.two.sig' },
      ],
    },
    { date: '2026-09-22', day: 2, slots: [] },
  ],
};

function startMock(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const notFoundBody = {
  error: { code: 'PUBLIC_RESOURCE_NOT_FOUND', message: 'Resource not found', retryable: false },
};

describe('createAvailabilityClient', () => {
  it('parses a full availability DTO including the service snapshot and slot tokens', async () => {
    const mock = await startMock((req, res) => {
      expect(req.url).toMatch(
        /^\/functions\/v1\/public-availability\?slug=conexion-barberia&service=a1b2c3d4e5f60718293a4b5c6d7e8f90$/
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(fullAvailability));
    });

    try {
      const client = createAvailabilityClient({ baseUrl: mock.url, anonKey: 'anon' });
      const availability = await client.availability(
        'conexion-barberia',
        'a1b2c3d4e5f60718293a4b5c6d7e8f90'
      );

      expect(availability.service.name).toBe('Corte');
      expect(availability.service.durationMinutes).toBe(40);
      expect(availability.days).toHaveLength(2);
      expect(availability.days[0].slots[0]).toEqual({
        start: '2026-09-21T09:00',
        end: '2026-09-21T09:40',
        availabilityToken: 'tok.one.sig',
      });
      expect(availability.days[1].slots).toEqual([]);
    } finally {
      await mock.close();
    }
  });

  it('requests the availability read with no-store and never with a revalidate bound', async () => {
    let seen: TestInit | undefined;
    const mock = await startMock((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(fullAvailability));
    });

    try {
      const client = createAvailabilityClient({
        baseUrl: mock.url,
        anonKey: 'anon',
        fetchImpl: async (_input, init) => {
          seen = init as TestInit;
          return jsonResponse(fullAvailability);
        },
      });

      await client.availability('conexion-barberia', 'a1b2c3d4e5f60718293a4b5c6d7e8f90');

      expect(seen?.cache).toBe('no-store');
      expect(seen?.next).toBeUndefined();
    } finally {
      await mock.close();
    }
  });

  it('rejects an invalid slug format before any network call', async () => {
    let called = false;
    const client = createAvailabilityClient({
      baseUrl: 'http://127.0.0.1:1',
      anonKey: 'anon',
      fetchImpl: async () => {
        called = true;
        return jsonResponse(fullAvailability);
      },
    });

    await expect(client.availability('Bad Slug', 'token')).rejects.toBeInstanceOf(PublicApiError);
    expect(called).toBe(false);
  });

  it('surfaces the Edge PUBLIC_RESOURCE_NOT_FOUND code unchanged', async () => {
    const client = createAvailabilityClient({
      baseUrl: 'http://127.0.0.1:1',
      anonKey: 'anon',
      fetchImpl: async () => jsonResponse(notFoundBody, 404),
    });

    await expect(client.availability('conexion-barberia', 'tok')).rejects.toMatchObject({
      code: 'PUBLIC_RESOURCE_NOT_FOUND',
    });
  });

  it('surfaces the Edge INVALID_INPUT code unchanged so callers can map it to not-found', async () => {
    const client = createAvailabilityClient({
      baseUrl: 'http://127.0.0.1:1',
      anonKey: 'anon',
      fetchImpl: async () =>
        jsonResponse(
          { error: { code: 'INVALID_INPUT', message: 'bad token', retryable: false } },
          400
        ),
    });

    await expect(client.availability('conexion-barberia', 'garbage')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });

  it('rejects a response whose service snapshot is missing', async () => {
    const client = createAvailabilityClient({
      baseUrl: 'http://127.0.0.1:1',
      anonKey: 'anon',
      fetchImpl: async () => jsonResponse({ days: [] }),
    });

    await expect(client.availability('conexion-barberia', 'tok')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('rejects a slot without its availabilityToken', async () => {
    const client = createAvailabilityClient({
      baseUrl: 'http://127.0.0.1:1',
      anonKey: 'anon',
      fetchImpl: async () =>
        jsonResponse({
          service: fullAvailability.service,
          days: [
            {
              date: '2026-09-21',
              day: 1,
              slots: [{ start: '2026-09-21T09:00', end: '2026-09-21T09:40' }],
            },
          ],
        }),
    });

    await expect(client.availability('conexion-barberia', 'tok')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('maps an aborted read to a TIMEOUT PublicApiError', async () => {
    const client = createAvailabilityClient({
      baseUrl: 'http://127.0.0.1:1',
      anonKey: 'anon',
      timeoutMs: 5,
      fetchImpl: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          );
        }),
    });

    await expect(client.availability('conexion-barberia', 'tok')).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
  });

  it('fails clearly when SUPABASE_URL is not configured', () => {
    expect(() => createAvailabilityClient({ baseUrl: '', anonKey: 'anon' })).toThrow(
      PublicApiError
    );
  });
});

describe('loadAvailability', () => {
  it('delegates one availability read through the injected client', async () => {
    const calls: Array<[string, string]> = [];
    const availability = await loadAvailability('conexion-barberia', 'tok', {
      availability: async (slug: string, service: string) => {
        calls.push([slug, service]);
        return fullAvailability;
      },
    } as unknown as ReturnType<typeof createAvailabilityClient>);

    expect(calls).toEqual([['conexion-barberia', 'tok']]);
    expect(availability.service.publicServiceToken).toBe('a1b2c3d4e5f60718293a4b5c6d7e8f90');
  });
});
