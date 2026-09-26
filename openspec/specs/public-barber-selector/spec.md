# public-barber-selector Specification

## Purpose

Professional selector deferred to the Fase 2 booking flow; the Fase 1 landing renders no selector while the context DTO retains the `barbers` list.

## Requirements

### Requirement: Selector rendered from the barbers list

The public landing at `/` MUST NOT render or require a professional-selector control. On `/reservar`, the read-only flow MUST render exactly one professional affordance labeled “Seleccione profesional”; it MUST require an explicit professional choice before `Siguiente` enables and MUST NOT resolve a chosen barber for booking. The context DTO MUST continue returning `barbers[]` with `name`, `alias`, `description`, and `photoUrl`.

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

#### Scenario: Explicit professional selection
- GIVEN a valid service on `/reservar`
- WHEN the read-only booking flow renders
- THEN it shows “Seleccione profesional” with no professional chosen
- AND `Siguiente` stays disabled until the visitor explicitly selects a professional
- AND it does not resolve the chosen barber for booking

#### Scenario: Booking-flow boundary
- GIVEN the prototype places the affordance beside date and time controls
- WHEN this public landing capability is evaluated
- THEN the affordance is booking-flow scope on `/reservar`, not a landing requirement

#### Scenario: No booking-time resolution
- GIVEN a visitor selects “Seleccione profesional” and then chooses a professional
- WHEN availability is read
- THEN availability is computed across eligible barbers without creating or assigning a booking
