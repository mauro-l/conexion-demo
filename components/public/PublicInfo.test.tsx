import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PublicInfo } from '~/components/public/PublicInfo';
import type { Barberia } from '~/types/public';

function barberia(overrides: Partial<Barberia> = {}): Barberia {
  return {
    name: 'Conexión Barbería',
    description: '',
    address: null,
    hours: null,
    whatsappUrl: null,
    instagramHandle: null,
    instagramUrl: null,
    ...overrides,
  };
}

describe('PublicInfo', () => {
  it('renders only the rows that have values', () => {
    render(
      <PublicInfo
        barberia={barberia({
          address: 'Av. Siempre Viva 742',
          instagramHandle: '@conexion.barber',
        })}
      />
    );

    expect(screen.getByText('Av. Siempre Viva 742')).toBeInTheDocument();
    expect(screen.getByText('@conexion.barber')).toBeInTheDocument();
    expect(screen.queryByText('Contactanos por WhatsApp')).toBeNull();
    expect(document.querySelectorAll('.info-row')).toHaveLength(2);
  });

  it('prefixes the literal Hoy to the database hours value', () => {
    render(<PublicInfo barberia={barberia({ hours: '10:00–20:00' })} />);

    expect(screen.getByText('Hoy 10:00–20:00')).toBeInTheDocument();
  });

  it('renders no fabricated defaults when every nullable field is empty', () => {
    render(<PublicInfo barberia={barberia()} />);

    expect(document.querySelector('.info-list')).toBeNull();
    expect(screen.queryByText('Hoy 10:00–20:00')).toBeNull();
    expect(screen.queryByText('Av. Gral. Mosconi 3429, C1419, CABA')).toBeNull();
  });
});
