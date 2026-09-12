# Apply Progress: web-publica-reservas — Work Unit 1 (PR 1)

## Scope of this batch

Implementation of Phase 1 / PR 1 only: schema migration, paired rollback, and demo seed.
The web scaffold, Edge Functions, and UI/theme remain for PRs 2 and 3.

## Files created

| File | Purpose |
|---|---|
| `supabase/migrations/phase9_public_barberia_discovery.sql` | Additive migration: `Barberia.public_slug`, `description`, `publicado`; narrow RPCs `public_context` / `public_catalog`; ACL locked to `service_role`. |
| `supabase/migrations/phase9_public_barberia_discovery_rollback.sql` | Reversible rollback: drops the two RPCs and the three added columns. |
| `supabase/seed_demo.sql` | Idempotent demo data: one published barbershop (`conexion-barberia`), one active barber, four services matching the HTML prototypes. |

## Decisions taken

### RPC return shapes

- `public_context(p_slug text)` returns exactly:
  ```json
  {
    "barberia": { "name": "...", "description": "..." },
    "barbers": [
      { "name": "...", "alias": "...", "description": "...", "photoUrl": "..." }
    ]
  }
  ```
- `public_catalog(p_slug text)` returns exactly:
  ```json
  { "services": [ { "name": "...", "durationMinutes": 40, "price": 23000 } ] }
  ```
- `durationMinutes` and `price` are projected with `to_jsonb(...)` so numeric columns become JSON numbers.
- No internal ids (`id`, `barberia_id`, `barbero_id`, `users_id`) and no `publicToken` appear in either payload.

### Not-found shape

A non-existent slug and an unpublished slug (`publicado = false`) return the identical body:
```json
{ "error": { "code": "PUBLIC_RESOURCE_NOT_FOUND", "message": "Resource not found", "retryable": false } }
```
This matches the stable error convention in `plan_web_publica.md` §6.

### Slug value

Demo seed uses `public_slug = 'conexion-barberia'`.

### Seed prerequisite

`Barbero.users_id` is `uuid NOT NULL` → `auth.users(id)`.
The seed attempts to create a deterministic demo auth user idempotently.
If direct `auth.users` inserts are blocked by schema or role limits, the seed fails loudly and the orchestrator/human must create the user via the Supabase Dashboard or Auth Admin API before re-running.

## Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `N/A` — no test runner exists in this greenfield repo until PR 2 creates the Astro/Vitest surface (design.md testing strategy). |
| Runtime harness command/scenario and exact result | Supabase MCP `apply_migration`. First attempt FAILED: `42P01: relation "public.barberia" does not exist`. Corrected by double-quoting the PascalCase identifiers; second attempt returned `{"success":true}`. Followed by read-only verification queries. |
| Rollback boundary | Run `supabase/migrations/phase9_public_barberia_discovery_rollback.sql`, then delete the demo rows seeded by `supabase/seed_demo.sql`. This removes only PR 1 artifacts and leaves `Servicio` schema, existing RLS policies, and `anon` grants untouched. |

## Orchestrator verification (completed)

1. ✅ `apply_migration` returned `{"success":true}` against `vcgyiyrboumimwgdsitf`.
2. ✅ `Barberia` now has `public_slug` (text), `description` (text), `publicado` (boolean NOT NULL DEFAULT false); all pre-existing columns untouched.
3. ✅ Function ACLs are `{postgres=X/postgres, service_role=X/postgres}` — `anon` and `authenticated` are absent.
4. ✅ `anon` holds zero table grants and zero function EXECUTE grants (union query returned `[]`).
5. ✅ `public_context('conexion-barberia')` returns the exact context DTO with no internal ids.
6. ✅ `public_catalog('conexion-barberia')` returns 4 services with numeric `durationMinutes` and `price`.
7. ✅ Non-enumeration PROVEN: an unpublished slug and a nonexistent slug both returned the byte-identical `PUBLIC_RESOURCE_NOT_FOUND` body.
8. ✅ Seed effects verified: 1 published `Barberia` (`conexion-barberia`), 1 active `Barbero`, 4 `Servicio` rows.
9. ✅ Temporary probe row `zz-temp-unpublished-probe` created for the non-enumeration test and deleted afterwards; verified `temp_restante = 0`.

## Task state

- [x] 1.1 Migration and rollback created, applied to `vcgyiyrboumimwgdsitf`, and verified.
- [x] 1.2 Seed executed; demo barbershop, barber and services verified through both RPCs.

## CORRECTION — the database was NOT empty

The initial `list_tables` introspection reported 0 rows for `Barberia`, `Barbero` and `Servicio`, and that claim was carried into `design.md` and `tasks.md`. **It was wrong.** `list_tables` row counts are stale `reltuples` estimates, not real counts. The database actually held 2 `Barberia` rows ("Barbería Piloto", "Barbería Demo") and 1 `Barbero` row ("Mauro Laime", with 5 `Servicio` rows in the unpublished "Barbería Demo").

Impact: none. The migration is purely additive; both pre-existing `Barberia` rows defaulted to `publicado = false`, so nothing pre-existing became publicly reachable. Future schema work on this project must use real `count(*)` queries, never `list_tables` row estimates.

## Workload / PR boundary

- Mode: chained PR slice
- Current work unit: PR 1 — schema and data foundation
- Boundary: starts from an empty `supabase/` directory; ends with migration, rollback, and seed files delivered. Does not include Astro scaffold, Edge Functions, or UI.
- Estimated review budget impact: ~240 authored lines across the three SQL files and this progress file; well under the 400-line attempt budget.

## Deviations from design.md

None — implementation matches design.md and the five specs.

## Issues found

- RESOLVED: `tasks.md` and `design.md` disagreed on the chain strategy. `tasks.md` now records `stacked-to-main`, confirmed by the user.
- `Barbero.activo` is nullable with no default (db-baseline.md §2). The seed sets `activo = true`; the RPCs filter `ba.activo = true`, so NULL rows are correctly treated as inactive.
- The generated SQL referenced the PascalCase tables unquoted, so the first application failed with `42P01`. Fixed and re-verified; see Work Unit Evidence.
- The initial "zero-row database" premise was wrong. See the CORRECTION section above.
