# Edge rate-limit (freno 1 — velocidad)

Branch: `feat/edge-rate-limit` (crear desde `main`; el owner tiene cambios sucios en
`.gitignore` y `supabase/config.toml` que NO se tocan ni se commitean).

## Objective

Frenar ráfagas contra las 3 Edge Functions públicas (`public-booking`,
`public-booking-lookup`, `public-availability`) para que una IP no pueda meter
decenas de reservas en segundos y quemar la cuota free (500k invocaciones/mes).

## Problem

Las 3 funciones son anónimas por diseño (`verify_jwt=false`). Hoy no hay ningún
contador: `public-booking/index.ts:64` reconoce que el rate limiting quedó diferido.
Evidencia: 12 reservas E2E entraron en ~20 s (turnos 19-31) sin ningún 429.
Cada pedido cuesta 1 invocación Edge + 1 RPC + 1 escritura.

## Why this route

- Tabla PG primero: gratis dentro del free, sin cuentas nuevas. A ~161
  invocaciones/día sobra. Migrar a Upstash solo si se superan ~10k/día, con la
  misma interfaz (`checkRateLimit`).
- Fail-closed: si el contador falla, se rechaza (429/500), no se deja pasar.
  En endpoints anónimos de escritura, dejar pasar a ciegas regala la DB.

## Scope

In: migración SQL `rate_limit` (ip, ventana, contador), helper compartido
`supabase/functions/_shared/rate-limit.ts`, integración en las 3 funciones,
tests Edge + documentación mínima.

Out: freno 2 (máx turnos por teléfono — va con el cliente, ver abajo), CAPTCHA,
WAF, Upstash, cambios de frontend, cambios en RPCs de negocio.

## Constraints

- No tocar archivos sucios del owner (`.gitignore`, `supabase/config.toml`,
  `gestionar-turno.html`, `odd/tasks/*.md` ajenos, `supabase/.branches/`).
- Responder `429 + Retry-After` al exceder; no sumar carga si se puede evitar.
- Ventanas fijas de 60 s por IP (simple y auditable). Umbrales iniciales:
  booking 5/min, lookup 10/min, availability 60/min. Ajustables sin migrar.

## Freno 2 — APARTADO PARA EL CLIENTE (no implementar aquí)

Pregunta: ¿cuántos turnos futuros activos (`pendiente`/`confirmado`) puede tener un
mismo **número de teléfono** (`Cliente.telefono_normalizado`)? Propuesta: **3**.
Aclaración importante: NO es por IP ni por dispositivo (eso se salta cambiando de PC
o abriendo incógnito — incógnito ni siquiera cambia la IP). Es por identidad del
cliente en el dominio barbería: el teléfono. Cambiar de PC no da un teléfono nuevo;
conseguir 8 números distintos sí tiene costo. Regla futura: 1 `IF` en
`public_crear_turno` que cuente activos futuros por teléfono y devuelva
`MAX_TURNOS_ACTIVOS`. Se implementa apenas el cliente defina el número.

## Tasks

- [x] RL-1 Migración `supabase/sql/phase17_rate_limit.sql`: tabla
  `public.rate_limit(ip text, window_start timestamptz, count int)` + PK compuesta
  + limpieza de ventanas viejas. Rollback incluido.
- [ ] RL-2 Helper `supabase/functions/_shared/rate-limit.ts`: `checkRateLimit(ip,
  limite)` fail-closed (si falla el contador → rechazar). Extrae IP de
  `x-forwarded-for` / `cf-connecting-ip` con fallback seguro.
  Evidencia: `rate-limit.test.ts` 13/13 verde (`npx vitest run
  supabase/functions/_shared/rate-limit.test.ts`, 2026-09-27).
- [x] RL-3 Integrar en `public-booking` (5/min), `public-booking-lookup` (10/min) y
  `public-availability` (60/min). 429 con `Retry-After: 60`.
- [x] RL-4 Tests: `scripts/edge-test.sh` + caso SQL (5 pasan, 6to da 429; contador
  roto → rechazo). Registrar evidencia aquí.

## Authorized scope

Rama `feat/edge-rate-limit`. Solo: `supabase/sql/phase17_*`, `supabase/functions/_shared/rate-limit.ts`,
las 3 funciones indicadas y sus tests. Nada fuera de eso sin nueva autorización.

## Acceptance criteria

- 6to POST `booking` misma IP/minuto → 429 con `Retry-After`.
- Ráfaga E2E de 12 en 20 s ya no entra completa.
- Contador caído → pedido rechazado (fail-closed), nunca aceptado a ciegas.
- `test:edge` y `typecheck` verdes para lo tocado.

## Checks aplicables (modo TDD: OFF)

Fuente del modo: sin config TDD en el repo; hay suites ordinarias. Runner:
`bash scripts/edge-test.sh`, `npx vitest run` (si aplica), `npx tsc --noEmit`.
Se exigen checks funcionales ordinarios observados, no evidencia inventada.

## Delivery

Forecast: ~150-250 líneas autoradas (migración + helper + 3 integraciones + tests),
bajo el heurístico 400/tarea. Estrategia: `ask-on-risk` (default); si el diff final
supera ~400 líneas o aparece riesgo alto, frenar y preguntar antes del PR.
Commits por unidad de trabajo en la rama feature con Conventional Commits.
Push/PR los decide el owner (política ordinaria del repo).

## Route declaration

Ruta: delegated direct (writer único). Evidencia del trigger: implementación toca 3+
archivos no triviales (migración + helper + 3 funciones + tests) → writer trigger.
Lectura previa (4+ archivos) ya hecha por el orquestador vía explore + grep.
Revisión nativa: candidata = work-unit commit; corre solo bajo el switch RDD del usuario.

## Progress

- 2026-09-27: documento creado, antes del primer write de código. Mirror Engram:
  pendiente (ver nota abajo).
- Evidencia base: 23/23 turnos con idempotencia + token OK (2026-09-27, ventana 3 h).
- 2026-09-27 RL-1: migración `phase17_rate_limit` (tabla + `rate_limit_check` +
  rollback). Commit `93e1a51`.
- 2026-09-27 RL-2: helper `_shared/rate-limit.ts` + `rate-limit.test.ts`
  (13/13 verde). Commit `a37c70a`.
- 2026-09-27 RL-3: límite integrado en las 3 funciones (booking 5, lookup 10,
  availability 60; 429 `RATE_LIMITED` + `Retry-After: 60`, contador roto → 500).
  Commit `b5d6039`.
- 2026-09-27 RL-4: `supabase/tests/rate_limit.sql` (pgTAP, plan 10: 5 pasan,
  6to 429 con retry, IP aislada, input inválido → raise). Sin Docker en esta
  máquina (`docker: command not found`, 2026-09-27): `edge-test.sh` y
  `test:db` quedan para el owner con stack. Verificado aquí: `npx vitest run`
  131/131, `npx tsc --noEmit` exit 0, esbuild bundle OK de las 3 funciones.

## Next step

Lanzar writer único con este documento como entrada.
