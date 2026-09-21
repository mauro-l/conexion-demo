// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  TOKEN_TTL_SECONDS,
  signAvailabilityToken,
  verifyAvailabilityToken,
  type AvailabilityTokenClaims,
} from '~/supabase/functions/_shared/availability-token';

// `iat` is seconds within the day so the 12:00 → 12:10:00 boundary reads directly.
const IAT = 12 * 60 * 60; // 12:00:00
const EXPIRES_AT = IAT + 600; // 12:10:00
const SECRET = 'test-secret';
const claims: AvailabilityTokenClaims = {
  slug: 'conexion-barberia',
  service: 'a'.repeat(32),
  start: '2026-09-21T12:00',
  end: '2026-09-21T12:40',
};

function base64Url(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeJson(segment: string): Record<string, unknown> {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return JSON.parse(
    new TextDecoder().decode(Uint8Array.from(atob(padded), (char) => char.charCodeAt(0)))
  );
}

/** Builds a structurally valid token for arbitrary header/payload JSON. */
function craft(header: unknown, payload: unknown): string {
  const signingInput = `${base64Url(header)}.${base64Url(payload)}`;
  const signature = createHmac('sha256', SECRET)
    .update(signingInput)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${signingInput}.${signature}`;
}

describe('signAvailabilityToken', () => {
  it('carries exactly the six public claims, no version, and exp = iat + 600', async () => {
    const token = await signAvailabilityToken(claims, SECRET, IAT);
    const payload = decodeJson(token.split('.')[1]);

    expect(Object.keys(payload).sort()).toEqual(['end', 'exp', 'iat', 'service', 'slug', 'start']);
    expect('v' in payload).toBe(false);
    expect(TOKEN_TTL_SECONDS).toBe(600);
    expect(payload).toMatchObject({ ...claims, iat: IAT, exp: IAT + TOKEN_TTL_SECONDS });
  });

  it('emits three unpadded base64url segments with a pinned HS256 header', async () => {
    const token = await signAvailabilityToken(claims, SECRET, IAT);
    const parts = token.split('.');

    expect(parts).toHaveLength(3);
    for (const part of parts) {
      expect(part).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(part).not.toContain('=');
    }
    expect(decodeJson(parts[0])).toEqual({ alg: 'HS256', typ: 'JWT' });

    // Pinned against the pre-memoization implementation: caching the imported
    // key must not change a single signed byte for the same claims/secret/iat.
    expect(token).toBe(
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
        'eyJzbHVnIjoiY29uZXhpb24tYmFyYmVyaWEiLCJzZXJ2aWNlIjoiYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFh' +
        'YWFhYWEiLCJzdGFydCI6IjIwMjYtMDktMjFUMTI6MDAiLCJlbmQiOiIyMDI2LTA5LTIxVDEyOjQwIiwiaWF0Ijo0' +
        'MzIwMCwiZXhwIjo0MzgwMH0.' +
        'Jywg29NZHDhx6P-mP1nUZKJUEkKXvJtim1R9pTEoU6s'
    );
  });
});

describe('verifyAvailabilityToken', () => {
  it('accepts the token under its issuing secret and rejects a different secret', async () => {
    const token = await signAvailabilityToken(claims, SECRET, IAT);

    expect(await verifyAvailabilityToken(token, SECRET, IAT + 1)).toEqual({
      ok: true,
      payload: { ...claims, iat: IAT, exp: EXPIRES_AT },
    });
    expect(await verifyAvailabilityToken(token, 'a-different-secret', IAT + 1)).toEqual({
      ok: false,
      reason: 'invalid_signature',
    });
  });

  // SDD task 4.1: the 12:00 → 12:10:01 expiry rejection, with no positive tolerance.
  it('is expired at 12:10:01 and exactly at 12:10:00, but valid at 12:09:59', async () => {
    const token = await signAvailabilityToken(claims, SECRET, IAT);

    expect(await verifyAvailabilityToken(token, SECRET, EXPIRES_AT + 1)).toEqual({
      ok: false,
      reason: 'expired',
    });
    expect(await verifyAvailabilityToken(token, SECRET, EXPIRES_AT)).toEqual({
      ok: false,
      reason: 'expired',
    });
    expect((await verifyAvailabilityToken(token, SECRET, EXPIRES_AT - 1)).ok).toBe(true);
  });

  it('allows up to five seconds of skew before iat and rejects anything earlier', async () => {
    const token = await signAvailabilityToken(claims, SECRET, IAT);

    expect((await verifyAvailabilityToken(token, SECRET, IAT - 3)).ok).toBe(true);
    expect((await verifyAvailabilityToken(token, SECRET, IAT - 5)).ok).toBe(true);
    expect(await verifyAvailabilityToken(token, SECRET, IAT - 6)).toEqual({
      ok: false,
      reason: 'not_yet_valid',
    });
  });

  it('rejects malformed shapes and invalid base64url in any segment', async () => {
    const token = await signAvailabilityToken(claims, SECRET, IAT);
    const [header, payload, signature] = token.split('.');
    const malformed = [
      'only-one',
      'a.b',
      'a.b.c.d',
      '..',
      `@@@.${payload}.${signature}`,
      `${header}.not!base64.${signature}`,
      `${header}.${payload}.***`,
    ];

    for (const candidate of malformed) {
      expect(await verifyAvailabilityToken(candidate, SECRET, IAT)).toEqual({
        ok: false,
        reason: 'malformed',
      });
    }
  });

  it('rejects a wrong or missing header algorithm', async () => {
    const payload = { ...claims, iat: IAT, exp: EXPIRES_AT };

    for (const header of [{ alg: 'none', typ: 'JWT' }, { typ: 'JWT' }]) {
      expect(await verifyAvailabilityToken(craft(header, payload), SECRET, IAT)).toEqual({
        ok: false,
        reason: 'unsupported_algorithm',
      });
    }
  });

  it('rejects a correctly signed payload that is not the required shape', async () => {
    const withoutExp = { ...claims, iat: IAT };

    expect(await verifyAvailabilityToken(craft({ alg: 'HS256' }, 'a string'), SECRET, IAT)).toEqual({
      ok: false,
      reason: 'malformed',
    });
    expect(await verifyAvailabilityToken(craft({ alg: 'HS256' }, withoutExp), SECRET, IAT)).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('rejects a corrupted or truncated signature', async () => {
    const token = await signAvailabilityToken(claims, SECRET, IAT);
    const [header, payload, signature] = token.split('.');
    const flipped = signature.slice(0, -1) + (signature.endsWith('A') ? 'B' : 'A');

    expect(await verifyAvailabilityToken(`${header}.${payload}.${flipped}`, SECRET, IAT)).toEqual({
      ok: false,
      reason: 'invalid_signature',
    });
    expect(await verifyAvailabilityToken(`${token}A`, SECRET, IAT)).toEqual({
      ok: false,
      reason: 'invalid_signature',
    });
  });

  it('rejects a tampered payload that still carries the original signature', async () => {
    const token = await signAvailabilityToken(claims, SECRET, IAT);
    const [header, payload, signature] = token.split('.');
    const tampered = { ...decodeJson(payload), start: '2026-09-21T12:30' };

    expect(
      await verifyAvailabilityToken(`${header}.${base64Url(tampered)}.${signature}`, SECRET, IAT + 1)
    ).toEqual({ ok: false, reason: 'invalid_signature' });
  });
});
