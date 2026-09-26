import { ManageBookingLookup } from '~/components/booking/ManageBookingLookup';

/**
 * Where the shop's login lives. The public site has no account system of its
 * own, so this points at the separate operator app rather than a local route.
 */
const LOGIN_URL = 'https://proyecto-final-rn.vercel.app/';

/**
 * Public site footer.
 *
 * The booking-recovery entry point is the client island inside `.footer-links`;
 * everything else is static copy. The login link leaves this app entirely, so it
 * opens in a new tab and severs the opener — a visitor part-way through a
 * booking should not lose the landing.
 */
export function PublicFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-links">
        <a
          className="footer-link"
          href={LOGIN_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          Iniciar sesión
        </a>
        <ManageBookingLookup />
      </div>
      <p className="footer-credit">
        Sistema de reservas hecho por <a href="mailto:maurol.dev@gmail.com">mauro.dev</a> — ¿Querés
        uno así? Escribinos.
      </p>
    </footer>
  );
}
