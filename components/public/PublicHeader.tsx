import { ThemeSwitch } from '~/components/ThemeSwitch';

/**
 * Split a shop name so its last word can carry the brass accent.
 *
 * The split is pure and whitespace-trimmed: every word but the last becomes
 * `head`, the last becomes `tail`. A single-word name has no tail, so the logo
 * renders plain instead of fabricating a second half. An empty name is the
 * not-found fallback and also yields no tail.
 */
export function splitLogoName(name: string): { head: string; tail: string | null } {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { head: '', tail: null };
  if (words.length === 1) return { head: words[0], tail: null };
  return {
    head: words.slice(0, -1).join(' '),
    tail: words[words.length - 1],
  };
}

/**
 * Server Component shell: brand topbar plus the theme control.
 *
 * `name` is the database shop name. It is optional only for the not-found
 * experience, where no database value exists; the shell then keeps an empty
 * logo slot rather than a hard-coded prototype literal.
 */
export function PublicHeader({ name }: { name?: string }) {
  const { head, tail } = splitLogoName(name ?? '');

  return (
    <header className="topbar container">
      <div className="logo">
        {head}
        {tail === null ? null : (
          <>
            {' '}
            <span>{tail}</span>
          </>
        )}
      </div>
      <div className="topbar-actions">
        <ThemeSwitch />
      </div>
    </header>
  );
}
