// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  createBookingLookupClient,
  lookupBooking,
  type BookingLookupInput,
} from '~/lib/booking-lookup.server';
import { PublicApiError } from '~/lib/public-http.server';
import type { BookingLookupResult } from '~/types/booking';

type TestInit = RequestInit & { next?: { revalidate?: number } };

const input: BookingLookupInput = {
  slug: 'conexion-barberia',
  nombre: 'Ana',
  apellido: 'Gómez',
  telefono: '+5491123456789',
};

const fullResult: BookingLookupResult = {
  booking: {
    start: '2026-10-21T09:00',
    end: '2026-10-21T10:00',
    durationMinutes: 60,
    price: 12500,
    status: 'confirmado',
    origin: 'web',
    serviceName: 'Corte',
    barberName: 'Tero Jr',
    shopName: 'Conexión Barbería',
    canCancel: true,
  },
  management: {
    token: 'a'.repeat(43),
    expiresAt: '2026-10-21T09:00',
  },
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

describe('createBookingLookupClient', () => {
  it('POSTs the identity with the server slug and no-store, then parses the grant', async () => {
    let seen: TestInit | undefined;
    const mock = await startMock((req, res) => {
      expect(req.url).toBe('/functions/v1/public-booking-lookup');
      expect(req.headers.authorization).toBe('Bearer anon');
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
      });
      req.on('end', () => {
        expect(JSON.parse(raw)).toEqual({
          slug: 'conexion-barberia',
          nombre: 'Ana',
          apellido: 'Gómez',
          telefono: '+5491123456789',
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(fullResult));
      });
    });

    try {
      const client = createBookingLookupClient({
        baseUrl: mock.url,
        anonKey: 'anon',
        fetchImpl: async (url, init) => {
          seen = init as TestInit;
          return fetch(url, init);
        },
      });
      const result = await client.lookup(input);

      expect(result).toEqual(fullResult);
      expect(seen?.method).toBe('POST');
      expect(seen?.cache).toBe('no-store');
      expect(seen?.next).toBeUndefined();
    } finally {
      await mock.close();
    }
  });

  it('rejects a lookup response with a missing or malformed management grant', async () => {
    const malformed = [
      { ...fullResult, management: undefined },
      { ...fullResult, management: { token: '', expiresAt: '2026-10-21T09:00' } },
      { ...fullResult, management: { token: 'a'.repeat(43) } },
    ];

    for (const body of malformed) {
      const client = createBookingLookupClient({
        baseUrl: 'http://127.0.0.1:1',
        anonKey: 'anon',
        fetchImpl: async () => jsonResponse(body),
      });

      await expect(client.lookup(input)).rejects.toBeInstanceOf(PublicApiError);
      await expect(client.lookup(input)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
  });

  it('rejects a malformed booking payload', async () => {
    const client = createBookingLookupClient({
      baseUrl: 'http://127.0.0.1:1',
      anonKey: 'anon',
      fetchImpl: async () => jsonResponse({ ...fullResult, booking: { start: 'x' } }),
    });

    await expect(client.lookup(input)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('surfaces the Edge error code unchanged', async () => {
    const client = createBookingLookupClient({
      baseUrl: 'http://127.0.0.1:1',
      anonKey: 'anon',
      fetchImpl: async () =>
        jsonResponse(
          { error: { code: 'PUBLIC_RESOURCE_NOT_FOUND', message: 'Resource not found', retryable: false } },
          404
        ),
    });

    await expect(client.lookup(input)).rejects.toMatchObject({
      code: 'PUBLIC_RESOURCE_NOT_FOUND',
    });
  });

  it('throws a typed configuration error when no base URL is available', () => {
    const previous = process.env.SUPABASE_URL;
    delete process.env.SUPABASE_URL;
    try {
      expect(() => createBookingLookupClient({})).toThrow(PublicApiError);
      expect(() => createBookingLookupClient({})).toThrow(
        expect.objectContaining({ code: 'CONFIGURATION_ERROR' })
      );
    } finally {
      if (previous !== undefined) process.env.SUPABASE_URL = previous;
    }
  });
});

describe('lookupBooking', () => {
  it('delegates one lookup through the injected client', async () => {
    const calls: BookingLookupInput[] = [];
    const result = await lookupBooking(input, {
      lookup: async (received: BookingLookupInput) => {
        calls.push(received);
        return fullResult;
      },
    } as unknown as ReturnType<typeof createBookingLookupClient>);

    expect(calls).toEqual([input]);
    expect(result.management.token).toBe('a'.repeat(43));
  });
});
