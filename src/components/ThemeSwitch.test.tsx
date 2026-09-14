import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeSwitch } from './ThemeSwitch';
import { THEME_STORAGE_KEY } from '../lib/theme';

describe('ThemeSwitch', () => {
  beforeEach(() => {
    document.documentElement.dataset.theme = 'light';
    try {
      window.localStorage.clear();
    } catch {
      // ignore
    }
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
  });

  it('bootstraps the stored dark theme on mount', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    render(<ThemeSwitch />);
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('toggles light to dark and persists the choice', () => {
    render(<ThemeSwitch />);
    expect(document.documentElement.dataset.theme).toBe('light');

    fireEvent.click(screen.getByRole('button'));

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('toggles dark back to light', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    render(<ThemeSwitch />);
    expect(document.documentElement.dataset.theme).toBe('dark');

    fireEvent.click(screen.getByRole('button'));

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });
});
