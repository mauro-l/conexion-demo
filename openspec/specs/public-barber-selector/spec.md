# public-barber-selector Specification

## Purpose

Prototype-matching professional selector backed by the context DTO `barbers` list.

## Requirements

### Requirement: Selector rendered from the barbers list

The selector MUST be a functional-looking selectable control matching the prototype "Cualquier profesional" pill, populated from `barbers` — never hardcoded. With one barber it MUST display that barber and remain visibly selectable. No booking behavior.

#### Scenario: Single barber today

- GIVEN a context DTO with exactly one barber entry
- WHEN `/b/[slug]` renders
- THEN the selector shows that barber, functional-looking

#### Scenario: Data-only expansion

- GIVEN a future DTO with two barber entries
- WHEN the selector renders
- THEN both appear selectable with no UI code change
