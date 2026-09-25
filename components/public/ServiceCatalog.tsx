import Link from 'next/link';
import { formatDuration, formatPrice } from '~/lib/public-format';
import type { Service } from '~/types/public';

/**
 * Database-authoritative service catalog. Each CTA is a link to the read-only
 * booking entry point, and the list is keyed by the opaque public token because
 * service names are not guaranteed unique.
 *
 * The service description is deliberately not rendered: this demo version does
 * not surface "qué incluye". The DTO still carries it, so the disclosure can
 * come back without a data change.
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
