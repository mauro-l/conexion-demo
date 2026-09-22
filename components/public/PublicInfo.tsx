import type { ReactNode } from 'react';
import type { Barberia } from '~/types/public';

/**
 * Barbershop contact rows. Every row is conditional: a missing nullable value
 * renders nothing rather than a fabricated default.
 */
export function PublicInfo({ barberia }: { barberia: Barberia }) {
  const rows: Array<{ key: string; icon: ReactNode; content: ReactNode }> = [];

  if (barberia.address) {
    rows.push({
      key: 'address',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>
      ),
      content: <span>{barberia.address}</span>,
    });
  }

  if (barberia.hours) {
    rows.push({
      key: 'hours',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
      ),
      content: <span>Hoy {barberia.hours}</span>,
    });
  }

  if (barberia.whatsappUrl) {
    rows.push({
      key: 'whatsapp',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M20.5 3.5a10 10 0 0 0-16.9 9.8L2 21l7.9-1.5A10 10 0 1 0 20.5 3.5z" /></svg>
      ),
      content: <a href={barberia.whatsappUrl}>Contactanos por WhatsApp</a>,
    });
  }

  if (barberia.instagramHandle) {
    rows.push({
      key: 'instagram',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" /></svg>
      ),
      content: (
        <a href={barberia.instagramUrl ?? undefined}>{barberia.instagramHandle}</a>
      ),
    });
  }

  if (rows.length === 0) return null;

  return (
    <div className="info-list">
      {rows.map((row) => (
        <div className="info-row" key={row.key}>
          {row.icon}
          {row.content}
        </div>
      ))}
    </div>
  );
}
