# Booking UX fixes (flujo público)

Branch: `fix/booking-ux-fixes` (creada desde `fix/public-presentation`).

## Objetivo

Aplicar 5 mejoras UX del flujo público (puntos 1, 2, 3, 4 y 6 del veredicto
entregado) con copy en español rioplatense (Elegí, Completá, escribinos).
El punto 5 NO se toca.

## Alcance

In (puntos del veredicto):
- **P1 — Salida post-reserva**: `BookingForm` suma Link "Volver al inicio".
- **P2 — Siguiente deshabilitado**: preselección con 1 profesional + resumen
  específico cuando hay slot pero falta profesional.
- **P3 — Icono calendario**: eliminar `cal-jump-btn` y código sin uso.
- **P4 — Lookup/cancelación**: contador de fallos + ayuda WhatsApp opcional.
- **P6 — Descripción larga**: `ExpandableText` con Leer más / Leer menos.

Out (explícito):
- **Punto 5 del veredicto: excluido, no se toca.**

## Checklist

- [x] **BUX-1 — Salida post-reserva** (`components/booking/BookingForm.tsx`):
      debajo de "Agendar otra cita" agregar `<Link href="/">Volver al inicio</Link>`
      con `btn-secondary`; mantener `onRestart`.
- [x] **BUX-2 — Siguiente deshabilitado**
      (`components/booking/AvailabilityCalendar.tsx`,
      `components/booking/AvailabilityCalendar.test.tsx`): si
      `barbers.length === 1`, preseleccionar (estado inicial); si hay varios y
      hay slot elegido pero falta profesional, el resumen dice
      "Elegí un profesional para continuar"; el botón sigue requiriendo
      slot + profesional; actualizar tests.
- [x] **BUX-3 — Icono calendario** (`components/booking/AvailabilityCalendar.tsx`):
      eliminar botón `cal-jump-btn`, `jumpToSelectedDate`, `selectedCardRef` y
      el `useRef` si queda sin uso; no tocar date-scroller ni slots.
- [x] **BUX-4 — Lookup/cancelación**
      (`components/booking/ManageBookingLookup.tsx`,
      `components/public/PublicFooter.tsx`, `app/page.tsx`,
      `components/booking/ManageBookingLookup.test.tsx`): mantener el mapa que
      distingue NOT_FOUND de INTERNAL_ERROR; contar fallos de búsqueda solo en
      NOT_FOUND/INVALID_INPUT (no errores de red); desde el 3er fallo mostrar
      ayuda con enlace WhatsApp "¿Necesitás ayuda? Escribinos por WhatsApp.";
      `shopWhatsappUrl` viaja de `context.barberia.whatsappUrl` (`app/page.tsx`)
      por `PublicFooter` a `ManageBookingLookup` como prop opcional; si es null
      solo texto de ayuda sin enlace; actualizar tests.
- [x] **BUX-6 — Descripción larga** (`components/public/ExpandableText.tsx`,
      `components/public/PublicHero.tsx`): `'use client'` + `useState`,
      recorte ~180 caracteres con "Leer más" / "Leer menos"; usarlo en
      PublicHero para `barberia.description`; mantener clase `tagline` y
      `white-space: pre-line`.
- [x] **BUX-7 — Verificación**: `npx vitest run components/booking/ components/public/`
      en verde; commit convencional sin Co-Authored-By, sin push ni PR.
- [x] **BUX-8 — Estilo del enlace de salida** (`app/globals.css`,
      `components/booking/BookingForm.test.tsx`): ubicado debajo del CTA
      principal, a ancho completo y apilado vertical, con transiciones breves y
      estados hover, active sobrio y focus-visible coherentes con la paleta
      cálida; sin fondo saturado en active.

## Criterios de aceptación

1. Post-reserva muestra "Agendar otra cita" (mismo comportamiento) + enlace
    secundario "Volver al inicio" debajo del CTA principal y a `/`; al pasar el
    cursor muestra un hover visible, al presionar un active sobrio y el teclado
    tiene foco visible.
2. Con un solo profesional, el flujo arranca con ese profesional elegido y
   "Siguiente" se habilita al elegir slot; con varios, slot sin profesional
   muestra "Elegí un profesional para continuar" y "Siguiente" sigue
   deshabilitado hasta elegir ambos.
3. No queda ningún `cal-jump-btn`, `jumpToSelectedDate` ni `selectedCardRef`
   en el código; el date-scroller y los slots funcionan igual.
4. Tres fallos NOT_FOUND/INVALID_INPUT seguidos muestran la ayuda; los errores
   de red no incrementan el contador; con `shopWhatsappUrl=null` no hay enlace;
   con URL hay enlace "¿Necesitás ayuda? Escribinos por WhatsApp.".
5. Descripciones largas se recortan a ~180 caracteres con "Leer más" /
   "Leer menos"; cortas se muestran completas sin botones; se conserva
   `tagline` y `pre-line`.
6. `npx vitest run components/booking/ components/public/` pasa; los tests
   que contradecían el nuevo comportamiento quedaron actualizados con su
   justificación.
