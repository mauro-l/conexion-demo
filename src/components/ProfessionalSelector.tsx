import { useEffect, useRef, useState } from 'react';
import type { Barber } from '../types/public';

interface ProfessionalSelectorProps {
  barbers: Barber[];
}

export function ProfessionalSelector({ barbers }: ProfessionalSelectorProps) {
  const [selected, setSelected] = useState<Barber | null>(barbers[0] ?? null);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelected(barbers[0] ?? null);
  }, [barbers]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const handleSelect = (barber: Barber) => {
    setSelected(barber);
    setOpen(false);
  };

  if (barbers.length === 0) {
    return (
      <div className="prof-row">
        <button type="button" className="prof-select" disabled>
          <span className="prof-avatar">
            <UserIcon />
          </span>
          <span>No hay profesionales</span>
        </button>
      </div>
    );
  }

  return (
    <div className="prof-row" ref={containerRef}>
      <button
        type="button"
        className="prof-select"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="prof-avatar">
          {selected?.photoUrl ? (
            <img src={selected.photoUrl} alt="" />
          ) : (
            <span>{selected ? initials(selected.name) : <UserIcon />}</span>
          )}
        </span>
        <span>{selected?.alias ?? selected?.name ?? 'Seleccionar profesional'}</span>
        <ChevronIcon />
      </button>

      {open && (
        <ul className="prof-dropdown" role="listbox" aria-label="Profesionales">
          {barbers.map((barber) => (
            <li key={barber.name} role="presentation">
              <button
                type="button"
                className="prof-option"
                role="option"
                aria-selected={barber.name === selected?.name}
                onClick={() => handleSelect(barber)}
              >
                <span className="prof-avatar">
                  {barber.photoUrl ? (
                    <img src={barber.photoUrl} alt="" />
                  ) : (
                    <span>{initials(barber.name)}</span>
                  )}
                </span>
                <span>{barber.alias ?? barber.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <button type="button" className="cal-jump-btn" aria-label="Ir a una fecha específica">
        <CalendarIcon />
      </button>
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const second = parts[1]?.[0] ?? '';
  return (first + second).toUpperCase();
}

function UserIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 21a8 8 0 1 0-16 0" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}
