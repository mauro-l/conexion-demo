import Link from 'next/link';
import { ServiceDisclosure } from '~/components/public/ServiceDisclosure';
import { formatDuration, formatPrice } from '~/lib/public-format';
import type { Service } from '~/types/public';

/**
 * Database-authoritative service catalog. Descriptions are rendered only when
 * the DTO supplies them; there are no fabricated fallbacks. Each CTA is a link
 * to the read-only booking entry point, and the list is keyed by the opaque
 * public token because service names are not guaranteed unique.
 */
export function ServiceCatalog({ services }: { services: Service[] }) {
  return (
    <section className="services">
      <h2 className="section-title">Servicios</h2>
      <div className="ticket-list">
        {services.map((service) => (
          <article className="ticket" key={service.publicServiceToken}>
            <ServiceDisclosure description={service.description}>
              <h3 className="ticket-name">{service.name}</h3>
            </ServiceDisclosure>
            <div className="ticket-perf" />
            <div className="ticket-footer">
              <span className="ticket-meta">
                {formatDuration(service.durationMinutes)}
                <span className="dot">·</span>
                <span className="price">{formatPrice(service.price)}</span>
              </span>
              <Link
                href={`/reservar?service=${encodeURIComponent(service.publicServiceToken)}`}
                className="ticket-cta"
              >
                Reservar
              </Link>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
