# public-service-catalog-read Specification

## Purpose

Minimal public service catalog DTO.

## Requirements

### Requirement: Catalog DTO

The catalog read MUST return `{ services: [{ publicServiceToken, name, durationMinutes, price, description }] }`; each service MUST expose exactly these five fields, with nullable `description` where supported. `publicServiceToken` MUST be opaque, unique, non-NULL, and MUST NOT be an internal identifier. It is a random uncorrelated value (not a derived or reversible encoding of any internal id), and it is a different value from the availability token: `publicServiceToken` is the catalog's lookup handle, while the signed availability token described in `public-availability-read` merely references it as a claim. The response MUST expose no `id` or `barbero_id`.

(Previously: each service exposed exactly four fields and had no public token.)

#### Scenario: Tokenized exact field set
- GIVEN a published barber has services with descriptions
- WHEN the catalog is requested
- THEN each service exposes exactly the five defined fields
- AND no internal identifiers are present

### Requirement: DB-authoritative resolution

Services MUST resolve through `Servicio.barbero_id` and the published shop's active barbers. `name`, `durationMinutes`, `price`, `description`, and `publicServiceToken` MUST come from the database; clients MUST never supply or alter duration or price. A migration MUST add `Servicio.public_service_token text NOT NULL UNIQUE`, generate cryptographically opaque values for existing and new rows, and preserve each value across renames and price changes. Rotation MUST be an explicit server-side operation and MUST invalidate the old token; this migration is a required deliverable.

(Previously: resolution was database-authoritative for four fields and required no token migration.)

#### Scenario: Server-side token resolution
- GIVEN a catalog token and changed database price or duration
- WHEN `/reservar?service=<token>` is read
- THEN the service is re-resolved by token and current database values are used

#### Scenario: Duration, price, and description come from the database
- GIVEN a service stored with numeric duration, price, and description
- WHEN the catalog is read, regardless of client input
- THEN durationMinutes, price, and description equal the database values

#### Scenario: Null duration
- GIVEN a service whose database duration is NULL
- WHEN availability is requested for its token
- THEN the request succeeds with HTTP 200 and still returns the service snapshot
- AND the `days` array is empty
- AND the service is excluded from slot computation, with no error response and no fallback duration
