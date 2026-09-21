import { ThemeSwitch } from '~/components/ThemeSwitch';

/** Server Component shell: brand topbar plus the theme control. */
export function PublicHeader() {
  return (
    <header className="topbar container">
      <div className="logo">Conexión Barbería</div>
      <div className="topbar-actions">
        <ThemeSwitch />
      </div>
    </header>
  );
}
