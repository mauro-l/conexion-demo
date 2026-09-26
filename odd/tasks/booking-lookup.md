# Booking lookup from the public footer

Branch: none. Work happens in the working tree on `main`; **the owner owns every
git write** (no branch, add, commit or push). Verify every claim against the code
before trusting it.

## Objective

Let a visitor who lost their management link find their booking from the public
footer: a "Cancelar turno" entry opens a small modal, the visitor enters nombre,
apellido and teléfono, and when those match a real upcoming booking the browser
lands on `/reserva/gestionar?token=…` with a freshly minted management token.

## Problem

Today the only door into `/reserva/gestionar` is the management link returned once
by `BookingForm`'s inline confirmation. Close that tab and the booking becomes
unreachable, so cancellation degrades to "write to the shop".

The prototype `conexion-barber-flujo-footer.html` already carries the intended
affordance: a `.site-footer` with a "Cancelar turno" link, currently pointing at
`/reserva/gestionar` with no token (which renders the invalid-link state).

## Why not simpler

The management token is stored only as a SHA-256 hash (`phase15`), so nothing can
recover the original token. Recognition therefore has to be re-established from
the visitor's own data, and a **new** token has to be minted for that booking.

## Scope

In: the footer, the lookup modal, one new Edge function, one new server-side
Next route, one new RPC + hand-applied migration, and their tests.

Out: customer accounts, login, rescheduling, email/WhatsApp delivery, listing
several bookings, and any `anon`/`authenticated` table access.

## Frozen interfaces

### 1. RPC `public_recuperar_turno` (phase16)

```sql
public_recuperar_turno(
  p_slug     text,
  p_nombre   text,
  p_apellido text,
  p_telefono text,
  p_token_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
```

- Validates: `p_slug ~ '^[a-z0-9-]{1,63}$'`; trimmed `p_nombre`/`p_apellido`
  between 2 and 80 chars; `p_telefono ~ '^\+549(11[0-9]{8}|[23][0-9]{9})$'`;
  `p_token_hash ~ '^[a-f0-9]{64}$'`. Anything else → `INVALID_INPUT`.
- Resolves the shop by `Barberia.public_slug = p_slug AND publicado = true`;
  missing → `PUBLIC_RESOURCE_NOT_FOUND`.
- Picks the **nearest upcoming** booking that matches identity:

  ```sql
  JOIN "Cliente" c ON c.id = t.cliente_id
  WHERE c.barberia_id = <shop>
    AND lower(btrim(c.nombre)) = lower(btrim(p_nombre) || ' ' || btrim(p_apellido))
    AND c.telefono_normalizado = p_telefono
    AND t.estado IN ('pendiente', 'confirmado')
    AND t.inicio >= (clock_timestamp() AT TIME ZONE 'America/Argentina/Buenos_Aires')
  ORDER BY t.inicio LIMIT 1
  ```

  `public_crear_turno` stores `Cliente.nombre` as exactly
  `trim(nombre) || ' ' || trim(apellido)`, so the equality above is the faithful
  inverse of the write. An index already exists: `cliente_barberia_tel_idx`.
- No match → `PUBLIC_RESOURCE_NOT_FOUND` (one generic code, indistinguishable
  from a bad slug).
- Inserts a **new** `TurnoTokenGestion` row `(turno_id, p_token_hash, 'gestion',
  expires_at = t.inicio)` — the same lifetime rule as `phase15`.
- Returns `{ "booking": { the 10-field management DTO }, "managementTokenRegistered": true }`
  with the exact DTO shape of `public_gestionar_turno`
  (`start, end, durationMinutes, price, status, origin, serviceName, barberName,
  shopName, canCancel`). No customer PII.
- `REVOKE ... FROM PUBLIC, anon, authenticated` / `GRANT ... TO service_role`,
  plus the read-only privilege probe the other phases end with.
- No new table and no new sequence, so no sequence-grant work is needed.
- Rollback: `DROP FUNCTION IF EXISTS public.public_recuperar_turno(text, text, text, text, text);`

`supabase/sql/README.md` must get a row for phase16 in its apply-order table.

### 2. Edge `public-booking-lookup` (POST, `verify_jwt = false`)

- Called **server-to-server** by Next; the browser never sees it.
- Body `{ slug, nombre, apellido, telefono }`; `MAX_BODY_BYTES = 1024`.
- Presence/bounds only (`nombre`/`apellido` 2..80, `telefono` non-empty ≤ 32):
  phone **format** stays owned by the RPC, exactly as `public-booking` does it.
- Mints the token **in the Edge** (`generateManagementToken`), sends only
  `sha256` hex to the RPC, and returns `{ management: { token, expiresAt } }`
  where `expiresAt` is `payload.booking.start`.
- Status map: `PUBLIC_RESOURCE_NOT_FOUND` 404, `INVALID_INPUT` 400, everything
  else 500 `INTERNAL_ERROR`. Never log the hash, the token or the payload.
- Reuse `_shared/http.ts` and `_shared/supabase.ts`; add
  `[functions.public-booking-lookup] verify_jwt = false` to `supabase/config.toml`.
- Extend `scripts/edge-test.sh` with the lookup leg (match → read the minted
  token → no-match → 404).

### 3. Next server route `app/api/booking-lookup/route.ts`

- `POST` only; `export const dynamic = 'force-dynamic'`.
- The browser sends **only** `{ nombre, apellido, telefono }`. The route reads
  the shop slug server-side via `getConfiguredSlug()` and calls
  `lib/booking-lookup.server.ts`, so the browser never chooses the shop.
- Returns the Edge body and status unchanged; a malformed body → 400
  `INVALID_INPUT` in the same `{ error: { code, message, retryable } }` shape.

### 4. Server client `lib/booking-lookup.server.ts`

- Mirror `lib/booking-manage.server.ts`: `createBookingLookupClient()` reads
  `SUPABASE_URL` / `SUPABASE_ANON_KEY` through `readEnv`, posts with
  `fetchPublicJson`, `cache: 'no-store'`, parses/validates the
  `{ management: { token, expiresAt } }` response, and surfaces
  `PublicApiError`. The 404 must arrive as a typed `PublicApiError` code, not a
  thrown network error.

### 5. Surface

- `components/public/PublicFooter.tsx` (server): `.site-footer` with
  `.footer-links` holding the client entry point, plus the `.footer-credit`
  line from the prototype. **Drop the prototype's "Iniciar sesión" link**: there
  is no account system, and `PublicHeader` already dropped the same dead
  affordance. Copy is Spanish, code and comments English.
- `components/booking/ManageBookingLookup.tsx` (client): the "Cancelar turno"
  button plus the modal. Modal is a hand-rolled overlay
  (`role="dialog" aria-modal="true" aria-labelledby`, Escape and overlay-click
  close, focus the first field on open, restore focus on close) — **not**
  `<dialog>`, whose `showModal` jsdom does not implement.
- Form: nombre, apellido, teléfono (raw `+54` prefix box, `inputMode="tel"`, no
  mask), reusing `normalizarCelularAR` from `lib/telefono.ts` before the POST —
  the same rule `BookingForm` applies.
- On success: `router.push('/reserva/gestionar?token=' + encodeURIComponent(token))`.
- Errors mapped to customer-facing Spanish, mirroring `BookingForm`'s map.
- `app/page.tsx` renders `<PublicFooter />` after `<ServiceCatalog />`.
- `app/globals.css`: `.site-footer` / `.footer-links` / `.footer-link` /
  `.footer-credit` and the modal chrome, all through the existing theme
  variables so light and dark both work. Reuse the `.booking-form` field styles
  by giving the modal's `<form>` that class rather than duplicating input rules.

### 6. Types

Add the lookup response type next to `ManagementGrant` in `types/booking.ts` if
one is useful; do not widen `ManagedBooking`.

## Tasks

- [x] **L1 — Migration.** `phase16_public_booking_lookup.sql` + `_rollback.sql`,
      `supabase/sql/README.md` row (plus the missing phase15 row).
- [x] **L2 — Edge.** `supabase/functions/public-booking-lookup/index.ts`,
      `supabase/config.toml`, `scripts/edge-test.sh` (leg 10a–10e).
- [x] **L3 — Next server.** `app/api/booking-lookup/route.ts`,
      `lib/booking-lookup.server.ts`, `lib/booking-lookup.server.test.ts`.
- [x] **L4 — Surface.** `components/public/PublicFooter.tsx`,
      `components/booking/ManageBookingLookup.tsx`, `app/page.tsx`,
      `app/globals.css`, `types/booking.ts`.
- [x] **L5 — Tests.** `components/booking/ManageBookingLookup.test.tsx`,
      `components/public/PublicFooter.test.tsx`,
      `tests/e2e/public-booking-lookup.spec.ts`,
      `playwright.config.ts` (new spec collected).
- [x] **L6 — Verify.** All gates run green against the local scratch stack; see
      Evidence for the literal output.

## Acceptance

- A visitor who knows the exact nombre, apellido and canonic teléfono of an
  upcoming booking gets to its management screen; anyone else gets one generic
  "not found".
- The minted token is bound to that booking, expires at `Turno.inicio`, and
  works with the existing read/cancel edges unchanged.
- Neither the token nor the hash is logged; no PII enters a URL.
- `anon`/`authenticated` keep zero privileges on the new RPC and on every table.
- Works in light and dark theme.
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`,
  `npm run test:e2e` all pass; `npm run test:edge` covers the new leg.

## Known risk (explicit, not hidden)

This intentionally weakens the "possession of an opaque token" model to
"knowledge of nombre + apellido + teléfono". Phones are constrained by
`Barberia.codigos_area_permitidos`, but the endpoint is an enumeration oracle.
No rate limiting is added: the project's plans explicitly defer rate limiting for
the public surface, and a per-isolate in-memory limiter would be theatre.

**Owner decision (2026-09-26): accepted and explicit.** The owner was told this
weakens the token-only model and chose to proceed anyway: the shop's ticket price
is minimal, so a stronger identity scheme is not worth building yet. Revisit if
the client asks for more security. The tradeoff is therefore a known, accepted
product decision — not an oversight to "fix" during implementation.

## How to run this project

- Migrations are **hand-applied**, never via the CLI: `supabase/sql/phaseN_*.sql`
  plus a `_rollback.sql` sibling. Read `supabase/sql/README.md` first.
- Applying phase16 to the **local scratch stack** (`supabase_db_conexion-db`) for
  verification is in scope. Never apply anything to the hosted project, never run
  `supabase db push`, and never start/stop the stack.
- `public_crear_turno` stores `Cliente.nombre` as `nombre + ' ' + apellido`;
  `Turno.update_at` has no second `d`; `Turno.inicio` is `timestamp without time
  zone`, so every "now" comparison goes through `America/Argentina/Buenos_Aires`.
- Baseline before this change: 103 unit tests, 17 e2e passing.

## Route and work units

| Unit | Scope | Route |
|---|---|---|
| L1–L2 | migration + Edge + edge harness | delegated writer |
| L3–L4 | Next server + surface + CSS | same writer |
| L5 | tests | same writer |
| L6 | apply locally + run the gates | orchestrator |

One writer, no worktree split: each layer is small and the interface above is
frozen, so parallel writers would only add merge risk.

## Progress

- [x] L1 — migration
- [x] L2 — Edge
- [x] L3 — Next server route
- [x] L4 — surface
- [x] L5 — tests
- [x] L6 — verification: every gate green against the local stack
- [x] **Hosted migration** — `phase16` applied by the owner; the remote privilege
      probe reports `anon` false, `authenticated` false, `service_role` true.
- [ ] **Delivery** — nothing is committed. The owner owns branches and commits.

**Added after L6, outside the frozen interfaces:** `scripts/edge-serve.sh`, run
as `bash scripts/edge-serve.sh` (the repository's other `scripts/*.sh` are also
mode 644 and invoked through `bash`). It leaves a repo-serving Edge runtime
attached to the running stack so the app and the Playwright suite can reach the
public API reads. It exists because the stack runs under
`project_id = conexion-db`, so `supabase start` from this repository would create
a second stack rather than serve these Functions. Verified by hand: it reached
readiness in 3s and its startup banner lists `public-booking-lookup` among the
served functions. It is not part of the feature's contract and has no automated
test of its own.

## Evidence (2026-09-26)

### Gates — all green after the stack came back

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean |
| `npm test` | 17 files / **118 passed** |
| `npm run build` | OK; emits `ƒ /api/booking-lookup` |
| `npm run test:edge` | **146 checks, 0 failed** |
| `npm run test:e2e` | **18 passed** (was 17 + 1 skipped while the stack was down) |

### Migration and RPC, executed against the local scratch stack

`phase16` applied with `ON_ERROR_STOP=1`. Its privilege probe:

```
 public_recuperar_turno | p_slug text, p_nombre text, p_apellido text, p_telefono text, p_token_hash text | anon f | authenticated f | service_role t
 TurnoTokenGestion      | anon f | authenticated f | service_role t
```

A rolled-back transaction then exercised the RPC end to end:

| Case | Observed |
|---|---|
| matching identity | 200-shape `booking` DTO: `start 2030-01-15T10:00:00`, `end 10:30`, `status confirmado`, `canCancel true`, real service/barber/shop names |
| token row | `bound_to_turno t`, `expires_at_equals_inicio t`, `tipo gestion`, `unused t` |
| flag | `managementTokenRegistered true` |
| wrong phone | `PUBLIC_RESOURCE_NOT_FOUND` |
| invalid phone | `INVALID_INPUT` |
| bad slug | `PUBLIC_RESOURCE_NOT_FOUND` (same generic code as no-match) |
| past-only booking | `PUBLIC_RESOURCE_NOT_FOUND` |
| cancelled booking | `PUBLIC_RESOURCE_NOT_FOUND` |
| name case/whitespace | matched (`status confirmado`) |
| wrong apellido | `PUBLIC_RESOURCE_NOT_FOUND` |
| after `ROLLBACK` | 0 probe clients, 0 tokens created today |

`test:edge` covers the same contract over real HTTP (leg 10a–10e): match issues a
token whose `expiresAt` equals `booking.start`, that token reads the booking
through the unchanged management edge, wrong phone and unknown identity both
answer one generic 404 with no token, a bad phone format is `INVALID_INPUT`, and
a malformed body / wrong method keep their stable codes. Every response is
`no-store` and carries no internal ids, no phone, no email, no name, no hash.

### The login link changed the rules (owner request, mid-slice)

The owner asked for the prototype's "Iniciar sesión" link to point at the
operator app, `https://proyecto-final-rn.vercel.app/`. Two assertions that had
encoded the earlier "drop the dead affordance" decision were updated, not
deleted:

- `components/public/PublicFooter.test.tsx` now asserts the link's `href`,
  `target="_blank"` and `rel="noopener noreferrer"` instead of its absence.
- `tests/e2e/profile.spec.ts` now asserts the landing's login link points at the
  operator app and is not the prototype's dead `#`, instead of asserting it is
  absent. Its sibling assertions (no `.prof-select`, no `.cal-jump-btn`) are
  untouched.

### Two probe bugs worth remembering (mine, not the feature's)

1. The probe first reused one literal token hash across calls and hit
   `turnotokengestion_token_hash_unique`. The table already carries a phase15
   fixture row with `token_hash = 'a' * 64` (id 1, 2026-09-25). The RPC therefore
   relies on the Edge minting a fresh random 256-bit token per request — which it
   does — and the probe now generates random hashes like the Edge does.
2. `:turno_inicio` interpolated unquoted into a `timestamp` comparison; fixed with
   an explicit `::timestamp` cast.

### Independent verification

A third, read-only verifier reviewed the frozen interfaces, the diff and the
tests before the stack returned. **No blocker or major finding.** It confirmed:
the identity match is a faithful inverse of `public_crear_turno`'s write; both
`AT TIME ZONE` uses are correct for a naive `inicio`; the DTO is field-for-field
identical to `public_gestionar_turno`'s with no PII; the grants revoke
`PUBLIC`/`anon`/`authenticated`; the raw token is minted in the Edge and only its
hash reaches Postgres; nothing logs the token, the hash or the payload; only
`?token=` crosses in the URL; the browser cannot choose the shop; the
`fetchPublicJson` widening is backwards compatible; and the e2e skip is not a
tautology.

Non-blocking nits it raised, still open:

1. `app/api/booking-lookup/route.ts` has no unit test, so "the route ignores a
   client-supplied `slug`" is proven by the e2e flow but not by a unit test.
   Worth one.
2. No test for "click inside the panel does not close".
3. No focus trap in the modal (Escape, backdrop, first-field focus and focus
   restore are all present and tested; a trap was not required).

**One verifier claim is wrong and must not be actioned:** it reported that
`cliente_barberia_tel_idx` does not exist. It does — it was read directly off the
live local schema as
`btree (barberia_id, telefono_normalizado) WHERE telefono_normalizado IS NOT NULL`.
It is created out of band, so it appears in no file under `supabase/sql/`, which
is why the verifier could not find it. The lookup query is correctly indexed.

### What remains

1. **The owner already applied `phase16` to the hosted project** (privilege probe
   confirmed there: `anon` false, `authenticated` false, `service_role` true).
2. Nothing is committed. The owner owns branches and commits.
3. The local edge runtime serving this repo's Functions was left running so the
   stack is usable for a preview. A `supabase functions serve` process dies with
   the shell that started it, so re-run `bash scripts/edge-serve.sh` if a preview
   503s.
