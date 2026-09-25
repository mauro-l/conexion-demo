# Hand-applied SQL migrations

These files are applied **by hand**, in order, against a target project. They are not Supabase CLI
migrations and must not live in `supabase/migrations/`.

## Why they are not in `supabase/migrations/`

The CLI expects `<14-digit timestamp>_name.sql` and orders files by that name. These files use a
`phaseN_` prefix instead, which makes that directory dangerous in three ways:

1. **The order is wrong.** Sorted as strings it becomes `phase10`, `phase11`, `phase12`, `phase9` —
   `phase9` runs LAST. Its `public_catalog` returns only three fields, so it would silently revert
   the five-field version `phase11` installs, dropping `description` and `publicServiceToken` and
   breaking the booking flow. Every DDL statement here is guarded with `IF NOT EXISTS`, so nothing
   would raise an error.
2. **The rollbacks sit in the same directory.** A CLI scanning for migrations cannot tell
   `..._rollback.sql` apart from a forward migration, and these files DROP functions and columns.
   Their `IF EXISTS` guards mean they would succeed silently.
3. **They were never applied by the CLI.** They are applied out of band, so they are absent from the
   remote `supabase_migrations.schema_migrations` history and the CLI would treat them as pending.

Keeping them here means `supabase db push` sees no local migrations at all.

## Apply order

| Order | Forward | Rollback |
|---|---|---|
| 1 | `phase9_public_barberia_discovery.sql` | `phase9_public_barberia_discovery_rollback.sql` |
| 2 | `phase10_public_landing_details.sql` | `phase10_public_landing_details_rollback.sql` |
| 3 | `phase11_public_service_token.sql` | `phase11_public_service_token_rollback.sql` |
| 4 | `phase12_public_availability.sql` | `phase12_public_availability_rollback.sql` |

**Rollbacks run in reverse order: phase12 first, then phase11, phase10, phase9.**

## Dependencies

- `phase12` REQUIRES `phase11`: its RPC resolves the service through `Servicio.public_service_token`,
  the column `phase11` adds. Applying `phase12` without `phase11` succeeds — PL/pgSQL does not
  resolve column names at creation time — and then fails at runtime with `42703
  undefined_column`. This happened on the hosted project on 2026-09-22.
- Rolling back `phase11` while `phase12` is applied breaks the RPC the same way.

## Idempotency

Every forward file is idempotent: `IF NOT EXISTS` on columns and indexes, `WHERE ... IS NULL` on the
backfill, `CREATE OR REPLACE` on functions, and `SET DEFAULT` / `SET NOT NULL` are all safe to
repeat. Re-running a forward file is always safe.

## Applying and verifying

Each file wraps itself in `BEGIN`/`COMMIT`, so run it whole, in the order above, and read the
read-only probe it ends with. Then confirm the result:

```sql
select public.public_catalog('<slug>');                  -- must return publicServiceToken per service
select public.public_availability('<slug>', '<token>');   -- must return days with slots
```

The second call also proves the anti-overlap constraint `turno_sin_solape` exists: the RPC looks it
up in `pg_constraint` and fails closed when it is missing.
