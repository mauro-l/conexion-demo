// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  createPublicApiClient,
  loadPublicPageData,
  PublicApiError,
} from '~/lib/public-api.server';
import type { Catalog, Context } from '~/types/public';

type TestInit = RequestInit & { next?: { revalidate?: number } };

const notFoundBody = {
  error: { code: 'PUBLIC_RESOURCE_NOT_FOUND', message: 'Resource not found', retryable: false },
};

const fullContext: Context = {
  barberia: {
    name: 'Conexión',
    description: 'Demo',
    address: 'Av. Siempre Viva 742',
    hours: 'Hoy 10:00–20:00',
    whatsappUrl: '#',
    instagramHandle: '@conexion.barber',
    instagramUrl: 'https://instagram.com/conexion.barber',
  },
  barbers: [{ name: 'Juan', alias: 'Juan', description: null, photoUrl: null }],
};

const fullCatalog: Catalog = {
  services: [{ name: 'Corte', durationMinutes: 40, price: 23000, description: 'Incluye' }],
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

describe('createPublicApiClient', () => {
  it('returns the context DTO with the full field set, keeping barbers[]', async () => {
    const mock = await startMock((req, res) => {
      expect(req.url).toMatch(/^\/functions\/v1\/public-context\?slug=conexion-barberia$/);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(fullContext));
    });
    const client = createPublicApiClient({ baseUrl: mock.url });
    const result = await client.context('conexion-barberia');
    expect(result).toEqual(fullContext);
    expect(Object.keys(result.barberia).sort()).toEqual(
      ['address', 'description', 'hours', 'instagramHandle', 'instagramUrl', 'name', 'whatsappUrl'].sort()
    );
    expect(result.barbers).toHaveLength(1);
    await mock.close();
  });

  it('returns the catalog DTO with numeric duration and price', async () => {
    const mock = await startMock((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(fullCatalog));
    });
    const client = createPublicApiClient({ baseUrl: mock.url });
    await expect(client.catalog('conexion-barberia')).resolves.toEqual(fullCatalog);
    await mock.close();
  });

  it('throws an identical PublicApiError for unknown and unpublished slugs', async () => {
    const mock = await startMock((_req, res) => {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(notFoundBody));
    });
    const client = createPublicApiClient({ baseUrl: mock.url });
    const [a, b] = await Promise.all([
      client.context('unknown').catch((e: unknown) => e),
      client.context('unpublished').catch((e: unknown) => e),
    ]);
    expect(a).toBeInstanceOf(PublicApiError);
    expect(b).toBeInstanceOf(PublicApiError);
    expect({ code: (a as PublicApiError).code, message: (a as PublicApiError).message, retryable: (a as PublicApiError).retryable }).toEqual(notFoundBody.error);
    expect({ code: (b as PublicApiError).code, message: (b as PublicApiError).message, retryable: (b as PublicApiError).retryable }).toEqual(notFoundBody.error);
    await mock.close();
  });

  it('rejects an invalid slug format before any network call', async () => {
    await expect(
      createPublicApiClient({ baseUrl: 'http://127.0.0.1:1' }).context('Bad Slug!')
    ).rejects.toBeInstanceOf(PublicApiError);
  });

  it('calls the Edge Function path, never PostgREST', async () => {
    const mock = await startMock((req, res) => {
      expect(req.url).toMatch(/^\/functions\/v1\//);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(fullContext));
    });
    await createPublicApiClient({ baseUrl: mock.url }).context('conexion-barberia');
    await mock.close();
  });

  it('marks both public GETs with a 60-second revalidation bound', async () => {
    const calls: string[] = [];
    const revalidations: Array<number | undefined> = [];
    const fetchImpl = async (url: string, init?: TestInit): Promise<Response> => {
      calls.push(url);
      revalidations.push(init?.next?.revalidate);
      return jsonResponse(url.includes('public-context') ? fullContext : fullCatalog);
    };
    const client = createPublicApiClient({ baseUrl: 'https://example.test', anonKey: 'anon', fetchImpl });
    await client.context('conexion-barberia');
    await client.catalog('conexion-barberia');

    expect(calls).toHaveLength(2);
    for (const url of calls) expect(url).toMatch(/^https:\/\/example\.test\/functions\/v1\//);
    expect(revalidations).toEqual([60, 60]);
  });

  it('maps an aborted read to a TIMEOUT PublicApiError', async () => {
    const mock = await startMock(() => {
      // Intentionally never respond.
    });
    const client = createPublicApiClient({ baseUrl: mock.url, timeoutMs: 25 });
    const error = await client.context('conexion-barberia').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PublicApiError);
    expect((error as PublicApiError).code).toBe('TIMEOUT');
    await mock.close();
  });

  it('rejects a malformed context response', async () => {
    const mock = await startMock((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ barberia: {}, barbers: [] }));
    });
    const client = createPublicApiClient({ baseUrl: mock.url });
    const error = await client.context('conexion-barberia').catch((e: unknown) => e);
    expect((error as PublicApiError).code).toBe('INVALID_RESPONSE');
    await mock.close();
  });

  it('rejects a malformed catalog response', async () => {
    const mock = await startMock((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ services: [{ name: 'Corte', durationMinutes: '40' }] }));
    });
    const client = createPublicApiClient({ baseUrl: mock.url });
    const error = await client.catalog('conexion-barberia').catch((e: unknown) => e);
    expect((error as PublicApiError).code).toBe('INVALID_RESPONSE');
    await mock.close();
  });
});

describe('loadPublicPageData', () => {
  it('returns both DTOs when both reads succeed', async () => {
    const fetchImpl = async (url: string): Promise<Response> =>
      jsonResponse(url.includes('public-context') ? fullContext : fullCatalog);
    const client = createPublicApiClient({ baseUrl: 'https://example.test', fetchImpl });
    await expect(loadPublicPageData('conexion-barberia', client)).resolves.toEqual({
      context: fullContext,
      catalog: fullCatalog,
    });
  });

  it('lets a non-404 failure win over a not-found', async () => {
    const fetchImpl = async (url: string): Promise<Response> =>
      url.includes('public-context')
        ? jsonResponse({ error: { code: 'INTERNAL_ERROR', message: 'boom', retryable: false } }, 500)
        : jsonResponse(notFoundBody, 404);
    const client = createPublicApiClient({ baseUrl: 'https://example.test', fetchImpl });
    await expect(loadPublicPageData('conexion-barberia', client)).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    });
  });

  it('surfaces only PUBLIC_RESOURCE_NOT_FOUND when every read is not-found', async () => {
    const fetchImpl = async (): Promise<Response> => jsonResponse(notFoundBody, 404);
    const client = createPublicApiClient({ baseUrl: 'https://example.test', fetchImpl });
    await expect(loadPublicPageData('conexion-barberia', client)).rejects.toMatchObject({
      code: 'PUBLIC_RESOURCE_NOT_FOUND',
    });
  });
});
