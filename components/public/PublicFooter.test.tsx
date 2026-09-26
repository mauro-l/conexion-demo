import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useRouter } from 'next/navigation';
import { PublicFooter } from '~/components/public/PublicFooter';

// The footer's only interactive node is the client island, which reads the
// router; the mock keeps the server component renderable in jsdom.
vi.mock('next/navigation', () => ({ useRouter: vi.fn() }));

beforeEach(() => {
  vi.mocked(useRouter).mockReturnValue({
    push: vi.fn(),
  } as unknown as ReturnType<typeof useRouter>);
});

describe('PublicFooter', () => {
  it('renders the footer structure with the client entry point inside the links', () => {
    const { container } = render(<PublicFooter />);

    const footer = container.querySelector('footer.site-footer');
    expect(footer).not.toBeNull();

    const links = footer?.querySelector('.footer-links');
    expect(links).not.toBeNull();
    expect(links?.querySelector('button.footer-link')).toHaveTextContent('Cancelar turno');
  });

  it('renders the prototype credit line with the author link', () => {
    const { container } = render(<PublicFooter />);

    const credit = container.querySelector('.footer-credit');
    expect(credit?.textContent).toContain('Sistema de reservas hecho por');
    expect(credit?.querySelector('a')).toHaveAttribute('href', 'mailto:maurol.dev@gmail.com');
  });

  it('points the login link at the operator app, in a new tab with the opener severed', () => {
    render(<PublicFooter />);

    const login = screen.getByRole('link', { name: 'Iniciar sesión' });
    expect(login).toHaveAttribute('href', 'https://proyecto-final-rn.vercel.app/');
    expect(login).toHaveAttribute('target', '_blank');
    expect(login).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
