# public-context-read Specification

## Purpose

Public barbershop context by unique identifier, via the Edge Function/RPC boundary only.

## Requirements

### Requirement: Unique public identifier and non-enumeration

`Barberia` MUST expose a slug, unique by database constraint, resolving `/b/[slug]`. Non-existent and unpublished slugs MUST yield the same consistent not-found response on every public read — indistinguishable to callers (plan_web_publica.md §6).

#### Scenario: Duplicate slug rejected

- GIVEN a slug assigned to one `Barberia`
- WHEN assigned to another
- THEN the unique constraint rejects it

#### Scenario: Unknown versus unpublished

- GIVEN one non-existent and one unpublished slug
- WHEN each is requested
- THEN both return the identical not-found response

### Requirement: Context DTO

The context read MUST return exactly `{ barberia: { name, description }, barbers: [{ name, alias, description, photoUrl }] }` — no internal ids (`id`, `barberia_id`, `barbero_id`, `users_id`), no `publicToken` (deferred; additive later).

#### Scenario: Exact field set

- GIVEN a published `Barberia` with one active `Barbero`
- WHEN context is requested by slug
- THEN the response holds exactly these fields, no others

### Requirement: Edge Function/RPC-only read boundary

Every public read MUST traverse the Edge Function/RPC boundary. `anon` MUST hold zero table grants and MUST gain none (db-baseline.md §4–5); direct REST/PostgREST table access by `anon` MUST be impossible.

#### Scenario: Anonymous direct-table probe

- GIVEN an anonymous client
- WHEN it issues direct REST selects on `Barberia`, `Barbero`, `Servicio`
- THEN every request is denied
