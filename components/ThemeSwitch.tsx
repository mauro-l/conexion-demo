'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { applyTheme, getInitialTheme, toggleTheme, type Theme } from '~/lib/theme';

// No client-side subscription is needed: the snapshot only distinguishes the
// server render (false) from the hydrated client (true), which keeps hydration
// stable while still honoring the stored theme via the lazy initializer.
const subscribe = () => () => {};

/**
 * The only Client Component on the public landing.
 *
 * The initial theme comes from a lazy `useState` initializer so the control
 * agrees with the pre-paint bootstrap script.
 */
export function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme>(() => getInitialTheme());
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );

  useEffect(() => {
    if (mounted) {
      applyTheme(theme);
    }
  }, [theme, mounted]);

  const handleClick = () => {
    setTheme((current) => toggleTheme(current));
  };

  const resolved: Theme = mounted ? theme : 'light';
  const label = resolved === 'light' ? 'Cambiar a tema oscuro' : 'Cambiar a tema claro';

  return (
    <button
      type="button"
      className="icon-btn"
      onClick={handleClick}
      aria-label={label}
      title={label}
    >
      {resolved === 'light' ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}

function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="5" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  );
}
