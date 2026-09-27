'use client';

import { useState } from 'react';

/** Visible characters before a long text collapses behind "Leer más". */
const PREVIEW_LENGTH = 180;

/**
 * A long-text clamp with a "Leer más" / "Leer menos" toggle. Short texts
 * render whole with no toggle, so the hero keeps showing them exactly as
 * before. The visible paragraph always carries `tagline`, keeping the hero's
 * `white-space: pre-line` rendering.
 */
export function ExpandableText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);

  if (text.length <= PREVIEW_LENGTH) {
    return <p className="tagline">{text}</p>;
  }

  return (
    <div>
      <p className="tagline">{expanded ? text : `${text.slice(0, PREVIEW_LENGTH)}…`}</p>
      <button
        type="button"
        className="tagline-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        {expanded ? 'Leer menos' : 'Leer más'}
      </button>
    </div>
  );
}
