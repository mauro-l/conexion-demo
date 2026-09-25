// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  createBookingManageClient,
  loadBookingSummary,
} from '~/lib/booking-manage.server';
import { PublicApiError } from '~/lib/public-http.server';
import type { ManagedBooking } from '~/types/booking';

type TestInit = RequestInit & { next?: { revalidate?: number } };

const fullBooking: { booking: ManagedBooking } = {
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

describe('createBookingManageClient', () => {
  it('parses a valid summary and requests the encoded token with anon auth and no-store', async () => {
    let seen: TestInit | undefined;
    const token = 'token /?&';
    const mock = await startMock((req, res) => {
      expect(req.url).toBe(
        `/functions/v1/public-booking-manage?token=${encodeURIComponent(token)}`
      );
      expect(req.headers.authorization).toBe('Bearer anon');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(fullBooking));
    });

    try {
      const client = createBookingManageClient({
        baseUrl: mock.url,
        anonKey: 'anon',
        fetchImpl: async (input, init) => {
          seen = init as TestInit;
          return fetch(input, init);
        },
      });
      const result = await client.manage(token);

      expect(result).toEqual(fullBooking);
      expect(seen?.method).toBe('GET');
      expect(seen?.cache).toBe('no-store');
      expect(seen?.next).toBeUndefined();
    } finally {
      await mock.close();
    }
  });

  it('rejects management summaries with missing or incorrectly typed fields', async () => {
    const malformed = [
      { booking: { ...fullBooking.booking, serviceName: undefined } },
      { booking: { ...fullBooking.booking, canCancel: 'true' } },
    ];

    for (const body of malformed) {
      const client = createBookingManageClient({
        baseUrl: 'http://127.0.0.1:1',
        anonKey: 'anon',
        fetchImpl: async () => jsonResponse(body),
      });

      await expect(client.manage('token')).rejects.toBeInstanceOf(PublicApiError);
      await expect(client.manage('token')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
  });

  it('surfaces the Edge error code unchanged', async () => {
    const client = createBookingManageClient({
      baseUrl: 'http://127.0.0.1:1',
      anonKey: 'anon',
      fetchImpl: async () =>
        jsonResponse(
          { error: { code: 'TOKEN_EXPIRED', message: 'Expired', retryable: false } },
          410
        ),
    });

    await expect(client.manage('token')).rejects.toMatchObject({
      code: 'TOKEN_EXPIRED',
    });
  });
});

describe('loadBookingSummary', () => {
  it('delegates one management read through the injected client', async () => {
    const calls: string[] = [];
    const result = await loadBookingSummary('management-token', {
      manage: async (token: string) => {
        calls.push(token);
        return fullBooking;
      },
    } as unknown as ReturnType<typeof createBookingManageClient>);

    expect(calls).toEqual(['management-token']);
    expect(result.booking.serviceName).toBe('Corte');
  });
});
