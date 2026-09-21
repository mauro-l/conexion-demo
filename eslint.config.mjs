import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const config = [
  {
    ignores: ['dist/**', '.astro/**', '.next*/**', 'test-results/**', 'playwright-report/**'],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
];

export default config;
