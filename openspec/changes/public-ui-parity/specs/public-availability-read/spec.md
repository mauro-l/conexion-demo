# Delta for public-availability-read

## ADDED Requirements

### Requirement: Deterministic date scroller
The booking step MUST render one card for every returned day (normally 14), showing DTO-derived weekday, day number, and month. Labels MUST derive from the DTO day index and date string rather than runtime timezone or locale formatting. A zero-slot day MUST be disabled and not selectable. Exactly one non-disabled card MUST be selected when any open day exists; initialization MUST select the first open day, and selecting another card MUST replace the selection and its rendered slots. The label `Elegí una fecha` MUST precede the scroller.

#### Scenario: Full window with closed leading day
- GIVEN 14 returned days and the first day has zero slots while the third has slots
- WHEN the booking step hydrates
- THEN 14 cards render, the first is disabled, and the third is the only selected card

#### Scenario: Select an open day
- GIVEN the selected card is day 0 and day 3 has slots
- WHEN the visitor activates day 3
- THEN day 3 becomes the only selected card and the time content changes to day 3

### Requirement: Client-derived time groups
The selected day's slots MUST be derived in the booking island without changing `types/booking.ts` or the availability endpoint. Slots with hour `<12`, `<18`, and otherwise MUST render under `Mañana`, `Tarde`, and `Noche`; empty groups MUST omit their heading.

#### Scenario: Boundary slots
- GIVEN slots at 11:59, 12:00, 17:59, and 18:00
- WHEN the selected day is rendered
- THEN they appear respectively in Mañana, Tarde, Tarde, and Noche

### Requirement: Booking step structure and controls
The step MUST render `Elegí un horario`, a service chip containing database `service.name` and `duration · price`, one static `Cualquier profesional` pill with avatar and chevron, and a button labelled `Ir a una fecha específica`. It MUST use modal chrome with links to `/` labelled `Volver` and `Cerrar` and a shop-name crumb; the home header MUST NOT render on `/reservar`. The jump control MUST scroll or focus the selected card and MUST NOT open a date dialog. The existing read-only chosen summary and `Elegir otro horario` behavior MUST remain intact.

#### Scenario: Render step chrome
- GIVEN availability includes service name, duration, price, and at least one day
- WHEN `/reservar` renders
- THEN the chip, both section labels, professional pill, jump button, crumb, and `/` navigation links are present

#### Scenario: Read-only completion
- GIVEN a visitor selects an open day and slot
- WHEN the final state is shown
- THEN the chosen summary and `Elegir otro horario` action remain available and no booking mutation occurs

### Requirement: Database-authoritative public copy
The UI MUST use database values for shop name, description, and opening hours. It MUST prepend the literal UI copy `Hoy ` to the hours value and MUST NOT replace those values with prototype literals.

#### Scenario: Database values differ from prototype
- GIVEN the database returns shop name `Conexión Barbería`, description `DB description`, and hours `10:00–20:00`
- WHEN the landing and booking step render
- THEN those values appear, the hours row reads `Hoy 10:00–20:00`, and the crumb uses the database shop name

### Requirement: No rating data or presentation
The public UI MUST NOT render a rating, stars, score, or review count, and this change MUST add no rating column or DTO field.

#### Scenario: Prototype contains an unsupported rating
- GIVEN the prototype text contains `★★★★★ · 5.0 · 37 reseñas` but no database rating source exists
- WHEN public pages render
- THEN no rating row or rating-derived data is present

### Requirement: Prototype booking visual fidelity
Availability slot buttons MUST use the prototype's `14.5px`, `600`, mono, radius-12 treatment; group labels MUST be muted, uppercase, `12px`, `600`. The professional control MUST be a pill with a 26px avatar and chevron, not a full-width card or `Profesional` label.

#### Scenario: Inspect booking controls
- GIVEN the booking step is rendered in either theme
- WHEN computed styles and accessible text are inspected
- THEN the slot, group-label, and professional-control values match the stated prototype treatment
