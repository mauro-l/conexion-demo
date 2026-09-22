# public-availability-read Specification

## Purpose

Expose uncached, database-authoritative availability and a read-only booking entry point.

Unproven cases and the operational preconditions the evidence depends on are recorded in [`deferred-coverage.md`](../../deferred-coverage.md). Deferred cases are deliberately not requirements.

## Requirements

### Requirement: Authoritative availability contract

Availability MUST be read through a service-role-only Edge Function and least-privilege RPC. Responses MUST be `Cache-Control: no-store`; the RPC MUST verify the live anti-overlap predicate before implementation rather than assuming a migration or constraint name. Dates use Buenos Aires time and PostgreSQL is authoritative. The day field uses `0=Sunday, 1=Monday, ..., 6=Saturday`.

#### Scenario: Valid service read
- GIVEN a published shop and a service with a non-NULL duration
- WHEN a valid service token is requested
- THEN the response is uncached and contains only database-computed availability
- AND the RPC is executable by `service_role` only

#### Scenario: Invalid or unknown input
- GIVEN an invalid token, malformed date, unknown field, or date outside the window
- WHEN availability is requested
- THEN a stable client error is returned without internal identifiers or schedule data

### Requirement: Exact slot window and schedule rules

The read window MUST be the local date interval `[today, today + 14 days)`: today is day 0 and the final included date is today+13. A slot MUST start at or after `now + 30 minutes`, use `[start, end)` duration bounds, and finish before the exclusive window end. Effective hours are the intersection of shop and barber hours and working-day arrays. Any NULL/absent barber day or hour field contributes no slots and MUST NOT fall back to shop hours; any NULL/absent shop day or hour field likewise contributes no slots and MUST NOT fall back to barber hours; NULL service duration excludes the service.

#### Scenario: Boundary and lead time
- GIVEN local time is 10:00 today and a 30-minute service
- WHEN slots are computed
- THEN 10:30 is the earliest eligible start, today+13 is eligible, and today+14 is excluded
- AND a slot ending at the window boundary is excluded

#### Scenario: Missing barber schedule
- GIVEN the shop has hours but a barber has NULL hours or days
- WHEN availability is computed
- THEN that barber contributes no slots

#### Scenario: Missing shop schedule
- GIVEN a barber has hours and working days but the shop-level schedule fields are NULL
- WHEN availability is computed
- THEN the result contains no slots
- AND no slot is derived from the barber's hours as a fallback

### Requirement: Occupancy and blocks

The computation MUST exclude candidate intervals overlapping `pendiente`, `confirmado`, or `completado` appointments for the barber. `cancelado` and `ausente` MUST NOT occupy intervals. Full-day blocks (both times NULL) exclude the date; partial blocks exclude `[hora_inicio, hora_fin)`. Back-to-back intervals MUST remain valid.

#### Scenario: Occupied interval
- GIVEN a candidate overlaps a `confirmado` appointment or a block
- WHEN availability is computed
- THEN the candidate is absent

#### Scenario: Empty published calendar
- GIVEN a published shop has valid services but no applicable appointments or blocks
- WHEN availability is requested
- THEN an empty calendar is a valid successful result

### Requirement: Read-only tokens and flow boundary

Each returned slot MUST include a stateless, HMAC-signed availability token expiring exactly 10 minutes after issuance. The token is **signed, not encrypted**: its integrity is protected by an HMAC signature, but its claims are readable by anyone holding the token, and the token is deliberately handed to the browser. The token MUST NOT be persisted; its payload MUST contain exactly `slug`, `service`, `start`, `end`, `iat`, and `exp` (`exp` = `iat` + 600) and MUST NOT contain a `v` (version) field or any other claim, and no internal IDs or personal data. `slug` is a public identifier and `service` is the catalog's opaque `publicServiceToken`; neither is a secret, and no credential is ever placed in the token. Fase 2 MUST NOT create, update, cancel, or reserve anything. Fase 3 MUST consume this contract and re-enforce the same 30-minute lead-time rule server-side.

#### Scenario: Token expiry
- GIVEN a slot token issued at 12:00
- WHEN it is presented at 12:10:01
- THEN it is rejected as expired and no mutation occurs

#### Scenario: Token payload shape
- GIVEN a slot token issued by the Edge Function
- WHEN its payload is decoded
- THEN it contains exactly `slug`, `service`, `start`, `end`, `iat`, and `exp`
- AND it contains no `v` field and no other claim

#### Scenario: Token is signed, not encrypted
- GIVEN a slot token issued by the Edge Function
- WHEN the token is examined without the signing secret
- THEN its base64url payload remains the readable `{slug, service, start, end, iat, exp}` claims
- AND the signature only proves integrity, so `slug` and `service` MUST be treated as public; this availability token is a different value from the catalog's `publicServiceToken`, which the catalog spec describes as opaque

#### Scenario: End of read flow
- GIVEN a visitor selects a displayed slot
- WHEN the read-only flow reaches its final state
- THEN it states that booking continues in a later stage and performs no booking mutation
