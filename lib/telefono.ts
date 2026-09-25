/* =========================
   Helper de teléfonos (celulares argentinos)
   - normalización a formato canónico +549 + 10 dígitos
   - formateo para mostrar como confirmación
========================= */

/**
 * Normaliza un CELULAR argentino a formato canónico `+549` + 10 dígitos
 * (ej: `+5492216819377`). Devuelve `null` si no es un número argentino válido.
 *
 * SUPUESTO CENTRAL — esta función NO distingue fijos de celulares.
 * El Plan Fundamental de Numeración Nacional (ENACOM, Res. 1369/2023) no permite
 * identificar por los dígitos si un número es de telefonía fija o móvil: la única
 * señal es el prefijo `15` (marcación doméstica) o el `9` (marcación nacional /
 * internacional). Por eso un número ambiguo de 10 dígitos (ej. `221 681 9377`) se
 * asume CELULAR.
 *
 * Consecuencia asumida: si el input fuera en realidad un fijo, queda guardado con
 * el `9` inyectado y el link de WhatsApp no va a funcionar — el mismo resultado
 * que no tener el número. Un número de otro país devuelve `null`.
 *
 * Casos soportados: pegado de WhatsApp (`+54 9 ...`), número nacional con o sin
 * `0` de discado, formato viejo con `15`, y prefijo internacional `00`.
 */
export function normalizarCelularAR(input: string): string | null {
  let d = input.replace(/\D/g, ''); // solo dígitos
  if (d.startsWith('00')) d = d.slice(2); // prefijo internacional
  if (d.startsWith('54')) d = d.slice(2); // país
  if (d.startsWith('0')) d = d.slice(1); // 0 de discado
  if (d.length === 11 && d.startsWith('9')) d = d.slice(1); // 9 de WhatsApp

  // formato viejo: área (2-4 dígitos) + 15 + número → 12 dígitos
  if (d.length === 12) {
    const i = [2, 3, 4].find((n) => d.slice(n, n + 2) === '15');
    if (i !== undefined) d = d.slice(0, i) + d.slice(i + 2);
  }

  // 10 dígitos, área válida: 11 (AMBA) o empieza con 2/3
  if (!/^(11\d{8}|[23]\d{9})$/.test(d)) return null;
  return '+549' + d;
}

/**
 * Regla comercial: ¿el canónico pertenece a alguna de las áreas permitidas?
 * Se aplica SOLO en el formulario público; el barbero carga lo que le llegue.
 *
 * Nota sobre el prefijo: la comparación es `startsWith`, así que un área corta
 * configurada también acepta las áreas más largas que empiecen igual
 * (ej. `342` acepta un `3425…`). Para AMBA (`11`) no hay solapamiento posible.
 */
export function areaPermitida(tel: string, permitidas: string[]): boolean {
  return permitidas.some((a) => tel.startsWith('+549' + a));
}

/**
 * Formatea un canónico para mostrarlo como confirmación al usuario.
 * Es solo presentación: no cambia el valor que se guarda.
 */
export function formatearTelefono(tel: string): string {
  return tel.replace(/^\+549/, '+54 9 ');
}
