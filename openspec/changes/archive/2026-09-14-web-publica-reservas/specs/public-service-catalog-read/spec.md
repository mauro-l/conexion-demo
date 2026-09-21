# public-service-catalog-read Specification

## Purpose

Minimal public service catalog DTO.

## Requirements

### Requirement: Catalog DTO

The catalog read MUST return exactly `{ services: [{ name, durationMinutes, price }] }` — no internal ids (`id`, `barbero_id`), no storage-shape leakage.

#### Scenario: Exact field set

- GIVEN the published barbershop's barber has `Servicio` rows
- WHEN catalog is requested
- THEN each service exposes exactly name, durationMinutes, price

### Requirement: DB-authoritative resolution

Services MUST resolve through the single `Barbero` of the published `Barberia` (`Servicio.barbero_id`); no catalog migration, no deduplication. `durationMinutes` MUST derive from `Servicio.duracion` (`numeric`) in the database; clients MUST never supply or alter duration or price.

#### Scenario: Duration comes from the database

- GIVEN a service stored with numeric `duracion`
- WHEN catalog is read, whatever the client sends
- THEN durationMinutes equals the DB value in minutes
