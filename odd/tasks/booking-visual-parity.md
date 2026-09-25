# Booking visual parity with the prototype

## Objective

Bring the slot area of `/reservar` in line with the prototype's step 2: the times
are a vertical list grouped by Mañana / Tarde / Noche, choosing one stages it
behind a fixed bottom bar, and a "Siguiente" call to action opens the customer
form only once a time is chosen.

## Problem

The built island renders the times as a wrapping grid and jumps straight to the
customer form on the first click. The prototype renders one full-width row per
time and puts the choice behind a bottom bar whose CTA starts disabled with the
copy `Elegí fecha y hora para continuar`. The intermediate step is missing, so
the visitor never sees which slot they are about to confirm.

Separately, the prototype's phone field carries a standing `🇦🇷 +54` prefix that
the built form never ported. Adding it forces a decision about the existing
`onBlur` rewrite, which would duplicate the prefix.

## Why

The prototype is the visual source of truth for this surface. The two-step flow
also gives the visitor a confirmation point for the slot before committing their
details.

## Scope

In scope: `components/booking/AvailabilityCalendar.tsx`,
`components/booking/BookingForm.tsx`, `app/globals.css`, and the tests that
assert the old one-step behaviour.

Out of scope: real barbershop data (`whatsapp_url` is still the `"#"` placeholder
and no number is available), the `/reservar?service=<token>` URL shape, and the
prototype's `waitlist` link, which points at `#` and would be another dead
promise.

## Tasks

- [x] **V1 — Times as a list.** `.availability-slot` becomes a full-width stacked
      row (`display:block; width:100%; text-align:left`), and the chosen one takes
      a `.selected` modifier filled with `--brass`. The `Elegí un horario` heading
      stays above the list.
- [x] **V2 — Staged selection and sticky footer.** Choosing a time no longer opens
      the form; it stages the slot. A fixed bottom `.sticky-bar` shows the chosen
      day and time (`<strong>day</strong>HH:MM hs`) or the literal
      `Elegí fecha y hora para continuar`, plus a `Siguiente` button that is
      disabled until a time is staged. `Siguiente` opens the form and hides the
      bar. Returning from the form (`Elegir otro horario`) keeps the staged slot.
- [x] **V3 — Long date label.** The footer and the recap share the prototype's
      long date form (`Lunes 21 de septiembre`) built from lookup tables, never
      from a `Date`, whose UTC parsing would shift the day in a negative-offset
      timezone and break hydration.
- [x] **V4 — `🇦🇷 +54` prefix.** The phone field gains the prototype's standing
      prefix, ported as the sibling `.phone-prefix` box, and the `onBlur` rewrite
      that would duplicate it is removed. Normalization on submit is unchanged and
      remains the only authority on the stored number.
- [x] **V5 — Follow the fix through the tests.** The island's tests gain the
      `Siguiente` step and assert the footer's two states; the booking e2e gains
      the same step.

## Acceptance criteria

- The times render as full-width rows under their group heading, one per line.
- The staged time is visually marked and named in the footer before the form.
- `Siguiente` is disabled with no time staged and enabled with one.
- The form is reached only through `Siguiente`.
- The phone field shows `🇦🇷 +54` before it and the typed digits inside it, with no
  duplicated country code after leaving the field.
- Typecheck, lint, unit tests, build and e2e pass.

## Checks

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`
- `npm run test:e2e`

## Progress

V1 through V5 are done and verified. The availability fix from the previous
change (`a67c96c`) is untouched by this one.

## Evidence

- `07ce868` carries V1 to V5.
- `npm run typecheck`, `npm run lint`, `npm run build`: clean.
- `npm test`: 88/88 across 10 files (was 84).
- `npm run test:e2e`: 15 passed, 1 skipped. The skip is the booking e2e, which
  needs the local scratch stack to serve `public-booking`. That stack builds its
  edge bundle at `supabase start`, so a copied function is not served until the
  stack is restarted.
- Screenshots at 420x880 of the three states: the staged slot filled brass with
  the footer naming `Viernes 25 de septiembre / 09:00 hs` and `Siguiente`
  enabled; the same footer disabled with `Elegí fecha y hora para continuar`; and
  the form with the `🇦🇷 +54` prefix beside the phone input, footer gone.
- Deliberately not delivered: the prototype's `waitlist` link and its OTP copy,
  and the WhatsApp link, which still has nowhere to point because
  `Barberia.whatsapp_url` is the `"#"` placeholder.
