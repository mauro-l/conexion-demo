import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ServiceCatalog } from '~/components/public/ServiceCatalog';

describe('ServiceCatalog', () => {
  it('renders services from the DTO with no selector control', () => {
    render(
      <ServiceCatalog
        services={[{ name: 'Corte', durationMinutes: 40, price: 23000, description: 'Incluye' }]}
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
        services={[{ name: 'Barba', durationMinutes: 30, price: 15000, description: null }]}
      />
    );

    expect(screen.getByText('Barba')).toBeInTheDocument();
    expect(screen.queryByText('Qué incluye')).toBeNull();
  });

  it('renders an inert CTA with no link or booking target', () => {
    render(
      <ServiceCatalog
        services={[{ name: 'Corte', durationMinutes: 40, price: 23000, description: null }]}
      />
    );

    const cta = screen.getByRole('button', { name: 'Reservar' });
    expect(cta).toBeInTheDocument();
    expect(cta.closest('a')).toBeNull();
    expect(document.querySelector('a[href*="reservar"]')).toBeNull();
  });
});
