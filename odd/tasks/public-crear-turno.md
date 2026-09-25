> ## READ FIRST — handoff notice
>
> This work was authored from a **different repository** (`/home/mauro/proyecto-final-rn`) by an
> AI agent, which did **not** first confirm which repo owns the public booking phases. The owner
> reviewed it and chose to **keep the changes rather than revert**. This notice exists so whoever
> works in this repo next knows exactly what appeared and why.
>
> **Added or changed in THIS repo by that session — nothing is committed:**
>
> | State | Path |
> |---|---|
> | `??` new | `supabase/sql/phase13_public_crear_turno.sql` (428 lines) |
> | `??` new | `supabase/sql/phase13_public_crear_turno_rollback.sql` (11 lines) |
> | ` M` edited | `supabase/sql/README.md` (apply-order row 5 + dependency note) |
> | `??` new | `openspec/audits/sequence-grants-2026-09-25.md` (finding F2, pre-existing sequence grants hole) |
> | `??` new | `lib/telefono.ts` (verbatim `cp` of `proyecto-final-rn/src/lib/telefono.ts`, sha256 `2d31af58ad1eb2b376676cb75e945ea808f2f9b22c79cbe3869df2b26e97fc14`, 61 lines, no imports) |
> | `??` new | `odd/` — this document. An orchestrator artifact, **not** a repo convention. Delete `odd/` if it does not belong here. |
>
> **Known alias mismatch after the port:** `telefono-canonico-frontend.md:48` tells consumers to
> `import { normalizarCelularAR } from '@/lib/telefono'`, but this repo's `tsconfig.json` maps
> **`~/*` -> `./*`** and defines no `@/*`. The correct import here is `~/lib/telefono`. The guide is a
> verbatim copy of the React Native repo's doc, where `@/*` -> `src/*` does exist.
>
> **Not done:** nothing was committed, nothing was pushed, and **nothing was applied to any
> database**. `public.public_crear_turno` does not exist in `vcgyiyrboumymimwgdsitf`'s catalog and
> `phase13` is absent from `supabase_migrations.schema_migrations`. The work is fully reversible
> with `git checkout -- supabase/sql/README.md && rm supabase/sql/phase13_* && rm -rf odd/`.
>
> **Read next:** the "Decisions taken" table (D1-D6), the "Resolved findings" table (F1), and
> "Verification evidence" below. Everything asserted there was checked with evidence; the parts
> that were only reasoned, never executed, say so explicitly.
>
> **Provenance:** an Engram handoff also exists under topic `handoff/public-crear-turno`.

# public_crear_turno — public booking RPC

## Source requirement (verbatim, from the owner)

> **A new RPC, `public_crear_turno`, with the same posture as the other three public ones:
> `SECURITY INVOKER`, `REVOKE` from `PUBLIC`, `anon`, `authenticated`, `GRANT` only to
> `service_role`.**
>
> **Input:**
> ```
> p_slug            text,       -- Barberia.public_slug
> p_service_token   text,       -- Servicio.public_service_token (opaque, 32 hex)
> p_inicio          timestamp,  -- Buenos Aires local time, no zone
> p_nombre          text,
> p_apellido        text,
> p_telefono        text,       -- canonical +549... (normalized by the front end)
> p_telefono_raw    text,
> p_idempotency_key text
> ```
>
> **It must:**
> 1. Resolve `p_slug` -> `Barberia.publicado = true`, and `p_service_token` -> `Servicio` ->
>    `Barbero.activo = true`. The barber comes from there, with no parameter; the public flow does
>    not choose a professional.
> 2. Re-validate server-side, trusting nothing from the browser: `p_inicio >= now() + 30 min` (the
>    same rule availability uses), working day, inside effective hours, no block covering it, and
>    that it corresponds to a real slot.
> 3. Insert `Cliente` (nombre = nombre + apellido, `telefono_raw`, `telefono_normalizado`; the
>    `cliente_telefono_formato_chk` CHECK already enforces the format) and `Turno` with
>    `estado='confirmado'`, `origen='web'`, `duracion_minutos` from `Servicio.duracion`.
> 4. Let `turno_sin_solape` be the final authority. Two simultaneous bookings: one wins, the other
>    fails. Do not reinvent the lock.
> 5. Return a public DTO: the created booking, with no internal ids.
>
> **Idempotency (second step, not blocking for the first cut):** with `p_idempotency_key`, if it was
> already created, return the same booking instead of creating another. Without it, a retry after a
> success collides with `turno_sin_solape` and the user sees "failed" when the booking actually
> happened. It requires a new table; the plans call it `booking_idempotency`.
>
> **Suggested order:** 1. the RPC alone, without idempotency (that already makes real booking
> possible). 2. Verify it from the SQL Editor with a real token, exactly as was done for
> availability. 3. Only after that, the booking Edge Function, the form, and idempotency.
>
> **Standing instruction:** "When you have it, tell me and I verify it with the MCP before you write
> a single line of frontend."

**Delivery note:** the delivered signature intentionally omits `p_idempotency_key` — see D1. Every
other point above is implemented. This requirement is recorded verbatim so the next session reads
the owner's exact words instead of this document's paraphrase of them. **Frontend work is gated on
the owner's MCP verification of the applied RPC.**

## Objective

Add the server-side writer that turns a validated public slot into a real booking:
`public.public_crear_turno(p_slug, p_service_token, p_inicio, p_nombre, p_apellido, p_telefono, p_telefono_raw)`,
with the same posture as the other three public RPCs.

## Problem / Why

`public_availability` is read-only: it can show slots but cannot reserve. The only existing
writer, `public.crear_turno`, is `SECURITY INVOKER` gated on `auth.uid()` and returns a raw
`"Turno"` row (internal ids), so it is unusable from the anonymous public surface. Until this RPC
exists, the public web cannot actually book.

## Scope (this cut)

**In scope**
- `phase13_public_crear_turno.sql` + `_rollback.sql`.
- Server-side re-validation of everything the browser claims: lead time, working day, effective
  hours, 30-minute grid, blocks, and the real slot.
- `Cliente` + `Turno` insert in one atomic unit; `turno_sin_solape` remains the final authority.
- ID-free public DTO.
- README apply-order update.

**Out of scope (explicitly deferred, in this order)**
1. `booking_idempotency` table + `p_idempotency_key` handling.
2. Edge Function `public-booking`.
3. Booking form + error states in Next.
4. `Cliente` dedup by normalized phone — open decision, see D2.

## Authorization

Owner authorized step 1 only: "La RPC sola, sin idempotencia." No database mutation, no Edge, no
commit without an explicit request.

## Decisions taken (flag to owner)

| ID | Decision | Rationale |
|---|---|---|
| D1 | `p_idempotency_key` is **omitted** from this cut. | An accepted-but-inert key is a silent trap: the caller believes retries are safe and gets a duplicate-booking failure attributed to a real error. Added later by `DROP` + `CREATE` — there are no callers yet, so no overload is ever created. |
| D2 | No `Cliente` dedup; always insert a new row, mirroring `crear_turno`. | Faithful to the written spec ("Insertar Cliente"). Dedup by `(barberia_id, telefono_normalizado)` is likely desirable but needs a unique index to be race-safe, which is a schema change beyond this cut. |
| D3 | DTO in English camelCase. | Matches the existing public contract (`publicServiceToken`, `durationMinutes`, `price`). |
| D4 | Error codes from the plan vocabulary. | `plan_web_publica.md` lists them; reuse instead of inventing. |
| D5 | Born `estado = 'confirmado'`, `origen = 'web'`. | Owner spec + `plan_next_web_completa.md` §13. `plan_web_publica.md` says `pending`; owner wins. |
| D6 | File prefix `phase13_`. | Sequential after phase12; `supabase/sql/README.md` ordering. |

## Tasks

| # | Task | Route |
|---|---|---|
| T1 | Author `supabase/sql/phase13_public_crear_turno.sql` | delegated writer |
| T2 | Author `supabase/sql/phase13_public_crear_turno_rollback.sql` | delegated writer |
| T3 | Update `supabase/sql/README.md` (apply order row 5 + dependency note) | delegated writer |
| T4 | Static readback: signature, posture, grants, idempotency guards, ID-free DTO, subtransaction catch | orchestrator |
| T5 | Apply to hosted `vcgyiyrboumimwgdsitf` and verify with a real token from the SQL Editor | **next step, needs owner go-ahead** |
| T6 | Edge `public-booking` + form + `booking_idempotency` | deferred |

## Acceptance criteria

- `SECURITY INVOKER`, `SET search_path = public, pg_temp`, `REVOKE` from `PUBLIC, anon,
  authenticated`, `GRANT` only to `service_role`.
- `CREATE OR REPLACE`, wrapped in `BEGIN`/`COMMIT`, `IF NOT EXISTS` where applicable → re-runnable.
- No lead time, working day, effective hours, grid or block state is trusted from the input.
- `p_inicio` is recomputed as a real slot under the exact phase12 semantics.
- A lost race (SQLSTATE `23P01`) returns `SLOT_UNAVAILABLE` and leaves **no orphan `Cliente`**.
- No internal identifier (`id`, `barbero_id`, `cliente_id`, `servicio_id`, `barberia_id`) in the DTO.
- Pure ASCII SQL, `"PascalCase"` identifiers quoted exactly as the schema spells them.

## Checks

- Static readback against `phase12_public_availability.sql` as the style/pattern reference.
- `git diff --stat`; no commit.
- No local Postgres is assumed, so step-1 correctness is by careful reading; runtime proof is T5.

## Resolved findings

| ID | Finding | Resolution |
|---|---|---|
| F1 | `public_crear_turno` did NOT verify that the anti-overlap exclusion constraint exists and still covers `confirmado`. `phase12` deliberately fails closed on that check; `phase13` would never fire its `exclusion_violation` handler if the constraint were dropped or weakened, and would insert overlapping `confirmado` bookings silently. | **Fixed** on owner instruction. §1.8 now discovers the single `Turno` exclusion constraint from `pg_constraint` and returns `INTERNAL_ERROR` when it is absent or its definition no longer names `barbero_id`, `tsrange`, `&&`, `[)` or `confirmado`. |

## Progress

- T1–T3: **done** (delegated writer).
- T4: **done** (orchestrator readback).
- T7 (F1 guard): **done** (orchestrator edit, owner-approved).
- T8 (idempotency folded in, owner-approved): **done**. The signature now carries the 8th parameter
  `p_idempotency_key`; the `"BookingIdempotency"` ledger, the atomic key claim, replay and
  `IDEMPOTENCY_KEY_REUSED` are implemented and readback-verified. Forward file is 428 lines
  (rollback 11), pure ASCII.
- T5: pending — awaiting the apply decision.
- T6: deferred.
- T9: **open decision (F2)** below.

## Open findings

| ID | Finding | Recommendation |
|---|---|---|
| F2 | **Pre-existing, not introduced here.** `authenticated` holds `UPDATE` on ALL seven identity sequences in `public` (`turno_id_seq`, `cliente_id_seq`, `Barberia_id_seq`, `BloqueoHorario_id_seq`, `CodigoVerificacion_id_seq`, `emprendedor_id_seq`, `servicio_id_seq`). `UPDATE` on a sequence IS `setval()`, so any logged-in barber can rewrite the shared id counters and manufacture primary-key collisions, breaking booking inserts for every tenant. `anon` is clean. `phase8_grants_hardening` never revoked sequences. | `phase13` already closes this for its own table with a catalog-resolved `DO` block. The other seven want the same revocation. Recommend a separate `phase14_grants_sequences.sql` — the concern is independent of public booking, and this pair is already at 439 lines. Owner decision. Full write-up with evidence, root cause, blast radius and the exact remediation SQL: `openspec/audits/sequence-grants-2026-09-25.md`. |

## Verification evidence

Structural readback (no runtime proof yet; there is no local Postgres in this workflow):

- Signature, `RETURNS jsonb`, `LANGUAGE plpgsql`, `SECURITY INVOKER`, `SET search_path = public,
  pg_temp`, volatile by default: confirmed by reading `phase13_public_crear_turno.sql:28-41`.
- Posture: `REVOKE ... FROM PUBLIC, anon, authenticated` + `GRANT ... TO service_role` + closing
  read-only `pg_proc` probe + `COMMIT` (`:257-275`). No `SECURITY DEFINER`.
- Re-runnable: `CREATE OR REPLACE` only; no unguarded `ALTER`/`CREATE` in the forward file.
- Resolution mirrors `phase12` §3.1: published shop + active barber + `public_service_token`
  (`:56-86`).
- No internal id in the DTO (`:237-253`); barber is derived, never a parameter.
- Both inserts sit inside one `BEGIN … EXCEPTION WHEN exclusion_violation` block, so a lost race
  rolls back the `"Cliente"` row (`:223-234`). No `WHEN OTHERS`.
- Rollback drops the exact 7-argument signature and states that booking data is not reversible
  (`phase13_public_crear_turno_rollback.sql:1-10`).
- Hosted-DB facts verified read-only: `id` on all six tables is `GENERATED ALWAYS AS IDENTITY`
  (so the insert without `id` is correct); server is PostgreSQL 17.6, where `extract(epoch …)`
  returns `numeric`, so the `mod(…, 1800)` grid test resolves; `public_crear_turno` does not exist
  yet and phase13 is absent from `schema_migrations` (clean slate).
- `turno_sin_solape` and `bloqueohorario_horas_completas` both confirmed present on the hosted DB.
- F1 guard verified against the LIVE constraint instead of assumed: simulating the §1.8 predicate
  against `pg_constraint` on the hosted DB returned `xcount = 1` and `guard_would_fail = false`, so
  the guard passes on the real definition and cannot false-positive.
- `pg_get_constraintdef` provably includes the partial `WHERE` clause
  (`WHERE estado = ANY (ARRAY['pendiente','confirmado','completado'])`), which is why requiring only
  `confirmado` is sufficient here and no `pg_index` join is needed (unlike `phase12`, which must
  model the whole occupying set).

Owner's writer query was imprecise about the close boundary: it said "strictly before the exclusive
close", but `phase12`'s slot grid runs `generate_series(eff_open, eff_close - duration, 30m)`, so a
slot MAY end exactly at `eff_close`. The implemented `>` predicate matches `phase12` and is correct.

## Next step

F2 decision, then T5: apply `phase13_*` by hand to `vcgyiyrboumimwgdsitf` in the documented order
and verify from the SQL Editor with a real token. Verification must now cover: a booking created
with an `Idempotency-Key`; the same key and payload replayed returning the identical DTO **without**
a second row in `"Turno"`; the same key with a changed payload returning `IDEMPOTENCY_KEY_REUSED`;
and the same slot booked twice to prove `SLOT_UNAVAILABLE` with no orphan `Cliente` row.

Review size: the phase13 pair is 439 lines plus the README change, over this repo's own 400-line
budget (the reason `phase11`/`phase12` were split). Flagged, not blocking.
