import Image from 'next/image';
import type { ReactNode } from 'react';
import type { Barberia } from '~/types/public';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const second = parts[1]?.[0] ?? '';
  return (first + second).toUpperCase();
}

/**
 * Cover photo and primary barbershop identity. The barber list is intentionally
 * not rendered in Fase 1; `children` carries the public information rows.
 */
export function PublicHero({
  barberia,
  children,
}: {
  barberia: Barberia;
  children?: ReactNode;
}) {
  return (
    <>
      <div className="cover-photo">
        <Image
          src="/cover.jpg"
          alt={`Foto de portada de ${barberia.name}`}
          width={950}
          height={634}
          priority
          sizes="(min-width: 680px) 640px, 100vw"
        />
      </div>

      <section className="hero container">
        <div className="hero-head">
          <div className="brand-mark" aria-hidden="true">
            <span className="brand-mark-initials">{initials(barberia.name)}</span>
          </div>
        </div>
        <p className="eyebrow">Barbería</p>
        <h1 className="hero-title">{barberia.name}</h1>
        {barberia.description ? <p className="tagline">{barberia.description}</p> : null}
        {children}
      </section>
    </>
  );
}
