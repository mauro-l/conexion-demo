# Delta for public-context-read

## MODIFIED Requirements

### Requirement: Unique public identifier and non-enumeration

`Barberia` MUST expose a slug, unique by database constraint, resolved for the public landing at `/` from the server-only `BARBERSHOP_PUBLIC_SLUG` configuration rather than from a URL segment. Non-existent and unpublished configured slugs MUST yield the same consistent not-found response on every public read, indistinguishable to callers (plan_web_publica.md §6).
(Previously: A unique slug resolved the public route `/b/[slug]` from a URL parameter.)

#### Scenario: Duplicate slug rejected

- GIVEN a slug assigned to one `Barberia`
- WHEN assigned to another
- THEN the unique constraint rejects it

#### Scenario: Unknown versus unpublished

- GIVEN one unknown and one unpublished configured slug
- WHEN the landing attempts each public read
- THEN both return the identical not-found response

#### Scenario: Slug is server-only

- GIVEN `BARBERSHOP_PUBLIC_SLUG` is configured
- WHEN `/` requests context
- THEN the configured value is sent only from the server to the Edge Function
- AND it is absent from the public URL and rendered HTML

### Requirement: Context DTO

The context read MUST return exactly `{ barberia: { name, description, address, hours, whatsappUrl, instagramHandle, instagramUrl }, barbers: [{ name, alias, description, photoUrl }] }` — no internal ids (`id`, `barberia_id`, `barbero_id`, `users_id`) and no `publicToken` (deferred; additive later). The seven `barberia` fields and four `barbers` fields are the complete field sets, including nullable values where the live function returns them.
(Previously: The `barberia` object was specified as exactly `name` and `description`.)

#### Scenario: Exact field set

- GIVEN a published `Barberia` with one active `Barbero` and landing details
- WHEN context is requested by the configured slug
- THEN the response contains exactly the seven `barberia` fields and four barber fields
- AND no internal or token fields are present

### Requirement: Edge Function/RPC-only read boundary

Every public read MUST traverse the Edge Function/RPC boundary. `anon` MUST hold zero table grants and MUST gain none (db-baseline.md §4–5); direct REST/PostgREST table access by `anon` MUST be impossible.
(Previously: The same Edge Function/RPC-only boundary applied to `/b/[slug]` reads.)

#### Scenario: Anonymous direct-table probe

- GIVEN an anonymous client
- WHEN it issues direct REST selects on `Barberia`, `Barbero`, or `Servicio`
- THEN every request is denied
