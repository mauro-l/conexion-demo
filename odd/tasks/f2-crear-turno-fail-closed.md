# F2 — `public_crear_turno` fail-closed con horario de barbero NULL

## Objective

Endurecer las guardas 3.7/3.8 de `public.public_crear_turno` para que fallen
cerradas por sí mismas ante horario de barbero NULL (defensa en profundidad).

## Problem

Las guardas 3.7 (día hábil), 3.8a (horas efectivas) y 3.8b (grilla/rango) son
NULL-unsafe en aislado: `= ANY(NULL)` → NULL, `greatest(x, NULL)` ignora el
NULL en Postgres, `IF NULL` se salta en silencio. Hoy la guarda 3.5
(`SERVICE_NOT_BOOKABLE`) las protege al estar antes, y ningún barbero en
producción tiene horario NULL (verificado 2026-09-26: barberos 1, 10, 11
completos). Trabajo latente, no bug en llamas.

## Why

Auditoría cross-repo 2026-09-26, hallazgo F2 (Alta). Si la 3.5 regresa alguna
vez, o entra un array con NULL adentro (burla el `IS NULL`), la creación
fallaría abierta: se pierde día hábil, rango horario y grilla de 30'.

## Scope

- `supabase/sql/phase19_crear_turno_fail_closed.sql` (nueva migración)
- `supabase/sql/phase19_crear_turno_fail_closed_rollback.sql`
- Entrada en `supabase/sql/README.md` (orden 10, dependencia phase15)
- Test pgTAP `supabase/tests/public_crear_turno_fail_closed.sql`
- NO aplicar en remoto (decisión del usuario). NO commitear/pushear sin pedido.

## Constraints

- Sin `COALESCE` al horario de la barbería (inventa regla; rechazado en auditoría).
- Mantener el código `SERVICE_NOT_BOOKABLE` de la 3.5 (el Edge y
  `BookingForm.tsx` ya lo mapean).
- Migración idempotente, `BEGIN`/`COMMIT`, probe read-only al final (convención
  del repo). Rollback restaura el cuerpo phase15 verbatim.
- TDD mode: no habilitado para ODD en este proyecto; verificación con pgTAP
  (`npm run test:db`) + `npm run test` / `typecheck` si se tocan archivos TS
  (no previsto).

## Checklist

- [x] T1 Writer: migración phase19 (endurece 3.7/3.8 en cerrado, mismo cuerpo
  phase15 en lo demás) + rollback + README
- [x] T2 Writer: test pgTAP fail-closed (barbero con apertura/cierre/días NULL →
  rechazo; caso sano sigue reservando)
- [x] T3 Parent: verificación de lo reportado por el writer (releer artefactos,
  correr `npm run test:db` si hay stack local) y reporte al usuario

## Acceptance criteria

- Con horario de barbero NULL, `public_crear_turno` rechaza (no inserta `Turno`).
- Con horario completo y slot válido, el flujo sano no cambia de comportamiento.
- Rollback deja el RPC idéntico al cuerpo phase15.

## Verification evidence

- Writer: nueva batería 7/7 PASS, suite completa 86/86 PASS, rollback verificado
  con apply/re-apply en stack local (`supabase_db_conexion-db`). Remoto intacto.
- Parent: `diff phase15 vs phase19` trae solo los hunks previstos (header, 3.7
  `IS NOT TRUE` + comentario, 3.8a NULL-check + comentario, 3.8b comentario,
  probe). `diff phase15 vs rollback` sin hunks en el cuerpo de crear_turno
  (rollback byte-idéntico). Spot check propio:
  `SUPABASE_TEST_NETWORK=supabase_network_conexion-db npm run test:db --
  supabase/tests/public_crear_turno_fail_closed.sql` → PASS 7/7.
  (Sin la var de red falla con `could not translate host name "db"`.)
- Pendiente (decisión del usuario): hand-apply en producción, commit/push.

## Next step

- Delegar T1+T2 a un writer; luego T3.
