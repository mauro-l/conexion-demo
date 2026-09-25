import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ServiceCatalog } from '~/components/public/ServiceCatalog';

const describedService = {
  publicServiceToken: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
  name: 'Corte',
  durationMinutes: 40,
  price: 23000,
  description: 'Incluye',
};

describe('ServiceCatalog', () => {
  it('renders services with no selector control and no includes disclosure', () => {
    render(<ServiceCatalog services={[describedService]} />);

    expect(screen.getByText('Corte')).toBeInTheDocument();
    expect(screen.getByText('40 min')).toBeInTheDocument();
    // This demo version does not surface the service description, even when the
    // DTO carries one.
    expect(screen.queryByText('Qué incluye')).toBeNull();
    expect(document.querySelector('.ticket-detail')).toBeNull();
    expect(document.querySelector('.prof-select')).toBeNull();
  });

  it('navigates the CTA to /reservar with the encoded service token', () => {
    render(<ServiceCatalog services={[{ ...describedService, description: null }]} />);

    const cta = screen.getByRole('link', { name: 'Reservar' });
    expect(cta).toHaveAttribute(
      'href',
      `/reservar?service=${encodeURIComponent('a1b2c3d4e5f60718293a4b5c6d7e8f90')}`
    );
  });

  it('renders no rating row and no rating-derived copy', () => {
    render(<ServiceCatalog services={[describedService]} />);

    const html = document.body.innerHTML;
    expect(html).not.toContain('★');
    expect(html).not.toContain('reseñas');
    expect(document.querySelector('.rating-row')).toBeNull();
  });
});
