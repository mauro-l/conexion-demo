import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ServiceCatalog } from '~/components/public/ServiceCatalog';

const describedService = {
  publicServiceToken: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
  name: 'Corte',
  durationMinutes: 40,
  price: 23000,
  description: 'Incluye',
};

describe('ServiceCatalog', () => {
  it('renders services from the DTO with no selector control', () => {
    render(<ServiceCatalog services={[describedService]} />);

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

  it('toggles the service detail with a button that owns aria-expanded and aria-controls', () => {
    render(<ServiceCatalog services={[describedService]} />);

    // The bare <details>/<summary> element is gone; the control is a real button.
    expect(document.querySelector('details')).toBeNull();

    const toggle = screen.getByRole('button', { name: /Qué incluye/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle.querySelector('svg')).not.toBeNull();

    const regionId = toggle.getAttribute('aria-controls');
    expect(regionId).toBeTruthy();
    const region = document.getElementById(regionId ?? '');
    expect(region).not.toBeNull();
    expect(region).toHaveTextContent('Incluye');
    // Collapsed: the region exists but is hidden.
    expect(region).not.toBeVisible();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(region).toBeVisible();

    // Activating twice must return the control to its collapsed state.
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(region).not.toBeVisible();
  });

  it('renders no rating row and no rating-derived copy', () => {
    render(<ServiceCatalog services={[describedService]} />);

    const html = document.body.innerHTML;
    expect(html).not.toContain('★');
    expect(html).not.toContain('reseñas');
    expect(document.querySelector('.rating-row')).toBeNull();
  });
});
