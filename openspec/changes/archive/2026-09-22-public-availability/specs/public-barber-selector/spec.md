# Delta for public-barber-selector

## MODIFIED Requirements

### Requirement: Selector rendered from the barbers list

The public landing at `/` MUST NOT render or require a professional-selector control. On `/reservar`, the read-only flow MUST render exactly one professional affordance labeled “Cualquier profesional”; it MUST NOT expose per-barber selection or resolve a chosen barber for booking. The context DTO MUST continue returning `barbers[]` with `name`, `alias`, `description`, and `photoUrl`.

(Previously: the selector was deferred entirely to a future booking flow.)

#### Scenario: Landing remains selector-free
- GIVEN a context DTO with exactly one barber entry
- WHEN `/` renders
- THEN no professional-selector control is rendered

#### Scenario: Data-only expansion
- GIVEN a context DTO with two barber entries
- WHEN `/` renders
- THEN no professional-selector control is rendered
- AND both entries retain the defined four DTO fields

#### Scenario: Any-professional booking entry
- GIVEN a valid service on `/reservar`
- WHEN the read-only booking flow renders
- THEN it shows “Cualquier profesional”
- AND it does not show individual barber choices

#### Scenario: Booking-flow boundary
- GIVEN the prototype places the affordance beside date and time controls
- WHEN this public landing capability is evaluated
- THEN the affordance is booking-flow scope on `/reservar`, not a landing requirement

#### Scenario: No booking-time resolution
- GIVEN a visitor selects “Cualquier profesional”
- WHEN availability is read
- THEN availability is computed across eligible barbers without creating or assigning a booking
