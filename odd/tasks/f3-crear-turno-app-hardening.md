# F3 — endurecer `crear_turno` (app) a la par de `public_crear_turno`

## Objective

Reescribir el cuerpo de `public.crear_turno` (única RPC ejecutable por
`authenticated`, superficie: app operativa) con los cinco puntos acordados.
Latente hoy (ningún barbero tiene horario NULL y nada crea `pendiente`), pero
es el escritor sin validación de servidor.

## Problem

`crear_turno` valida en servidor solo: sesión, barbero vinculado a `auth.uid()`,
servicio propio, largo de nombre/apellido, `origen` en lista, duración
clampeada. NO valida: horario del barbero ni de la barbería, `BloqueoHorario`,
teléfono (acepta NULL — 3 filas phone-less en producción: ids 9, 27, 28),
ni restringe `origen='web'`. La app lo chequea solo en cliente.

## Why

Auditoría cross-repo 2026-09-26, hallazgo F3 (Media). Decisión de producto del
usuario 2026-09-26: teléfono obligatorio en ambas superficies (web ya lo exige
en 3.3; falta la app) + bundle de los 5 puntos en esta phase.

## Scope (los 5 puntos, nada más)

1. Espejar horario + bloqueos: NULL schedule → rechazo; check día hábil
   (barbero y barbería); ventana efectiva (greatest/least + NULL-check estilo
   phase19); `BloqueoHorario` (full-day, solape parcial, medio-definido →
   rechazo, misma lógica que 3.9 de `public_crear_turno`).
2. Teléfono obligatorio: `p_telefono` NULL/vacío → rechazo. Respetar
   `cliente_telefono_formato_chk` (leer su definición; si exige patrón,
   exigir el mismo; si admite NULL, solo exigir no-NULL/no-vacío).
3. Orígenes: solo `presencial`/`whatsapp`. Sacar `'web'` (previa verificación
   de que nada legítimo de la app lo envía).
4. Duración servicio NULL → rechazo (como la web), en vez de `COALESCE(...,30)`.
5. Resolución del barbero con `ORDER BY id LIMIT 1` (determinístico aunque hoy
   no haya usuarios compartidos).

Fuera de scope explícito: lead time 30', ventana 14 días, grilla 30' en la app
(la auditoría pidió solo horario+bloqueos); dedupe/upsert de `Cliente`;
códigos de error nuevos fuera del patrón `_*_INVALIDA` existente.

## Constraints

- Cuerpo live actual (producción, 2026-09-26, 1594 chars) como base; el
  rollback lo restaura verbatim. Va embebido en el prompt del writer.
- Códigos RAISE nuevos con el patrón existente (mayúsculas, `P0001`).
- Migración `supabase/sql/phase20_crear_turno_app_hardening.sql` (+ rollback),
  fila orden 11 en README, batería pgTAP
  `supabase/tests/crear_turno_app_hardening.sql` (ver nota auth abajo).
- `crear_turno` usa `auth.uid()`: el test debe fijar
  `request.jwt.claims` con `sub` = `users_id` del fixture. Si la técnica no
  funciona en el stack local, el writer lo reporta blocked con el error exacto.
- NO aplicar en remoto. NO commitear/pushear. Rama actual
  `fix/public-availability-barbero` (el usuario hace los merges).
- TDD mode: no habilitado para ODD; verificación con pgTAP + suite completa.

## Checklist

- [x] T1 Writer: migración phase20 + rollback + README
- [x] T2 Writer: batería pgTAP (rechazos a–e + happy path f + NULL schedule g)
- [x] T3 Parent: verificación (diff, spot check test:db) y reporte

## Acceptance criteria

- `crear_turno` rechaza: teléfono NULL/vacío, origen `web`, duración NULL,
  día fuera de días hábiles, fuera de ventana efectiva, slot bloqueado,
  schedule NULL. Happy path con datos sanos sigue insertando.
- Rollback deja el cuerpo idéntico al live 2026-09-26.
- Suite `test:db` completa sin regresiones.

## Verification evidence

- Writer: batería nueva 15/15 PASS; suite completa 101/101 PASS; rollback
  verificado funcionalmente (10/10 asserts de hardening fallan contra el cuerpo
  viejo → restore probado) y forward re-aplicado → verde. Step-7 OK: la app
  solo envía `presencial`/`whatsapp` (`turnos.service.ts:58`), sacar `'web'`
  no rompe nada. Remoto intacto (phase20 solo en stack local).
- Parent: spot check propio 15/15 PASS con
  `SUPABASE_TEST_NETWORK=supabase_network_conexion-db`. `DEFAULT NULL` en
  p_telefono/p_telefono_raw confirmado contra el catálogo vivo
  (`proargdefaults` trae 2 defaults NULL) — preservado verbatim, correcto.
  (Efecto: omitir teléfono ahora cae en `TELEFONO_INVALIDO`, como se quiere.)
- Pendiente (decisión del usuario): hand-apply en producción, commit/push.
- Follow-up fuera de este repo: mapear los 5 códigos nuevos
  (`HORARIO_NO_CONFIGURADO`, `FUERA_DE_HORARIO`, `HORARIO_BLOQUEADO`,
  `TELEFONO_INVALIDO`, `SERVICIO_NO_RESERVABLE`) en el `mapCrearTurnoError`
  de la app; hoy caerían al mensaje genérico.

## Next step

- Delegar T1+T2 a un writer; luego T3.
