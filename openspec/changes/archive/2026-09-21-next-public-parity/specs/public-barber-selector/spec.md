# Delta for public-barber-selector

## MODIFIED Requirements

### Requirement: Selector rendered from the barbers list

Fase 1 MUST NOT render or require a professional-selector control on the public landing. The selector is explicitly deferred to the booking flow and returns in Fase 2; this delta does not specify that flow's implementation. The context DTO MUST continue returning `barbers[]` with `name`, `alias`, `description`, and `photoUrl`; only the selector control is deferred.
(Previously: The public landing was required to render a functional-looking selector populated from `barbers`.)

#### Scenario: Single barber today

- GIVEN a context DTO with exactly one barber entry
- WHEN `/` renders
- THEN no professional-selector control is rendered or required on the landing

#### Scenario: Data-only expansion

- GIVEN a future DTO with two barber entries
- WHEN `/` renders in Fase 1
- THEN no professional-selector control is rendered, and the DTO still contains both barber entries with the defined four fields

#### Scenario: Booking-flow boundary

- GIVEN the prototype places the professional selector alongside date and time controls
- WHEN this Fase 1 public landing capability is evaluated
- THEN the selector is treated as deferred booking-flow scope for Fase 2, not as a landing requirement
