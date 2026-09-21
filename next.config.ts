import type { NextConfig } from 'next';

/**
 * `NEXT_DIST_DIR` lets the Playwright suite run a second dev server for the
 * unknown-slug not-found fixture without racing the primary server over the
 * same build directory. Production and normal development use the default.
 */
const distDir = process.env.NEXT_DIST_DIR?.trim() || '.next';

const nextConfig: NextConfig = {
  distDir,
};

export default nextConfig;
