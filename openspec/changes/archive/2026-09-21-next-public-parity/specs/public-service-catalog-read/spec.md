# Delta for public-service-catalog-read

## MODIFIED Requirements

### Requirement: Catalog DTO

The catalog read MUST return exactly `{ services: [{ name, durationMinutes, price, description }] }` — no internal ids (`id`, `barbero_id`) or storage-shape leakage. Each service MUST expose exactly the four listed fields, with `description` nullable where the live function returns it.
(Previously: Each service was specified as exactly `name`, `durationMinutes`, and `price`.)

#### Scenario: Exact field set

- GIVEN the published barbershop's barber has `Servicio` rows with descriptions
- WHEN catalog is requested
- THEN each service exposes exactly name, durationMinutes, price, and description
- AND no internal identifiers are present

### Requirement: DB-authoritative resolution

Services MUST resolve through the single `Barbero` of the published `Barberia` (`Servicio.barbero_id`); no catalog migration, no deduplication. `durationMinutes`, `price`, and `description` MUST come from the database response; clients MUST never supply or alter duration or price.
(Previously: Database authority covered duration and price while the DTO omitted description.)

#### Scenario: Duration, price, and description come from the database

- GIVEN a service stored with numeric `duracion`, `precio`, and `descripcion`
- WHEN catalog is read, whatever the client sends
- THEN durationMinutes, price, and description equal the database values
