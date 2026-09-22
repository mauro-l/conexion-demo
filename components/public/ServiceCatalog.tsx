import Link from 'next/link';
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
            <div className="ticket-main">
              <h3 className="ticket-name">{service.name}</h3>
              {service.description ? (
                <details className="ticket-details">
                  <summary>Qué incluye</summary>
                  <p>{service.description}</p>
                </details>
              ) : null}
            </div>
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
