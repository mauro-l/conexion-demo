# Feature: push-fanout-booking

## Objective
Notificar al barbero vía Web Push cuando la web crea un turno, sin romper la reserva ni exponer IDs o secrets al cliente.

## Problem
`public-booking` crea el turno pero nunca llama a `send-push`. Además `send-push` no existe en este repo (vive como scaffold en `proyecto-final-rn/supabase/functions/send-push`), y el DTO público de `public_crear_turno` no trae `id` ni `barbero_id` por privacidad.

## Why
La reserva web hoy es silenciosa para el barbero. El fanout debe ser fire-and-forget desde el Edge con `service_role` solo en server.

## Scope
- `supabase/functions/send-push/index.ts` + `deno.json` (port tal cual desde RN, estilo Deno fmt dobles comillas).
- `supabase/config.toml` (entrada `send-push` con `verify_jwt = false`, la función hace su propia auth).
- `supabase/functions/public-booking/index.ts` (lookup server-side de IDs + fetch fire-and-forget a `send-push`, solo logs).
- NO migración DB (fase10 ya aplicada en DB compartida `conexion-db`: `push_subscriptions` existe, `Barbero.notify_*` existen).
- NO cambios al DTO público, NO `service_role` al cliente, NO IDs al browser.

## Constraints
- `booking` público sigue sin `id`/`barbero_id` (privacidad, `plan_web_publica.md`).
- `turno_id`/`barbero_id` se resuelven solo en Edge con `service_role` vía `BookingIdempotency(idempotency_key) -> turno_id` + `Turno(id) -> barbero_id`. Nunca al `jsonResponse`.
- Fallo de push = `console.warn`/`console.log`, nunca 5xx de reserva.
- TDD mode: unknown (sin `sdd-init` en ODD; no se invoca para determinarlo). Checks ordinarios, no RED/GREEN inventado.
- Delivery strategy: `ask-on-risk` (default). Forecast ~220 líneas autoradas (<400) → un solo slice.

## Checklist
- [x] T1 (delegated): portar `send-push` + `deno.json` + entrada config (route: delegated, trigger: 2+ non-trivial files) — copia idéntica verificada con `diff -q`, commit pendiente en T4
- [x] T2 (delegated): wiring en `public-booking` con lookup server-side + fire-and-forget (route: delegated, trigger: preparation + writer) — spot check del diff OK, 201 intacto
- [ ] T3: verificación — deploy + reserva real + log `[push] send-push:` (manual, usuario). `deno fmt --check` skipped: deno no instalado. RDD off → sin review nativo.
- [ ] T4: commit work-unit en feature branch con Conventional Commit + evidencia

## Authorized scope
Ramas: crear `feat/push-fanout-booking` desde `main`. Commits work-unit en la feature branch; push/PR solo por el usuario.

## Acceptance criteria
- Reserva web exitosa sigue 201 con el mismo DTO (sin IDs).
- Con pref on + suscripción: `send-push` retorna `sent:1`; con pref off: `skipped:1`.
- Fallo de push no cambia el 201.
- `service_role` solo en server; gateway con `verify_jwt=false` + auth propia de la función.

## Applicable checks
- `bash scripts/edge-test.sh` (si stack local disponible) o al menos lectura estructural del diff.
- `supabase functions deploy send-push public-booking` + reserva web real + log `[push] send-push:` (manual, usuario).

## Progress
- Explore + mapping completos (contrato RN leído, DB compartida verificada).
- Next: T1 port send-push.
