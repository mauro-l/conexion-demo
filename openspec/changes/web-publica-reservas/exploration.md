# Exploration: web-publica-reservas

> Change: `web-publica-reservas` · Project: `conexion-demo` · Artifact store: hybrid (OpenSpec + Engram).
> Date: 2026-09-11. Sources read in full: `plan_web_publica.md` (487 lines), `conexion-barber-blanco.html` (593 lines), `conexion-barber-flujo-completo (2).html` (594 lines), and sibling repo `D:\ComIT\proyecto-final-rn` (`AGENTS.md`, `plan_seguridad.md`, `plan_adaptacion_bd.md`, `docs/resumen-bd-rls.md`, `docs/requerimientos-web-ux-ui-*.md`, `src/types/database.types.ts`, `src/services/{turnos,barbero,bloqueos}.service.ts`, `src/lib/availability.ts`, `supabase/migrations/*`).
>
> Anti-hallucination note: every fact below was read directly from the cited file. Where a claim rests only on prose in a planning document and has no executable artifact in the repo, it is marked **VERIFIED (doc-only)** and the missing artifact is named. The line counts in the launch prompt (551/551) do **not** match the files (593/594).

## 1. Verified facts — Section 8 claims

The plan calls Section 8 "Confirmado por el repositorio". Each row below is the real verdict against the cited evidence.

| # | Claim (Section 8) | Verdict | Evidence actually observed |
|---|---|---|---|
| 1 | `crear_turno` is `SECURITY INVOKER` and requires `auth.uid()` | **VERIFIED** | `supabase/migrations/phase4_crear_turno_atomico.sql:19` `SECURITY INVOKER`; `:30-32` `IF auth.uid() IS NULL THEN RAISE EXCEPTION 'SESION_INVALIDA'`. `phase8_grants_hardening.sql:23-24` revokes EXECUTE from `PUBLIC, anon`, grants only `authenticated`. Consequence (not usable by anonymous clients) holds. |
| 2 | `anon` has no direct table/sequence access | **VERIFIED** | `phase8_grants_hardening.sql:10-11` `REVOKE ALL ON ALL TABLES/SEQUENCES IN SCHEMA public FROM anon`; `:27-28` default privileges revoked. Corroborated by `plan_seguridad.md:13`. |
| 3 | `Servicio` is not readable by `anon` | **VERIFIED** | `phase3_servicio_catalog.sql:9` drops policy `"Servicio select"`; `:10-15` new policy `"Servicio select own" ... FOR SELECT TO authenticated`; `:20` `REVOKE ALL ON public."Servicio" FROM anon`. |
| 4 | `turno_sin_solape` EXCLUDE GiST exists | **VERIFIED (doc-only)** | `plan_seguridad.md:7` and `:25` state it is applied; DDL shown at `:150-164`. **Caveat: no migration file creates it.** `supabase/migrations/` contains only phase2/3/4/8 (8 files, no phase1). The constraint is not reproducible from repo artifacts. |
| 5 | `CodigoVerificacion` has RLS without policies and is closed | **VERIFIED (doc-only)** | `phase8_grants_hardening.sql:15` `REVOKE ALL ON "CodigoVerificacion" FROM authenticated`; `plan_seguridad.md:290` "RLS sin policy + sin grants"; `AGENTS.md:25` "RLS-closed; app never touches it directly". Table shape confirmed at `database.types.ts:173-210`. The "RLS enabled, no policy" part is asserted by docs; it was not possible to query the live DB from this exploration. |
| 6 | `Servicio` has no `activo` column | **VERIFIED** | `src/types/database.types.ts:211-218` `Servicio.Row = { barbero_id, duracion, id, nombre, precio }`. `plan_adaptacion_bd.md:20` lists the same five columns. No `activo`. |
| 7 | `Turno` uses a single `inicio`, plus required `origen` and `duracion_minutos` | **VERIFIED** | `database.types.ts:243-255` Row: `inicio: string`, `origen: string`, `duracion_minutos: number` (all non-null). `AGENTS.md:24` ("a single `inicio` timestamp (NOT fecha/hora_inicio/hora_fin), plus required `origen` ... and `duracion_minutos`"). `phase4:60-62` inserts them. |
| 8 | `inicio` is `timestamp without time zone`, local-naive | **VERIFIED** | `phase4_crear_turno_atomico.sql:11` param `p_inicio timestamp without time zone`; `turnos.service.ts:90-98` `toLocalNaive()` strips offset and trailing `Z`; `AGENTS.md:29`. |
| 9 | `BloqueoHorario` is tied to `Barbero` and encodes full-day with null hours | **VERIFIED** | `database.types.ts:94-131` Row: `barbero_id`, `fecha`, `hora_inicio: string \| null`, `hora_fin: string \| null`. `bloqueos.service.ts:60` comment "hora_inicio/hora_fin null = día completo"; `availability.ts:93-96` treats null/null as the whole day. |
| 10 | Mobile services are not a public API | **VERIFIED** | `turnos.service.ts:61-67`, `barbero.service.ts:17-34`, `bloqueos.service.ts:8-14` all resolve the caller via `supabase.auth.getUser()` and scope every query by `barbero.id`; no anon path. Combined with claim 2, anon cannot reach them. |

### Plan errors / contradictions found

- **Field-set conflict the plan does not resolve.** Plan §6 `POST /api/public/bookings` takes `customer: { "name", "phone", "email" }`, and the live RPC `crear_turno` takes `p_nombre, p_apellido, p_telefono` (`phase4:9-16`). But `docs/requerimientos-web-ux-ui-historias.md:63` and `...pantallas.md:73` state the web form must collect **nombre + email and explicitly NOT phone** ("**No se solicita teléfono**"), and the prototype collects **nombre, apellido, email, teléfono** (`conexion-barber-blanco.html:279-287`). Four sources, three different field sets. This directly constrains open decisions 5 and 8.
- **`docs/resumen-bd-rls.md` is stale.** `:32` still claims `Servicio` is readable by "Todos, incluso sin login (catálogo público)" — contradicted by `phase3_servicio_catalog.sql`. `AGENTS.md:20` still cites this doc as a data-model reference. Anyone trusting it will implement an enumeration hole the repo already closed.
- **`database.types.ts` is demonstrably incomplete.** `phase2_turno_tenant_integrity.sql:96` grants UPDATE on `Barbero` columns `duracion_default` and `precio_base`, neither of which exists in `database.types.ts:41-55` (`Barbero.Row`). Either the hand-maintained types lag the live DB, or the migration could not have applied. `AGENTS.md:3` confirms the types are "hand-maintained, not generated in-repo". Types must not be treated as schema truth.
- **`plan_seguridad.md:9` points to `docs/migrations/phase2_turno_tenant_integrity.sql`**, but that directory does not exist (`docs/` contains only 7 files, no `migrations/`). The real file is `supabase/migrations/phase2_turno_tenant_integrity.sql`.

## 2. Open decisions (Section 13) with constraining repo evidence

1. **`publicSlug` — value and uniqueness store.** No slug/token column exists anywhere. `Barberia.Row` = `{ admin_user_id, created_at, dias_habiles, hora_apertura, hora_cierre, id, nombre }` (`database.types.ts:11-20`); `Barbero` has `alias/descripcion/foto_url/activo` but no slug (`:41-55`). Requires a new column or table + migration + unique constraint.
2. **Publication model for `Servicio` (`activo` vs separate table vs allowlist).** `Servicio` has no `activo` (claim 6), and `phase3:18-21` revoked INSERT/UPDATE/DELETE from `authenticated` — the catalog is now centrally managed. Any `activo`/publication flag requires a migration plus a policy that re-opens the chosen write path only.
3. **Confirmation channel/provider.** `CodigoVerificacion` exists (`codigo, created_at, email, expiracion, id, turno_id, usado`; `database.types.ts:173-210`) but is RLS-closed and never touched by the app. No email provider, secret, or Edge Function exists in either repo. `plan_adaptacion_bd.md:24` notes it is "solo función security definer — la app NO la toca".
4. **Cancellation window/token.** No token columns exist on `Turno` (`database.types.ts:243-255`). `estado_turno` includes `cancelado` (`:333`). Any cancel token needs new storage.
5. **`Cliente` dedupe per `Barberia`.** `Cliente.Row` = `{ barberia_id, created_at, email, id, nombre, notas, telefono: number \| null, ultima_visita }` (`database.types.ts:132-142`). `plan_adaptacion_bd.md:21` claims `email` is "nullable, único por barbería", but no migration in the repo creates that constraint and the types expose no uniqueness. `telefono` is typed `number` (not text), which complicates normalization for a `(barberia_id, telefono)` key.
6. **Persistent idempotency mechanism.** Nothing in the schema supports it — no idempotency table/columns in `database.types.ts`. `crear_turno` has no idempotency argument (`phase4:9-16`). Requires new storage.
7. **Edge Function access to a private RPC.** `crear_turno` is `SECURITY INVOKER` requiring `auth.uid()` (claim 1) and is granted only to `authenticated`. An anon web client cannot call it. A new `SECURITY DEFINER` RPC in a non-exposed schema, or a service-role invocation from the Edge Function, is required. Note the security contract: `plan_seguridad.md:246-253` requires fixed `search_path`, qualified names, `REVOKE EXECUTE FROM PUBLIC`, and never trusting client params.
8. **Retention/deletion policy for PII.** No evidence in either repo. `Cliente` stores `nombre/telefono/email/notas`; `CodigoVerificacion` stores `email`.

## 3. Visual prototype inventory

Both files are single-page, multi-view prototypes with **identical markup and identical JavaScript**; they differ only in the CSS `:root` token block, heading font, and a few color mappings.

**Views / states (same in both files):**

| Selector | Screen | Notes |
|---|---|---|
| `#view-home` | Landing: cover photo, hero (name, tagline, rating, address/hours/WhatsApp), services "ticket" list | Rendered by `renderServices()` from a hardcoded array |
| `#view-datetime` | "Seleccioná fecha y hora": service chip, static "Cualquier profesional" selector, 14-day scroller, time slots grouped Mañana/Tarde/Noche, waitlist link | `renderDates()`/`renderTimes()` |
| `#view-contact` | Two sub-screens: `#screen-form` (name, surname, email, phone + verify note + reCAPTCHA legal text) and `#screen-code` (6 OTP boxes, error, resend countdown) | `ctStep` toggles form/code |
| `#view-confirm` | Success: check circle, recap (service, datetime, location, price), email note, "Agendar otra cita" | — |
| `#sticky-bar` | Shared fixed bottom bar (Anterior / summary / primary button) | Shown for datetime + contact |

**Light vs dark:**

- `conexion-barber-blanco.html` (light): `--paper:#FFFFFF`, `--ink:#1A1A1A`, `--brass:#9C8148` (`:11-24`); headings `Playfair Display` serif (`:9`, `:80`).
- `conexion-barber-flujo-completo (2).html` (dark): `--paper:#1C1C1D`, `--ink:#EFEDE7`, `--brass:#B8A468`, plus an extra token `--fill-strong:#0E0E0F` (`:11-25`); headings `Oswald` uppercase (`:9`, `:81`).
- **Implication:** the switch is a token swap, not a component rewrite — same CSS variable names in both `:root` blocks. The dark file adds `--fill-strong`; light must define an equivalent. Heading **font family** also differs (Playfair vs Oswald), so the switch must swap fonts too. Both files use `.view/.active` toggling and no routing.

**Elements the plan says NOT to reuse (Section 15), located in source:**

- `CORRECT_CODE = '123456'` — `blanco.html:508`, `flujo-completo (2).html:509` (client-side OTP simulation).
- Hardcoded `services` array — `blanco.html:341-346`, `flujo-completo (2).html:342-347`.
- Hardcoded `TIMES` array — `blanco.html:401`, `flujo-completo (2).html:402`.
- Fixed closed day `d.getDay() === 0` — `blanco.html:424`, `flujo-completo (2).html:425`.
- "Iniciar sesión" link — `blanco.html:211` and `:314`, `flujo-completo (2).html:212` and `:315`; "Unite a la lista de espera" — `blanco.html:261`, `flujo-completo (2).html:262`.

**Additional prototype elements the plan does not list but that must change:**

- Contact form collects `fname, lname, email, phone` (`blanco.html:279-287`) — conflicts with the UX requirement of name+email only (see §1 conflict).
- "Cualquier profesional" is static text, not a wired selector (`blanco.html:250-254`).
- reCAPTCHA legal text (`blanco.html:289`) — CAPTCHA is explicitly out of scope (`plan_web_publica.md:38`).
- No "pending/expired" state exists in the prototype, although the UX docs require the slot to lock as `pendiente` at selection time (`pantallas.md:68`) and an expiry state (`historias.md:93-99`).

## 4. Gaps and risks

1. **No app scaffold.** `conexion-demo` has no `package.json`, no `src/`, no Astro/Edge config — only `README.md`, the two HTML prototypes, `plan_web_publica.md`, and `openspec/`. `openspec/config.yaml:7-13` and `testing-capabilities.md:12` confirm greenfield with no test runner. The first slice must bootstrap the project.
2. **Schema gaps block most of the MVP.** No slug/token columns, no `Servicio.activo`, no `pending_expires_at`, no idempotency storage, no cancel-token storage. Every one needs a migration that does not yet exist.
3. **`turno_sin_solape` is not versioned.** No phase1 migration exists, so the DB cannot be reproduced from the repo. Plan §11 Fase 0 item 1 (export live schema/RLS/grants) is a hard prerequisite.
4. **`database.types.ts` is not authoritative** (see §1 contradiction). The live DB must be introspected before relying on any column list.
5. **Confirmation cannot work end-to-end yet.** No email provider/secret exists; plan §11 Fase 3 item 5 defers it. Any slice ending at "pending" avoids this.
6. **Catalog scoping conflict.** Plan §15 says "el catálogo público es a nivel `Barberia`", but `Servicio.barbero_id` is per-barbero (`resumen-bd-rls.md:21`, `AGENTS.md:23`) and the UX docs assume the client chooses a barbero (`historias.md:17-25`). A barbería-level catalog requires aggregating services across its barberos or picking a default barbero. Undecided.
7. **Stale reference docs** (`resumen-bd-rls.md`) can mislead implementers (see §1).
8. **Review budget.** Plan §15 sets a 400-line review budget and `ask-on-risk` delivery. A full vertical slice (migration + RPC + Edge Function + Astro page + island) will likely exceed it; chaining should be planned in `sdd-tasks`.

## 5. Recommended first slice

**Read-only public discovery for one published barbería/barbero: `context` + `catalog` DTOs rendered by an Astro page, with the light/dark switch. No booking mutation, no email, no availability.**

Why this is the smallest end-to-end slice that can actually be verified:

- It exercises the **riskiest architectural boundary** — Astro static page → React island (theme switch) → Edge Function → narrow read RPC/DTO → PostgreSQL — without depending on any unresolved decision (idempotency, confirmation provider, dedupe, cancellation, catalog publication).
- It proves the security invariant the whole plan rests on: `anon` gets a DTO and **cannot** select `Servicio`/`Barbero` directly (claims 2 and 3).
- It removes exactly the prototype elements the plan flags (hardcoded `services`, login link) while reusing the real visual design and the token-swap theme mechanism.

Concrete contents:

1. Bootstrap Astro + React islands + TypeScript in `conexion-demo` (package.json, tsconfig, env wiring).
2. Minimal reversible migration adding the chosen public identifier(s) and publication flag(s) for `Barberia`/`Barbero` (decision 1).
3. A narrow read path exposing `GET /api/public/context?slug=` and `GET /api/public/catalog?barber=` with DTOs that exclude internal ids (`plan_web_publica.md:139`).
4. Astro page `/b/[slug]` rendering the home/services prototype, fed by the DTO, plus the light/dark switch as a `:root` token + font swap.
5. Verification: build/typecheck; anon cannot read `Servicio`/`Barbero` directly; response contains only DTO fields.

**Immediate follow-on (slice 2):** `POST /api/public/availability` — reuses `BloqueoHorario` and working-hours data that already exist (`availability.ts` shows the slot math), still avoids the pending/idempotency/email decisions.

## 6. Read-back verification

The artifact was read back after writing; raw output is included in the return envelope (`artifacts`).

## Key Learnings

1. Section 8's repository claims are broadly accurate, but `turno_sin_solape` is only documented in prose — no phase1 migration exists in the repo.
2. The web contact-field set conflicts across plan, UX docs, prototype, and the live `crear_turno` RPC and must be decided before any booking work.
3. `database.types.ts` is hand-maintained and incomplete, so the live database must be introspected before trusting any schema column.
4. Both prototypes share identical markup and JS and differ only in `:root` tokens plus heading font, so the light/dark switch is a token swap.
