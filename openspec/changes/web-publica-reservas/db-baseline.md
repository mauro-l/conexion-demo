# DB baseline — live introspection of the target Supabase project

> Evidence for `web-publica-reservas`. Captured 2026-09-11 by read-only introspection
> (Supabase MCP: `list_tables`, `list_migrations`, `pg_constraint`, `pg_policies`,
> `information_schema.role_table_grants`, `pg_proc`).
>
> **Why this file exists**: `src/types/database.types.ts` in the sibling repo is
> hand-maintained and demonstrably incomplete. The repository also lacks the migration
> that creates `turno_sin_solape`. Neither the types file nor the repo can be trusted as
> schema truth. This is the observed state.

## 1. Applied migrations

| Version | Name | Present as a repo file? |
|---|---|---|
| 20260911195434 | `turno_no_solape_estricto` | **NO** |
| 20260911215651 | `phase2_turno_tenant_integrity` | yes |
| 20260911220831 | `phase3_servicio_catalog` | yes |
| 20260911220837 | `phase4_crear_turno_atomico` | yes |
| 20260911223359 | `phase8_grants_hardening` | yes |

The database **cannot be reproduced from the repository**: the migration that creates the
anti-overlap constraint is applied but unversioned in git.

## 2. Tables and real columns

All tables have `rls_enabled = true`.

**`Barberia`** — `id bigint PK`, `created_at timestamptz`, `nombre varchar`,
`admin_user_id uuid → auth.users`, `hora_apertura time`, `hora_cierre time`,
`dias_habiles int2[]`.
No slug, no public identifier, no publication flag.

**`Barbero`** — `id bigint PK`, `created_at timestamptz`, `nombre varchar`,
`users_id uuid → auth.users`, `descripcion text`, `duracion_default smallint`,
`precio_base numeric`, `alias varchar`, `foto_url text`, `activo boolean`,
`barberia_id bigint → Barberia`, `dias_habiles int2[]`, `hora_apertura time`,
`hora_cierre time`.
Barber-level working hours exist. `activo` is nullable with no default.

**`Servicio`** — `id bigint PK`, `nombre varchar`, `duracion numeric`, `precio numeric`,
`barbero_id bigint → Barbero`.
**No `activo` column.** Services hang off a *barber*, not the barbershop.

**`Turno`** — `id bigint PK`, `created_at timestamptz`, `estado estado_turno`
(default `pendiente`), `inicio timestamp without time zone`, `cliente_id bigint → Cliente`,
`barbero_id bigint → Barbero`, `update_at timestamptz`, `servicio_id bigint → Servicio`,
`origen text`, `duracion_minutos smallint`.
`estado_turno` = `pendiente | confirmado | completado | cancelado | ausente`.
No `pending_expires_at`, no idempotency storage, no cancellation token.

**`Cliente`** — `id bigint PK`, `nombre varchar`, `notas text`, `ultima_visita timestamptz`,
`created_at timestamptz`, `telefono numeric`, `barberia_id bigint → Barberia`,
`email text`.
`telefono` is **numeric**, not text. `email` is nullable. **No unique constraint** on
`(barberia_id, email)` or `(barberia_id, telefono)`.

**`BloqueoHorario`** — `id bigint PK`, `created_at timestamptz`, `barbero_id bigint → Barbero`,
`fecha date`, `hora_inicio time NULL`, `hora_fin time NULL`, `motivo text`.
Null hours = full-day block.

**`CodigoVerificacion`** — `id bigint PK`, `created_at timestamptz`, `email text`,
`codigo text`, `turno_id bigint → Turno`, `expiracion timestamptz`, `usado boolean`
(default false). RLS enabled with **zero policies**.

## 3. Constraints (verbatim)

The anti-overlap constraint, exactly as applied:

```sql
EXCLUDE USING gist (
  barbero_id WITH =,
  tsrange(inicio, inicio + (duracion_minutos::double precision * '00:01:00'::interval), '[)') WITH &&
) WHERE (estado = ANY (ARRAY['pendiente'::estado_turno, 'confirmado'::estado_turno, 'completado'::estado_turno]))
```

Consequences that matter:
- A `pendiente` booking **blocks** the interval.
- `cancelado` and `ausente` **do not block** → cancelling frees the slot immediately.
- It is scoped **per `barbero_id`**, not per barbershop.

Other constraints: `turno_origen_check` (`origen IN ('web','whatsapp','presencial')`),
`turno_duracion_valida` (`duracion_minutos > 0 AND <= 480`). All FKs as listed above.

## 4. RLS policies — every policy is `authenticated` only

There is **no `anon` policy anywhere**.

| Table | Policies |
|---|---|
| `Barberia` | `Barberia select own` (SELECT) |
| `Barbero` | `Barbero select own` (SELECT), `Barbero update own` (UPDATE) |
| `Servicio` | `Servicio select own` (SELECT) — **no INSERT/UPDATE/DELETE policy** |
| `Turno` | `select own`, `insert own`, `update own`, `delete own` |
| `Cliente` | `insert barberia`, `select barberia`, `update barberia` |
| `BloqueoHorario` | `select own`, `insert own`, `update own`, `delete own` |
| `CodigoVerificacion` | **none** |

Ownership is always resolved through `Barbero.users_id = auth.uid()`.

## 5. Grants

| Table | anon | authenticated | service_role |
|---|---|---|---|
| `Barberia` | — | SELECT | full |
| `Barbero` | — | DELETE, INSERT, SELECT | full |
| `Servicio` | — | SELECT | full |
| `Turno` | — | DELETE, INSERT, SELECT | full |
| `Cliente` | — | DELETE, INSERT, SELECT | full |
| `BloqueoHorario` | — | DELETE, INSERT, SELECT, UPDATE | full |
| `CodigoVerificacion` | — | — | full |

`anon` holds **nothing**. Note `authenticated` has SELECT on `Servicio` but no write
grant, so the catalog is centrally managed.

## 6. Functions

| Function | Security | Args | ACL |
|---|---|---|---|
| `crear_turno` | **INVOKER** | `p_servicio_id bigint, p_inicio timestamp without time zone, p_origen text, p_nombre text, p_apellido text, p_telefono numeric` | postgres, authenticated, service_role |
| `fn_barbero_pertenencia_inmutable` | INVOKER | — | postgres, service_role |
| `fn_cliente_pertenencia_inmutable` | INVOKER | — | postgres, service_role |
| `fn_turno_validar_relaciones` | INVOKER | — | postgres, service_role |

All have `search_path=public, pg_temp`. `crear_turno` is **not** granted to `anon`.

**`crear_turno` takes no email** — it receives `p_nombre`, `p_apellido`, `p_telefono`.
The `Cliente.email` column exists but is not populated by this RPC.

## 7. Deltas vs `database.types.ts`

The hand-maintained types file is wrong. Confirmed differences:

- `Barbero.dias_habiles`, `Barbero.hora_apertura`, `Barbero.hora_cierre` are **missing**
  from the types file entirely.
- `phase2_turno_tenant_integrity.sql:96` grants UPDATE on `Barbero.duracion_default` and
  `Barbero.precio_base`; the types file omits them from the updatable surface.
- Any column list taken from that file must be re-verified against this baseline.

## 8. Implications for this change

1. **No public identifier exists.** A slug/token on `Barberia` (or a publication table)
   requires a new migration plus a unique constraint. Decision 1 is still open.
2. **Services are modelled per barber**, but the product decision is that the *barbershop*
   sets services and prices and they are identical for every barber. Reconciling this
   needs an explicit design decision (see the proposal).
3. **No publication flag on `Servicio`.** Making the catalog publishable requires a
   migration and a controlled write path, since `authenticated` currently has no write
   grant on it.
4. **A read-only discovery slice needs no booking machinery.** `turno_sin_solape`,
   idempotency, `pending_expires_at`, confirmation and cancellation are all out of scope
   for slice 1 and can stay untouched.
5. **Availability math can use real data**: `Barbero.dias_habiles`, `hora_apertura`,
   `hora_cierre`, `BloqueoHorario`, and `Turno.inicio` + `duracion_minutos` are all present.
