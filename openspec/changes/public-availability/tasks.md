# Tasks: Public Availability

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 880–1220 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 RPC → PR2 Edge → PR3 Next → PR4 CTA → PR5 E2E/docs |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Discovery + migration + RPC + grants | PR1 | `npm test -- rpc` + SQL grant check | Live SQL RPC call | Revert migration file |
| 2 | Edge + no-store + errors + HMAC | PR2 | `npm test -- edge` | `curl -i` Edge check | Disable Edge function |
| 3 | Read layer + `/reservar` + island | PR3 | `npm test -- reservar` | `npm run build`, render route | Remove route/island/read layer |
| 4 | Token DTO + CTA navigation | PR4 | `npm test -- catalog` | Click CTA → `/reservar` | Revert catalog files |
| 5 | E2E + docs | PR5 | `npm run build && npx playwright test` | Playwright CTA/not-found | Revert E2E/docs only |

## Phase 1: Foundation

Order: 1→2→3→4→5; task 2.1 parallels 4.1.

- [x] 1.1 Discover live `Turno` predicate via `pg_constraint`/`pg_get_constraintdef`; record text [availability-read: contract]
- [x] 1.2 Create `supabase/migrations/phase11_public_service_token.sql`: `pgcrypto`, token backfill/default/`NOT NULL`/`UNIQUE`, tokenized catalog DTO [catalog-read: resolution]
- [x] 1.3 Implement `public.public_availability(p_slug,p_service_token)` ID-free JSON; `[today,today+14)`, `0=Sunday`, `start>=now+30min`, shop∩barber, NULL barber yields no slots, NULL duration excludes service, `pendiente/confirmado/completado` occupy [availability-read: window/occupancy]
- [x] 1.4 `REVOKE` PUBLIC/anon/authenticated + `GRANT` service_role; probe grants [availability-read: valid read]

## Phase 2: Edge

- [x] 2.1 Create `supabase/functions/public-availability/index.ts`: validate `slug`/`service`/`date`, reject unknown fields, service-role RPC, always `no-store` [availability-read: contract/invalid]
- [x] 2.2 Stable errors `INVALID_INPUT`/`AVAILABILITY_RANGE_EXCEEDED`/`PUBLIC_RESOURCE_NOT_FOUND`/`INTERNAL_ERROR`; HMAC tokens sans `v`, `exp=iat+600` [availability-read: tokens]

## Phase 3: Next route and CTA

- [x] 3.1 Verify Next 16.2.9 `searchParams` semantics (`package.json` read-only); add `types/booking.ts`, `lib/availability.server.ts` no-store read [scaffold: verification]
- [x] 3.2 Add `app/reservar/page.tsx`: server slug, `notFound()` on unknown, ID-free snapshot, server-rendered `Cualquier profesional` [scaffold: not-found; selector: any]
- [x] 3.3 Add `components/booking/AvailabilityCalendar.tsx`: slots, empty-calendar success, end-of-flow state, no mutation [availability-read: empty/end-of-flow]
- [x] 3.4 Update `types/public.ts`, `lib/public-api.server.ts`, `components/public/ServiceCatalog.tsx`: five-field DTO by token, `<Link href="/reservar?service=...">` [catalog-read: token; scaffold: CTA]

## Phase 4: Testing

- [x] 4.1 Vitest: DTO/no-store parsing, 12:00→12:10:01 expiry rejection, CTA navigation, NULL-duration empty-`days`, no-mutation state [availability-read: expiry/end-of-flow]
- [x] 4.2 SQL/Edge integration: valid/malformed/window/lead/NULL/occupancy/blocks/adjacency; fixture cases deferred [availability-read: boundary/occupied]
- [x] 4.3 Playwright (`npm run build` first): CTA, privacy, not-found, read-only flow [scaffold: CTA/privacy/not-found]

## Phase 5: Decisions and docs

- [x] 5.1 Lock: (a) `v` dropped, (b) NULL duration → `200` empty `days`, (c) `Barberia` NULL → no slots, (d) `searchParams` finding [all specs]
- [x] 5.2 Deferred log: occupied/blocked/NULL-schedule/10:00 cases need fixtures [availability-read]

## Phase 6: Harness correction (post-verify)

- [x] 6.1 Make the lead-time fixture window wrap-proof: clamp `pg_temp.lead_open` to `00:00` and `pg_temp.lead_close` to `24:00`, derive the expected first grid step from the same anchor the fixture uses, and classify the final window before local midnight as an explicit `skip` while keeping the non-vacuity guard armed for every other clock [availability-read: boundary]
- [x] 6.2 Add the whole-day construction sweep (section 6b): 48 synthetic local clocks assert no wrap, an exact-hour anchor, an eligible today start outside the documented window, and the `23:30` skip classification [availability-read: boundary]
- [x] 6.3 Update `deferred-coverage.md` D1 to record what is proven across the whole day and what remains genuinely unprovable [availability-read]

RED tests: none — matrix all `N/A`.
