import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ServiceCatalog } from '~/components/public/ServiceCatalog';

describe('ServiceCatalog', () => {
  it('renders services from the DTO with no selector control', () => {
    render(
      <ServiceCatalog
        services={[
          {
            publicServiceToken: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
            name: 'Corte',
            durationMinutes: 40,
            price: 23000,
            description: 'Incluye',
          },
        ]}
      />
    );

    expect(screen.getByText('Corte')).toBeInTheDocument();
    expect(screen.getByText('40 min')).toBeInTheDocument();
    expect(screen.getByText('Qué incluye')).toBeInTheDocument();
    expect(document.querySelector('.prof-select')).toBeNull();
  });

  it('omits the description disclosure when the DTO has none', () => {
    render(
      <ServiceCatalog
        services={[
          {
            publicServiceToken: 'b1b2c3d4e5f60718293a4b5c6d7e8f90',
            name: 'Barba',
            durationMinutes: 30,
            price: 15000,
            description: null,
          },
        ]}
      />
    );

    expect(screen.getByText('Barba')).toBeInTheDocument();
    expect(screen.queryByText('Qué incluye')).toBeNull();
  });

  it('navigates the CTA to /reservar with the encoded service token', () => {
    render(
      <ServiceCatalog
        services={[
          {
            publicServiceToken: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
            name: 'Corte',
            durationMinutes: 40,
            price: 23000,
            description: null,
          },
        ]}
      />
    );

    const cta = screen.getByRole('link', { name: 'Reservar' });
    expect(cta).toHaveAttribute(
      'href',
      `/reservar?service=${encodeURIComponent('a1b2c3d4e5f60718293a4b5c6d7e8f90')}`
    );
  });
});
