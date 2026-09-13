import type { Catalog, Context, PublicError } from '../types/public';

export class PublicApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = 'PublicApiError';
  }
}

const SLUG_RE = /^[a-z0-9-]{1,63}$/;

function validateSlug(slug: string): void {
  if (!SLUG_RE.test(slug)) {
    throw new PublicApiError('INVALID_INPUT', 'Invalid slug');
  }
}

function envVar(name: keyof ImportMetaEnv): string | undefined {
  return (import.meta as { env?: ImportMetaEnv }).env?.[name];
}

export type PublicApiClientOptions = {
  baseUrl?: string;
  anonKey?: string;
};

export function createPublicApiClient(options: PublicApiClientOptions = {}) {
  const baseUrl = (options.baseUrl ?? envVar('PUBLIC_SUPABASE_URL') ?? '')
    .replace(/\/$/, '');
  const anonKey = options.anonKey ?? envVar('PUBLIC_SUPABASE_ANON_KEY');

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (anonKey) headers.Authorization = `Bearer ${anonKey}`;

  async function fetchJson<T>(
    slug: string,
    fn: 'public-context' | 'public-catalog'
  ): Promise<T> {
    validateSlug(slug);
    const url = `${baseUrl}/functions/v1/${fn}?slug=${encodeURIComponent(slug)}`;
    const res = await fetch(url, { method: 'GET', headers });
    const body = (await res.json()) as unknown;
    if (!res.ok) {
      const err = body as PublicError | undefined;
      throw new PublicApiError(
        err?.error?.code ?? 'INTERNAL_ERROR',
        err?.error?.message ?? 'Request failed',
        err?.error?.retryable ?? false
      );
    }
    return body as T;
  }

  return {
    context: (slug: string) => fetchJson<Context>(slug, 'public-context'),
    catalog: (slug: string) => fetchJson<Catalog>(slug, 'public-catalog'),
  };
}
