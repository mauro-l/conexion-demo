import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PublicHeader, splitLogoName } from '~/components/public/PublicHeader';

describe('splitLogoName', () => {
  it('keeps every word but the last in the plain head', () => {
    expect(splitLogoName('Conexión Barbería')).toEqual({ head: 'Conexión', tail: 'Barbería' });
  });

  it('returns a null tail for a single-word name', () => {
    expect(splitLogoName('Barbería')).toEqual({ head: 'Barbería', tail: null });
  });

  it('trims and collapses surrounding whitespace before splitting', () => {
    expect(splitLogoName('  Don  José  Cortes  ')).toEqual({
      head: 'Don José',
      tail: 'Cortes',
    });
  });

  it('treats an empty name as a nameless logo', () => {
    expect(splitLogoName('   ')).toEqual({ head: '', tail: null });
  });
});

describe('PublicHeader', () => {
  it('renders the database shop name with only the last word in the brass span', () => {
    const { container } = render(<PublicHeader name="Conexión Barbería" />);

    const logo = container.querySelector('.logo');
    expect(logo?.textContent).toBe('Conexión Barbería');

    // The two-tone rule: the last word alone is wrapped, and the existing
    // `.logo span` rule binds that span to var(--brass) without a new class.
    const span = logo?.querySelector('span');
    expect(span).not.toBeNull();
    expect(span?.textContent).toBe('Barbería');
  });

  it('renders a single-word name plain with no span', () => {
    const { container } = render(<PublicHeader name="Barbería" />);

    const logo = container.querySelector('.logo');
    expect(logo?.textContent).toBe('Barbería');
    expect(logo?.querySelector('span')).toBeNull();
  });

  it('renders no fabricated brand when the not-found fallback has no name', () => {
    const { container } = render(<PublicHeader />);

    const logo = container.querySelector('.logo');
    expect(logo?.textContent).toBe('');
    expect(logo?.querySelector('span')).toBeNull();
  });
});
