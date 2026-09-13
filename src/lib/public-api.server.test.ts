import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import { createPublicApiClient, PublicApiError } from './public-api.server';
import type { Catalog, Context } from '../types/public';

function startMock(
  handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void
) {
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

describe('createPublicApiClient', () => {
  it('returns context DTO with exact keys', async () => {
    const context: Context = {
      barberia: { name: 'Conexión', description: 'Demo' },
      barbers: [{ name: 'Juan', alias: 'Juan', description: null, photoUrl: null }],
    };
    const mock = await startMock((req, res) => {
      expect(req.url).toMatch(/^\/functions\/v1\/public-context\?slug=conexion-barberia$/);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(context));
    });
    const client = createPublicApiClient({ baseUrl: mock.url });
    await expect(client.context('conexion-barberia')).resolves.toEqual(context);
    await mock.close();
  });

  it('returns catalog DTO with numeric duration and price', async () => {
    const catalog: Catalog = {
      services: [{ name: 'Corte', durationMinutes: 40, price: 23000 }],
    };
    const mock = await startMock((req, res) => {
      expect(req.url).toMatch(/^\/functions\/v1\/public-catalog\?slug=conexion-barberia$/);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(catalog));
    });
    const client = createPublicApiClient({ baseUrl: mock.url });
    await expect(client.catalog('conexion-barberia')).resolves.toEqual(catalog);
    await mock.close();
  });

  it('throws identical PublicApiError for unknown and unpublished slugs', async () => {
    const notFound = {
      error: { code: 'PUBLIC_RESOURCE_NOT_FOUND', message: 'Resource not found', retryable: false },
    };
    const mock = await startMock((_req, res) => {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(notFound));
    });
    const client = createPublicApiClient({ baseUrl: mock.url });
    const [a, b] = await Promise.all([
      client.context('unknown').catch((e: unknown) => e),
      client.context('unpublished').catch((e: unknown) => e),
    ]);
    expect(a).toBeInstanceOf(PublicApiError);
    expect(b).toBeInstanceOf(PublicApiError);
    const errA = a as PublicApiError;
    const errB = b as PublicApiError;
    expect({ code: errA.code, message: errA.message, retryable: errA.retryable }).toEqual(notFound.error);
    expect({ code: errB.code, message: errB.message, retryable: errB.retryable }).toEqual(notFound.error);
    await mock.close();
  });

  it('rejects invalid slug format before network call', async () => {
    await expect(
      createPublicApiClient({ baseUrl: 'http://x' }).context('Bad Slug!')
    ).rejects.toBeInstanceOf(PublicApiError);
  });

  it('calls Edge Function path, not PostgREST table path', async () => {
    const mock = await startMock((req, res) => {
      expect(req.url).toMatch(/^\/functions\/v1\//);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ barberia: { name: '', description: '' }, barbers: [] }));
    });
    await createPublicApiClient({ baseUrl: mock.url }).context('slug');
    await mock.close();
  });
});
