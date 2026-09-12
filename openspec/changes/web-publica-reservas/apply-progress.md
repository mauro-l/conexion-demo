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
| Runtime harness command/scenario and exact result | `N/A` — SQL files are produced but not executed; the orchestrator applies them via Supabase MCP against `vcgyiyrboumimwgdsitf`. |
| Rollback boundary | Run `supabase/migrations/phase9_public_barberia_discovery_rollback.sql`, then delete the demo rows seeded by `supabase/seed_demo.sql`. This removes only PR 1 artifacts and leaves `Servicio` schema, existing RLS policies, and `anon` grants untouched. |

## What remains for the orchestrator

1. Apply `phase9_public_barberia_discovery.sql` to project `vcgyiyrboumimwgdsitf` via Supabase MCP.
2. Verify grants: `anon` must still hold zero table/function grants; `service_role` must hold EXECUTE on `public_context` and `public_catalog`.
3. Run `seed_demo.sql` (after ensuring the demo auth user exists, creating it externally if the self-insert fails).
4. Verify the RPC contracts:
   - `select public_context('conexion-barberia')` returns the context DTO.
   - `select public_context('no-such-slug')` and the unpublished case return the identical `PUBLIC_RESOURCE_NOT_FOUND` body.
   - `select public_catalog('conexion-barberia')` returns four services with numeric `durationMinutes` and `price`.
5. Tick tasks 1.1 and 1.2 in `openspec/changes/web-publica-reservas/tasks.md` after DDL is applied and verified.

## Task state (honest)

- [ ] 1.1 Migration and rollback created in repo; pending orchestrator application/verification.
- [ ] 1.2 Seed file created in repo; pending orchestrator execution/verification.

## Workload / PR boundary

- Mode: chained PR slice
- Current work unit: PR 1 — schema and data foundation
- Boundary: starts from an empty `supabase/` directory; ends with migration, rollback, and seed files delivered. Does not include Astro scaffold, Edge Functions, or UI.
- Estimated review budget impact: ~240 authored lines across the three SQL files and this progress file; well under the 400-line attempt budget.

## Deviations from design.md

None — implementation matches design.md and the five specs.

## Issues found

- `tasks.md` still shows `Chain strategy: pending user choice`, while `design.md` line 72 states `ask-on-risk` has resolved chaining as `stacked-to-main`. The prompt resolved this batch by assigning work unit 1 (PR 1) only, so the inconsistency does not block this slice; the orchestrator should confirm the final chain strategy for PRs 2 and 3.
- `Barbero.activo` is nullable with no default (db-baseline.md §2). The seed sets `activo = true`; the RPCs filter `ba.activo = true`, so NULL rows are correctly treated as inactive.
