import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { getSiteOrigin } from '~/lib/site-config.server';
import './globals.css';

/**
 * Pre-paint theme bootstrap. It reads the preserved `conexion-theme` key and
 * the system preference, then sets `data-theme` before the first paint so the
 * wrong theme is never displayed. Kept as a plain string literal so it can be
 * inlined in `<head>` without bundling.
 */
const THEME_BOOTSTRAP = `(function(){var key='conexion-theme';var theme='light';try{var stored=window.localStorage.getItem(key);if(stored==='light'||stored==='dark'){theme=stored;}else if(window.matchMedia('(prefers-color-scheme: dark)').matches){theme='dark';}}catch(e){}document.documentElement.dataset.theme=theme;})();`;

export const metadata: Metadata = {
  metadataBase: getSiteOrigin(),
  title: 'Conexión Barbería | Reservá tu turno',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" data-theme="light" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* App Router applies the root layout to every route, so the pages/_document guidance behind this rule does not apply. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600&family=Inter:wght@400;500;600&family=Oswald:wght@500;600;700&family=Playfair+Display:ital,wght@0,600;0,700;0,800;1,500;1,600&display=swap"
          rel="stylesheet"
        />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
