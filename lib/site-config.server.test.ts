// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest';
import { getConfiguredSlug, getSiteOrigin } from '~/lib/site-config.server';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getConfiguredSlug', () => {
  it('returns the configured server-only slug', () => {
    vi.stubEnv('BARBERSHOP_PUBLIC_SLUG', '  conexion-barberia  ');
    expect(getConfiguredSlug()).toBe('conexion-barberia');
  });

  it('fails clearly when the slug is missing', () => {
    vi.stubEnv('BARBERSHOP_PUBLIC_SLUG', '');
    expect(() => getConfiguredSlug()).toThrow(/BARBERSHOP_PUBLIC_SLUG/);
  });

  it('fails clearly when the slug is malformed', () => {
    vi.stubEnv('BARBERSHOP_PUBLIC_SLUG', 'Not A Slug!');
    expect(() => getConfiguredSlug()).toThrow(/BARBERSHOP_PUBLIC_SLUG/);
  });
});

describe('getSiteOrigin', () => {
  it('returns the configured origin as a URL', () => {
    vi.stubEnv('PUBLIC_SITE_ORIGIN', 'https://barberia.example');
    expect(getSiteOrigin().toString()).toBe('https://barberia.example/');
  });

  it('fails clearly on a malformed origin', () => {
    vi.stubEnv('PUBLIC_SITE_ORIGIN', 'not-a-url');
    expect(() => getSiteOrigin()).toThrow(/PUBLIC_SITE_ORIGIN/);
  });

  it('falls back to localhost outside production', () => {
    vi.stubEnv('PUBLIC_SITE_ORIGIN', '');
    vi.stubEnv('NODE_ENV', 'development');
    expect(getSiteOrigin().toString()).toBe('http://localhost:3000/');
  });

  it('fails clearly in production without a configured origin', () => {
    vi.stubEnv('PUBLIC_SITE_ORIGIN', '');
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => getSiteOrigin()).toThrow(/PUBLIC_SITE_ORIGIN/);
  });
});
