# Design: Public Availability

## Technical Approach

Keep slot computation in PostgreSQL; the Edge Function is a thin, no-store
proxy. Next reads it server-side and passes an ID-free snapshot to one client
calendar island, avoiding the `4321`/`3000` browser-CORS mismatch.

## Architecture Decisions

| Decision | Choice and rationale |
|---|---|
| Computation | RPC: one timezone/transaction authority and no row over-fetch. |
| Service address | Opaque random `Servicio.public_service_token`; names are mutable/non-unique. |
| Availability token | Stateless Edge HMAC-SHA-256; no persistence or cleanup. |
| Browser boundary | Server-only Next fetch keeps credentials/secret private and makes CORS irrelevant. |

## Data Flow and Contracts

`ServiceCatalog` → `/reservar?service=<token>` → Next server read → Edge → service-role RPC → signed slots → calendar.

RPC signature: `public.public_availability(p_slug text, p_service_token text) RETURNS jsonb`.
Its JSON is `{"service":{"publicServiceToken":string,"name":string,"durationMinutes":number,"price":number,"description":string|null},"days":[{"date":"YYYY-MM-DD","day":0,"slots":[{"start":"YYYY-MM-DDTHH:MM:SS","end":"YYYY-MM-DDTHH:MM:SS","availabilityToken":string}]}]}`; no IDs. Unknown/unpublished services return `PUBLIC_RESOURCE_NOT_FOUND`.

SQL uses `clock_timestamp() AT TIME ZONE 'America/Argentina/Buenos_Aires'`, local `today`, and `generate_series(today, today+13, '1 day')`. `extract(dow FROM local_date)::int` supplies `0=Sunday`. Each active barber must have non-NULL day/hour fields; intersect days with `= ANY` and hours with `greatest`/`least`. Generate 30-minute starts, require `start >= local_now+30 minutes`, `[start,end)` non-overlap, and `end < today+14 midnight`; union duplicate starts across barbers.

Before `Turno`, the RPC finds any `contype='x'` constraint on `public."Turno"`, inspects `pg_get_constraintdef` and its linked index predicate, and verifies the `barbero_id`/`tsrange`/`&&`/`'[)'` shape plus occupying states. It uses that catalog-derived predicate in constrained `EXECUTE`; no name is assumed. Drift fails closed with `INTERNAL_ERROR`. Blocks use full-day NULL/NULL or partial `[hora_inicio,hora_fin)` `NOT EXISTS`; `cancelado`/`ausente` free intervals and adjacency remains valid.

## Migration and Edge

Create `supabase/migrations/phase11_public_availability.sql` (the next sequential project convention):

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
ALTER TABLE public."Servicio" ADD COLUMN public_service_token text;
UPDATE public."Servicio" SET public_service_token = encode(gen_random_bytes(16), 'hex')
WHERE public_service_token IS NULL;
ALTER TABLE public."Servicio" ALTER COLUMN public_service_token
  SET DEFAULT encode(gen_random_bytes(16), 'hex'), ALTER COLUMN public_service_token SET NOT NULL;
CREATE UNIQUE INDEX idx_servicio_public_service_token
  ON public."Servicio" (public_service_token);
```

The migration replaces `public_catalog(p_slug text) RETURNS jsonb`, creates the
RPC, then runs `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` and
`GRANT EXECUTE ... TO service_role` on both. Rotation is a privileged server
update to a new random value; the old value immediately dies.

Create `supabase/functions/public-availability/index.ts` for Deno. GET accepts
`slug`, `service`, and optional `date=YYYY-MM-DD`; unknown fields/date/window
errors return `INVALID_INPUT` or `AVAILABILITY_RANGE_EXCEEDED`, with
`PUBLIC_RESOURCE_NOT_FOUND` and `INTERNAL_ERROR` for the other stable cases.
It calls the RPC with `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`; every response
sets `Cache-Control: no-store`. Server-only Next calls need no CORS; add `3000`
to the shared allowlist only for legacy direct callers. Use
`PUBLIC_AVAILABILITY_HMAC_SECRET`, shared with the future server writer.

Tokens are `base64url(header).base64url(payload).base64url(signature)` with
HS256 and `{v,slug,service,start,end,iat,exp}`; local strings have no `Z`, and
`exp=iat+600`. Edge signs after the RPC. Verify constant-time, reject `now>=exp`
(no positive expiry tolerance; allow five seconds before `iat` for skew). Fase 3
also recomputes Buenos Aires `start >= now+30 minutes` before mutation.

## Next.js Files and Testing

Add `app/reservar/page.tsx` (Server Component; await Next 16 `searchParams`,
resolve the server-only slug, call no-store `lib/availability.server.ts`, and
`notFound()` on public-not-found), `types/booking.ts`, and
`components/booking/AvailabilityCalendar.tsx` as the only client island.
Render `Cualquier profesional` in a server-presentational component; never pass
barber/internal IDs. Update `types/public.ts`, `lib/public-api.server.ts`, and
`components/public/ServiceCatalog.tsx` to parse five fields, key by token, and
use `<Link href="/reservar?service=...">`.

Vitest (`npm test`) covers DTO/error/no-store parsing, token expiry at 12:10:01,
CTA navigation, empty-calendar/UI boundaries, and final no-mutation state.
SQL/Edge integration covers valid reads, malformed input, window/lead boundaries,
NULL schedules, occupancy, blocks, and adjacency. Playwright (`npm run build`
first, then `npx playwright test`) covers CTA navigation, private-config absence,
not-found, and the read-only flow. Without published fixtures or a deterministic
SQL clock seam, live tests cannot prove occupied/blocked/NULL-schedule or exact
10:00 lead-time cases; current data proves only empty-calendar. `strict_tdd: false`.

## File Changes and Review Forecast

| Slice | Files | Estimate |
|---|---|---:|
| RPC + migration | `supabase/migrations/phase11_public_availability.sql` | 280–360 |
| Edge | `supabase/functions/public-availability/*`, shared HTTP | 100–150 |
| Next route/UI | `app/reservar`, `components/booking`, `lib`, `types` | 220–300 |
| Catalog token | `ServiceCatalog`, public DTO/parser | 30–60 |
| Tests/docs | Vitest, Playwright, contracts | 250–350 |

Total is above the 400-line review budget: use these five autonomous chained-PR
slices, each with its own verification and rollback.

## Threat Matrix

| Boundary | Status and reason |
|---|---|
| Documentation-like paths | N/A — no document execution or classification. |
| Git repository selection | N/A — no repository command is introduced. |
| Commit state | N/A — no commit automation is introduced. |
| Push state | N/A — no remote operation is introduced. |
| PR commands | N/A — no PR automation is introduced. |

## Migration / Rollout

Deploy migration, RPC, and Edge before enabling the CTA. Rollback disables the
CTA/route and endpoint; retain tokens or rotate them, with no booking data to
delete. No open design questions remain.
