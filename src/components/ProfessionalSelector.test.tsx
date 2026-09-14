import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProfessionalSelector } from './ProfessionalSelector';
import type { Barber } from '../types/public';

const singleBarber: Barber[] = [
  { name: 'Mauro Laime', alias: 'Mauro', description: null, photoUrl: null },
];

const twoBarbers: Barber[] = [
  { name: 'Mauro Laime', alias: 'Mauro', description: null, photoUrl: null },
  { name: 'Juan Pérez', alias: 'Juan', description: null, photoUrl: null },
];

describe('ProfessionalSelector', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('displays the only barber and keeps the control selectable', () => {
    render(<ProfessionalSelector barbers={singleBarber} />);

    const trigger = screen.getByRole('button', { name: /Mauro/i });
    expect(trigger).toBeInTheDocument();

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    const option = screen.getByRole('option', { name: /Mauro/i });
    expect(option).toBeInTheDocument();
  });

  it('renders both barbers from data with no hardcoded placeholder', () => {
    render(<ProfessionalSelector barbers={twoBarbers} />);

    const trigger = screen.getByRole('button', { name: /Mauro/i });
    fireEvent.click(trigger);

    expect(screen.getByRole('option', { name: /Mauro/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Juan/i })).toBeInTheDocument();
    expect(screen.queryByText(/Cualquier profesional/i)).not.toBeInTheDocument();
  });

  it('updates the selected barber when a different option is chosen', () => {
    render(<ProfessionalSelector barbers={twoBarbers} />);

    const trigger = screen.getByRole('button', { name: /Mauro/i });
    fireEvent.click(trigger);

    fireEvent.click(screen.getByRole('option', { name: /Juan/i }));
    expect(screen.getByRole('button', { name: /Juan/i })).toBeInTheDocument();
  });
});
