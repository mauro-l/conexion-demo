# Phase 4 — Booking management and cancellation

Branch: `feat/public-cancellation`, cut from `main` at `467964b`.
Nothing is implemented yet. This document is the starting point; verify every
claim against the code before trusting it.

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

- [ ] **C1 — Token storage.** A new table holding the token hash, its type, the
      `turno_id`, an expiry, a used/revoked marker and timestamps. Follow the
      `CodigoVerificacion` and `BookingIdempotency` grant pattern, and do not
      forget the identity sequence: this project grants `authenticated` UPDATE on
      every new public sequence by default, which is `setval()`. The audit is at
      `openspec/audits/sequence-grants-2026-09-25.md`.
- [ ] **C2 — Mint on creation.** `public_crear_turno` (or the Edge around it) must
      return the management token once, alongside the existing DTO. Raw token
      never stored, never logged.
- [ ] **C3 — Read RPC.** Resolve a token to a minimal summary: service, start,
      duration, price, barber, shop, state. No customer PII beyond what the
      visitor already typed.
- [ ] **C4 — Cancel RPC.** Idempotent state transition to `cancelado`, rejecting
      a token that is foreign, expired, revoked, or whose turn starts in under 5
      minutes. Compute that window in `America/Argentina/Buenos_Aires` — `inicio`
      is local-naive, so `now()` must be converted, not compared directly.
- [ ] **C5 — Edge functions.** A read and a cancel endpoint behind the same CORS,
      method and body-size discipline as `public-booking`.
- [ ] **C6 — Surface.** The summary and the cancel action, plus the management
      link the confirmation should carry. Decide where the confirmation lives —
      see the open decisions below.
- [ ] **C7 — Tests.** Foreign token, already-started or expired turn, cancel
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

## Open decisions

1. **Where the confirmation lives.** The plan names `/reserva/confirmada` with a
   management link. What exists is an inline confirmation inside the island, which
   cannot carry a link to a booking it cannot identify. Either move to the route or
   have the Edge return the token so the inline view can link out.
2. **Token lifetime.** The plan requires an expiry but does not set it. The turn's
   start is the natural bound.
3. **Whether SDD is wanted.** This is a migration, two RPCs, two Edge functions and
   a surface — the size where the repo's `openspec/` trail has paid off before. Not
   required, and the owner has said before that ceremony costs him.
