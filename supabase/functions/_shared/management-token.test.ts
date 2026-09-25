// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { generateManagementToken, hashManagementToken } from '~/supabase/functions/_shared/management-token';

describe('generateManagementToken', () => {
  it('generates distinct 32-byte unpadded base64url tokens', () => {
    const first = generateManagementToken();
    const second = generateManagementToken();

    expect(first).toHaveLength(43);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(first, 'base64url')).toHaveLength(32);
    expect(second).not.toBe(first);
  });
});

describe('hashManagementToken', () => {
  it('returns deterministic lowercase SHA-256 digests for known vectors', async () => {
    const emptyHash = await hashManagementToken('');
    const abcHash = await hashManagementToken('abc');

    expect(emptyHash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(abcHash).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(emptyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(abcHash).toMatch(/^[a-f0-9]{64}$/);
    expect(await hashManagementToken('abc')).toBe(abcHash);
  });

  it('hashes UTF-8 bytes and produces different digests for different tokens', async () => {
    const token = 'token-ñ-🔒';
    const digest = createHash('sha256').update(token, 'utf8').digest('hex');

    expect(await hashManagementToken(token)).toBe(digest);
    expect(await hashManagementToken('token-one')).not.toBe(await hashManagementToken('token-two'));
  });
});
