# Phase 4 — Booking management and cancellation

Branch: `feat/public-cancellation`, cut from `main` at `467964b`.
Implemented and verified on `feat/public-cancellation`; see Progress and Evidence
below. Everything is uncommitted. Verify every claim against the code before
trusting it.

## Objective

Give a visitor a way back into their own booking: a summary they can reach with an
opaque token, and a cancellation that is authorised by holding that token alone.

Today the flow ends in a dead end. Confirmation is inline inside the booking
island, nothing is persisted that could identify the booking later, and the only
way to change a turn is to write to the shop.

## Approved decisions this must honour

From `plan_next_web_completa.md` section 0 — these are binding, not open:

- Cancellation is allowed **until 5 minutes before the start**, with no other
  minimum.
- There is **no customer account**. Recognition is by possession of the opaque
  management token.
- The token is random, opaque, high entropy; store a **hash**, not the raw value.
  It carries an expiry, and revocation must be possible.
- **No PII in the URL**, and no sequential ids.
- Cancellation is **idempotent** and releases the interval.

## What exists today

The contract Phase 4 extends, all verified:

| Piece | State |
|---|---|
| `public_crear_turno` | 9-arg, `RETURNS jsonb`, `SECURITY INVOKER`, `service_role` only. Relies on `turno_sin_solape` for the anti-overlap guarantee. |
| `BookingIdempotency` | Key + payload hash + the stored response DTO + a 24-hour TTL. A replay returns the stored DTO byte-identically. |
| `CodigoVerificacion` | The precedent for a locked-down table: explicit table grants on top of postgres default privileges. |
| `Turno.estado` | Enum `estado_turno` = `pendiente, confirmado, completado, cancelado, ausente`. `cancelado` already exists. |
| `Turno.inicio` | `timestamp without time zone` — local-naive, no offset. |
| `public-booking` Edge | Returns `{ booking: {...} }` with a 201 and a DTO free of internal ids. |
| `_shared/availability-token.ts` | HMAC-SHA256, base64url, `iat`/`exp`, constant-time signature compare. **Mirror this for the management token** rather than inventing a second scheme. |
| `_shared/http.ts` | Per-function method lists, the `Idempotency-Key` allowed header, `applyCors` against `PUBLIC_SITE_ORIGIN`. |
| `app/reservar/page.tsx` + island | The booking POST is the only browser-to-Edge call. Everything else is server-to-server with the anon key, and `anon` has **no table grants**. |

## Scope

In: an opaque management token minted when a booking is created, a route that
shows a minimal summary from that token, and an idempotent cancellation behind the
5-minute rule.

Out: rescheduling (the plan rules out "cancel and create" as a substitute),
customer accounts, email or WhatsApp notification, the private panel, and any
`anon` table access.

## Tasks

- [x] **C1 — Token storage.** A new table holding the token hash, its type, the
      `turno_id`, an expiry, a used/revoked marker and timestamps. Follow the
      `CodigoVerificacion` and `BookingIdempotency` grant pattern, and do not
      forget the identity sequence: this project grants `authenticated` UPDATE on
      every new public sequence by default, which is `setval()`. The audit is at
      `openspec/audits/sequence-grants-2026-09-25.md`.
- [x] **C2 — Mint on creation.** `public_crear_turno` (or the Edge around it) must
      return the management token once, alongside the existing DTO. Raw token
      never stored, never logged.
- [x] **C3 — Read RPC.** Resolve a token to a minimal summary: service, start,
      duration, price, barber, shop, state. No customer PII beyond what the
      visitor already typed.
- [x] **C4 — Cancel RPC.** Idempotent state transition to `cancelado`, rejecting
      a token that is foreign, expired, revoked, or whose turn starts in under 5
      minutes. Compute that window in `America/Argentina/Buenos_Aires` — `inicio`
      is local-naive, so `now()` must be converted, not compared directly.
- [x] **C5 — Edge functions.** A read and a cancel endpoint behind the same CORS,
      method and body-size discipline as `public-booking`.
- [x] **C6 — Surface.** The summary and the cancel action, plus the management
      link the confirmation should carry. Decide where the confirmation lives —
      see the open decisions below.
- [x] **C7 — Tests.** Foreign token, already-started or expired turn, cancel
      releases the slot, cancel is idempotent, logs stay redacted. Extend the
      existing unit and e2e patterns rather than adding a parallel harness.

## Acceptance

From the plan's Fase 4 verification, plus the standing gates:

- A foreign token can neither read nor cancel.
- A turn that already started, or starts in under 5 minutes, cannot be cancelled.
- Cancelling releases the interval, so the slot becomes bookable again.
- Cancelling twice is safe and returns the same outcome.
- Logs carry no token, no PII and no full payload.
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`,
  `npm run test:e2e` all pass.

## Rollback

Stop accepting new cancellations and fall back to manual operation. Keep the
migrations additive. Do **not** reopen `anon` permissions to undo anything.

## How to run this project

- **Migrations are hand-applied**, never through the CLI. `supabase/sql/phase<N>_<name>.sql`
  plus a `_rollback.sql` sibling. Phase 4 is `phase15_*`. Read
  `supabase/sql/README.md` first — it explains why these must not move into
  `supabase/migrations/`.
- **The local scratch stack** at `/home/mauro/conexion-db` serves an edge bundle
  built at `supabase start` (`edge-runtime start --main-service=/root`). Copying a
  function into its `supabase/functions/` is not enough — the stack has to be
  re-levanted. Its copies are also stale.
- **The booking e2e skips** while the local stack does not serve `public-booking`.
  Restart the stack and it runs. It is the only test that proves the whole flow.
- **Hardening already applied:** the F2 sequence-grants pass. Any new table with
  an identity column needs the explicit sequence REVOKE/GRANT.
- Baseline before this branch: 88 unit tests across 10 files, 15 e2e passing plus
  1 skipped.

## Gotchas

- `Turno.update_at` is spelled without the second `d`, and `Turno.created_at`
  exists. Do not assume `updated_at`.
- `inicio` has no timezone. Every comparison against "now" must go through
  `America/Argentina/Buenos_Aires`, and never through `toISOString()`.
- The availability token TTL and the lead time are short; a management token is a
  different lifetime and should not inherit those constants by accident.
- The 30-minute grid is duplicated between `phase12` (`interval '30 minutes'`) and
  `phase13` (`mod(..., 1800)`) with no shared source. Not Phase 4's job, but do not
  make it worse.
- `formatearTelefono` in `lib/telefono.ts` currently has no caller.

## Open decisions — settled 2026-09-25

1. **Where the confirmation lives:** stays **inline** in the booking island. The
   Edge returns the management token once and the confirmation carries a link to
   `/reserva/gestionar?token=...`. No `/reserva/confirmada` route is added.
2. **Token lifetime:** `expires_at = Turno.inicio`. Once the turn starts the token
   is expired and both read and cancel refuse it.
3. **SDD:** not used. This is a **direct ODD** run on this brief.
4. **Token scheme (found while reading the code):** random 32-byte base64url token
   minted **in the Edge**. The Edge computes `sha256(token)` hex and the RPC only
   ever sees and stores the **hash** — the raw value never enters Postgres, so
   `BookingIdempotency` cannot retain it. A replay re-mints a fresh token for the
   same turno, using a new `turno_id` on the ledger.

## Frozen interfaces

- **`public."TurnoTokenGestion"`**: `id`, `turno_id`, `token_hash` (unique),
  `tipo`, `expires_at`, `used_at`, `revoked_at`, `created_at`. RLS on; grants
  revoked from `PUBLIC, anon, authenticated`; `service_role` only; sequence locked
  with the phase13 `pg_get_serial_sequence` pattern.
- **`public."BookingIdempotency"`** gains a nullable `turno_id` so an idempotent
  replay can re-mint against the appointment the first call created.
- **`public_crear_turno`** grows a 10th parameter `p_management_token_hash`
  (`^[a-f0-9]{64}$`). It stores the hash against the new turno and returns the
  booking DTO plus `managementTokenRegistered` (internal to the Edge↔RPC contract;
  the Edge strips it before replying). The raw token stays in the Edge.
- **`public_gestionar_turno(p_token_hash)`** → `{ booking: { start, end,
  durationMinutes, price, status, origin, serviceName, barberName, shopName,
  canCancel } }`. No customer PII.
- **`public_cancelar_turno(p_token_hash)`** → the same summary with `status:
  cancelado`; idempotent. Codes: `PUBLIC_RESOURCE_NOT_FOUND` 404, `TOKEN_REVOKED`
  410, `TOKEN_EXPIRED` 410, `CANCEL_TOO_LATE` 409, `NOT_CANCELLABLE` 409,
  `INVALID_INPUT` 400.
- **Edges**: `public-booking-manage` (GET, read) and `public-booking-cancel`
  (POST). Both hash the raw token in the Edge; neither needs an HMAC secret.
- **Surface**: `/reserva/gestionar` server-renders the summary through the read
  Edge and hosts a client cancel island; `BookingForm`'s confirmation adds the
  management link.

## Route and work units

| Unit | Scope | Files | Route |
|---|---|---|---|
| U1 Backend | migration + edges | `supabase/sql/phase15_*`, `supabase/functions/_shared/management-token.ts`, `public-booking`, `public-booking-manage`, `public-booking-cancel`, `supabase/config.toml` | delegated writer |
| U2 Surface | Next read + cancel UI | `app/reserva/gestionar/page.tsx`, `components/booking/ManageBooking.tsx`, `BookingForm.tsx`, `lib/booking-manage.server.ts`, `lib/site-config.server.ts`, `types/booking.ts` | delegated writer |
| U3 Tests | unit + e2e + edge harness | `supabase/functions/_shared/management-token.test.ts`, `components/booking/*.test.tsx`, `tests/e2e/public-cancellation.spec.ts`, `scripts/edge-test.sh` | delegated writer |
| U4 Verify | apply locally + run the gates | — | orchestrator |

## Progress

- [x] Design locked and interfaces frozen (this section).
- [x] **U1 backend** — `phase15_public_cancellation.sql` + rollback,
      `_shared/management-token.ts`, the 10-arg `public_crear_turno`, the read and
      cancel RPCs, `public-booking-manage`/`-cancel`, `config.toml`.
- [x] **U2 surface** — `/reserva/gestionar` route + cancel island, management link in
      the inline confirmation.
- [x] **U3 tests** — management-token, booking-manage client, ManageBooking and
      BookingForm unit tests; `public-cancellation.spec.ts`; `scripts/edge-test.sh`
      full flow.
- [x] **U4 verification** — see Evidence.
- [ ] **Delivery** — everything is uncommitted; the owner owns commits/pushes. About
      2 500 authored lines, over this repository's 400-line review budget, so chained
      PRs if a PR is wanted.

## Evidence (2026-09-25)

- Migration applied to the local scratch stack (`supabase_db_conexion-db`) with
  `ON_ERROR_STOP=1`. Grant probes: `anon`/`authenticated` denied and `service_role`
  allowed for all three RPCs and the table; the new identity sequence is locked.
- Live RPC checks (rolled back, no data left): foreign token read+cancel →
  `PUBLIC_RESOURCE_NOT_FOUND`; cancel → `cancelado`; re-cancel → `cancelado`
  (idempotent); the slot is re-bookable; a turn within 5 minutes →
  `CANCEL_TOO_LATE`; `expires_at = inicio` → `TOKEN_EXPIRED`; the read DTO carries no
  customer PII.
- `npm run typecheck` OK · `npm run lint` OK · `npm test` 103 passed ·
  `npm run build` OK (emits `ƒ /reserva/gestionar`) · `npm run test:e2e` **17 passed**
  · `npm run test:edge` 109 checks, 0 failed (full create → read → cancel → re-cancel →
  slot released over real HTTP).
- `playwright.config.ts` now pins `workers: 1`. The new cancellation writer cannot run
  in parallel with `public-availability.spec.ts`'s "reservation tables untouched while
  it runs" DB probe; a shared mutable scratch DB admits no other isolation.

## Environment note

`scripts/edge-test.sh` attaches its runtime to the running stack's project id and stops
it on exit, so a `test:edge` run leaves the local edge runtime down (the brief's
"restart the stack and it runs"). It was restored serving **this** repository's
functions through a throwaway workdir symlinked to `supabase/functions`, the same way
the harness does. Re-do that (or restart the scratch stack) after a `test:edge` run, or
the E2E API reads return 503.

## Verified against the live local DB (2026-09-25)

- `Turno`: `update_at` (spelled without the second `d`, `timestamptz`),
  `created_at`, `inicio` (`timestamp without time zone`), `duracion_minutos`.
- `estado_turno` = `pendiente, confirmado, completado, cancelado, ausente`.
- `turno_sin_solape` excludes `pendiente|confirmado|completado`, so a cancelado
  turn releases its interval.
- `public_crear_turno` is 9-arg with `p_email`, `service_role`-only.
- `Barberia.codigos_area_permitidos` = `{11,221}`.
- Sequence default ACL grants `setval` to **both** `authenticated` and `anon`
  locally — the new table's sequence lock must be explicit.
