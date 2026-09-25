'use client';

import { useId, useState, type ReactNode } from 'react';

/**
 * Accessible service disclosure.
 *
 * Replaces `<details>/<summary>` with a native button that owns
 * `aria-expanded`/`aria-controls`, so the visible chevron and the exposed state
 * cannot drift apart. `children` is the service heading, rendered by the (server)
 * catalog; the detail region is a sibling of the ticket head so it spans the full
 * ticket width, matching the prototype.
 */
export function ServiceDisclosure({
  description,
  children,
}: {
  description: string | null;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const regionId = useId();

  return (
    <>
      <div className="ticket-main">
        {children}
        {description ? (
          <button
            type="button"
            className="ticket-detail-toggle"
            aria-expanded={expanded}
            aria-controls={regionId}
            onClick={() => setExpanded((current) => !current)}
          >
            Qué incluye
            <ChevronIcon />
          </button>
        ) : null}
      </div>
      {description ? (
        <div className="ticket-detail" id={regionId} hidden={!expanded}>
          <p>{description}</p>
        </div>
      ) : null}
    </>
  );
}

function ChevronIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
