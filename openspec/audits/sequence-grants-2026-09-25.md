# Sequence grants audit — 2026-09-25

## Why this exists

Found incidentally while closing the grants on the new `"BookingIdempotency"` table added by
`phase13_public_crear_turno`. The finding is **pre-existing and unrelated to that phase**: it is not
introduced by phase13, and phase13 only happens to make it visible because it revokes grants on a
newly created sequence.

`phase8_grants_hardening` hardened table grants and closed IDOR paths. It never touched sequences.

Nothing in this audit has been applied to any database.

## What was found

`authenticated` holds `UPDATE` on **every** identity sequence in `public`. `UPDATE` on a sequence is
exactly the privilege `setval()` requires.

| Sequence | `authenticated` can `setval` | `anon` can `setval` |
|---|---|---|
| `turno_id_seq` | **yes** | no |
| `cliente_id_seq` | **yes** | no |
| `Barberia_id_seq` | **yes** | no |
| `BloqueoHorario_id_seq` | **yes** | no |
| `CodigoVerificacion_id_seq` | **yes** | no |
| `emprendedor_id_seq` | **yes** | no |
| `servicio_id_seq` | **yes** | no |

## Why this is a real problem, not a cosmetic grant

`setval('public.turno_id_seq', N)` rewrites the counter that hands out `"Turno".id`. If `N` is set at
or below the current maximum, the next inserts receive ids that already exist and fail on the
primary key. The sequence is **shared by every tenant**, so the damage is not scoped to the caller's
own barbershop: it breaks booking inserts for all of them.

The capability is not theoretical. It is granted by the default privileges that `postgres` applies
to every newly created sequence in this schema, and it was never revoked.

**Verified:** the privilege itself, read live from `pg_catalog` (query below).
**Not executed:** the exploit. Running `setval` against production would have caused exactly the
outage this audit describes, so the impact is reasoned from documented `setval`/sequence semantics
rather than reproduced.

## Evidence (exact, read-only)

```sql
SELECT c.relname AS sequence,
       coalesce((SELECT string_agg(DISTINCT a.grantee::regrole::text, ', ')
                 FROM aclexplode(c.relacl) a WHERE a.grantee <> 0), '(sin ACL)') AS grantees,
       has_sequence_privilege('authenticated', c.oid, 'UPDATE') AS authenticated_puede_setval,
       has_sequence_privilege('anon', c.oid, 'UPDATE') AS anon_puede_setval
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'S'
ORDER BY c.relname;
```

Observed on project `vcgyiyrboumimwgdsitf` (PostgreSQL 17.6): every row returns
`authenticated_puede_setval = true` and `anon_puede_setval = false`.

## Root cause

Schema-level default privileges for role `postgres`:

```
tablas:     postgres=arwdDxtm/postgres, authenticated=arwdDxtm/postgres, service_role=arwdDxtm/postgres
sequences:  postgres=rwU/postgres,      authenticated=rwU/postgres,      service_role=rwU/postgres
```

`rwU` on a sequence is SELECT + UPDATE + USAGE, so `authenticated` inherits `setval` on anything
created later by `postgres`. Confirmed against `pg_default_acl`.

Note there is a second default ACL set owned by `supabase_admin` that also includes `anon`. The
effective set depends on which role creates the object, so a future migration run as `supabase_admin`
would grant `anon` too. Any hardening should therefore revoke from `PUBLIC, anon, authenticated`
rather than only from `authenticated`.

## Blast radius and severity

- **Who can trigger it:** any `authenticated` session. There is no self-signup, so accounts are
  seeded barbers — the actor is a legitimate tenant user, or anyone who obtains one set of
  credentials. This bounds the severity but does not remove it: one compromised barber account can
  stop bookings for every shop.
- **What is not affected:** `anon` is clean. Table rows are not readable through this path; the
  sequence discloses nothing but a counter.
- **What it is not:** not a data-exfiltration vector. It is an integrity/availability vector.

## Remediation (proposed, NOT applied)

Revoke on every non-extension sequence in `public`, resolving names from the catalog instead of
hardcoding them. The name is not inferable: `pg_get_serial_sequence` returns
`public.turno_id_seq` unquoted for table `"Turno"` but `public."CodigoVerificacion_id_seq"` quoted,
so a literal name would be wrong for some tables.

```sql
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.oid::regclass AS seq
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'S'
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.objid = c.oid AND d.classid = 'pg_class'::regclass AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated', r.seq);
    EXECUTE format('GRANT ALL ON SEQUENCE %s TO service_role', r.seq);
  END LOOP;
END $$;
```

`phase13_public_crear_turno` already applies this pattern to its own table's sequence, so the same
revocation on the seven pre-existing ones is consistent with the posture established there.

Recommended home: a separate `phase14_grants_sequences.sql` plus its rollback, mirroring the
hand-applied `phaseN_` convention in `supabase/sql/README.md`. It is an independent concern from
public booking, and the phase13 pair is already at 439 lines, over this repository's 400-line
review budget.

## Verification after applying

Re-run the evidence query above. Every row must return
`authenticated_puede_setval = false` and `anon_puede_setval = false`, with `service_role` retaining
access so the `SECURITY INVOKER` RPCs can still insert.

## Provenance

Discovered by an AI agent session working from `/home/mauro/proyecto-final-rn`. Recorded as finding
**F2** in `odd/tasks/public-crear-turno.md` and mirrored to Engram topic `odd/public-crear-turno/tasks`.
Nothing was applied, committed, or pushed.
