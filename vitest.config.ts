import { defineConfig } from 'vitest/config';
import path from 'node:path';

// `~/*` maps to the repository root (`./*`), matching tsconfig.json.
const root = path.resolve(process.cwd(), './');

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      '~': root,
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: [
      'app/**/*.{test,spec}.{ts,tsx}',
      'components/**/*.{test,spec}.{ts,tsx}',
      'lib/**/*.{test,spec}.{ts,tsx}',
      'types/**/*.{test,spec}.{ts,tsx}',
      'supabase/**/*.{test,spec}.{ts,tsx}',
    ],
    exclude: ['tests/e2e/**', 'node_modules/**', '.next/**'],
    setupFiles: ['./vitest.setup.ts'],
  },
});
