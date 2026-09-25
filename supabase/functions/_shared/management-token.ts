/**
 * Opaque management tokens for booking access. The raw token is generated and
 * held only by the Edge function; Postgres receives and stores only its hash.
 * This module uses cross-runtime globals so the Edge and Vitest/Node share the
 * same implementation.
 */

/** 256 bits of entropy, encoded as 43 unpadded base64url characters. */
export const MANAGEMENT_TOKEN_BYTES = 32;
export const MANAGEMENT_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** Generate an opaque, unpadded base64url token from cryptographically secure bytes. */
export function generateManagementToken(): string {
  const bytes = new Uint8Array(MANAGEMENT_TOKEN_BYTES);
  globalThis.crypto.getRandomValues(bytes);

  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Return the lowercase hexadecimal SHA-256 digest of a token. */
export async function hashManagementToken(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
