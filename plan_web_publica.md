# Especificación técnica: web pública de reservas

> **Estado:** propuesta de implementación para revisión.
>
> Este documento define la frontera técnica y de seguridad de la futura web pública. El diseño visual ya existe y queda fuera de alcance; aquí no se especifican estilos, wireframes ni decisiones de UI.

## 1. Decisión ejecutiva

Se implementará una web pública con **Astro + React islands + TypeScript**, estática por defecto donde el contenido lo permita, y con **Supabase Edge Functions/RPC + PostgreSQL/RLS** como autoridad de negocio.

| Decisión | Aplicación | Motivo |
|---|---|---|
| Astro | Páginas, layouts, contenido público y componentes sin interacción | Envía HTML rápido y poco JavaScript; favorece SEO y carga mobile. |
| React islands | Selector de fecha, disponibilidad, formulario y confirmación | Hidrata únicamente las zonas interactivas; no convierte todo el sitio en una SPA. |
| TypeScript | Contratos DTO, validación de formas y cliente HTTP | Reduce errores entre frontend y funciones sin presentar la tipificación como seguridad. |
| Edge Functions | Frontera pública para operaciones anónimas | Aísla tablas internas, centraliza headers, límites, tokens, observabilidad y errores. |
| RPC PostgreSQL | Operaciones transaccionales de catálogo controlado y reserva | Mantiene la autoridad cerca de los datos, las constraints y la concurrencia. |
| RLS, grants y constraints | Defensa de profundidad en la base | Impide que una función, cliente o configuración defectuosa convierta tablas internas en una API pública. |

La rapidez proviene de **static-first + islands**. La seguridad no depende de Astro ni de React: la solicitud del navegador se considera hostil y debe atravesar Edge Function, validación server-side, operación transaccional y reglas de PostgreSQL.

## 2. Alcance del MVP

### Incluido

- Landing y contenido público de una `Barberia`.
- Perfil público de barbería y/o `Barbero`.
- Catálogo público mínimo de servicios.
- Consulta de disponibilidad.
- Creación atómica de una reserva.
- Expiración automática de reservas `pending` para liberar el horario.
- Confirmación mediante mecanismo server-side de verificación.
- Cancelación inmediata mediante token opaco.
- Logs técnicos y auditoría mínima sin datos sensibles innecesarios.

### Explícitamente fuera de alcance

- CAPTCHA.
- Rate limit por IP o dispositivo y reputación avanzada.
- Panel de abuso para el `Barbero`.
- SMS.
- Reprogramación operativa completa.
- Panel administrativo nuevo, multiusuario o gestión centralizada del catálogo.
- Apertura directa de `Turno`, `Cliente`, `BloqueoHorario` o `CodigoVerificacion` a `anon`.
- Cambios visuales: el diseño ya existe y no se redefine aquí.

El MVP debe dejar puntos de extensión para esos mecanismos, pero no simularlos con booleanos, campos de frontend o reglas no verificadas. En particular, CAPTCHA por sí solo no resolvería automatización, replay, duplicados ni concurrencia.

### Regla obligatoria de reservas `pending`

Una reserva `pending` bloquea el intervalo para proteger al cliente que está completando la confirmación, pero **debe expirar automáticamente**. La ventana inicial del MVP será de 10 minutos, configurable únicamente server-side. Una reserva pendiente vencida no puede seguir ocupando agenda ni ser confirmada.

La expiración no depende exclusivamente de un cronjob: la disponibilidad y la creación de una nueva reserva deben ejecutar una limpieza transaccional de pendientes vencidas antes de evaluar disponibilidad. Un proceso programado puede agregarse para limpieza física y observabilidad, pero su ausencia temporal no puede dejar horarios bloqueados.

## 3. Modelo de amenaza

El cliente anónimo es **no confiable**. Puede inspeccionar JavaScript, falsificar cualquier request, repetirlo, paralelizarlo, cambiar IDs, alterar fechas y omitir completamente la interfaz.

| Amenaza | Ejemplo | Control requerido |
|---|---|---|
| Bots y abuso | Muchas reservas o consultas automatizadas | Límites server-side extensibles; CAPTCHA y rate limit avanzado quedan diferidos. |
| Requests manipulados | Cambiar duración, barbería, servicio o estado | El servidor resuelve identidad y duración desde la BD; nunca confía en esos campos del cliente. |
| IDOR/enumeración | Incrementar `barbero_id`, `servicio_id` o `turno_id` | Slugs/tokens opacos, DTO mínimos y ausencia de acceso directo a tablas. |
| Duplicados/reintentos | Reenviar una reserva tras timeout | `Idempotency-Key` validada server-side y resultado estable. |
| Concurrencia | Dos clientes reservan el mismo intervalo | Transacción, `turno_sin_solape` y validación de bloqueos en la operación autoritativa. |
| Exposición de secretos | Extraer `service_role` del bundle | Solo configuración pública en navegador; secretos únicamente en Edge Function/entorno seguro. |
| Fuga de privacidad | Enumerar clientes, teléfonos o códigos | No devolver filas internas; logs redactados; `CodigoVerificacion` cerrada. |

## 4. Arquitectura y responsabilidades

```text
Navegador anónimo
      |
      | HTML estático + requests HTTPS a /api/public/*
      v
Astro pages/layouts          React islands
      |                              |
      +---------- cliente HTTP -------+
                         |
                         v
              Supabase Edge Functions
       CORS, headers, límites, DTO, tokens,
       validación de forma y observabilidad
                         |
                         v
       RPC estrecha en schema no expuesto
       transacción + locks + reglas de negocio
                         |
                         v
 PostgreSQL: RLS + grants + FKs + CHECK +
 turno_sin_solape + BloqueoHorario + auditoría
                         |
                         v
              logs/monitoring redactados
```

| Capa | Responsabilidad | No debe hacer |
|---|---|---|
| Páginas/componentes `.astro` | Renderizar contenido público, metadata, enlaces y estructura | Insertar o actualizar datos de negocio desde el navegador. |
| React islands | Interacción, estado del flujo, validación UX y llamadas a la API | Decidir disponibilidad, duración, autorización o seguridad. |
| Edge Functions | Autenticar la intención mediante tokens, validar inputs, controlar CORS, límites, idempotencia y errores | Exponer tablas completas o aceptar `service_role` desde el cliente. |
| RPC de PostgreSQL | Resolver relaciones, duración, agenda, bloqueos, concurrencia y mutaciones atómicas | Confiar en IDs o duración enviados por el navegador. |
| RLS/grants/constraints | Aislamiento, mínimo privilegio e invariantes | Ser reemplazados por una ruta “oculta” o por validación TypeScript. |
| Logs/monitoring | Medir errores, latencia, conflictos e intentos rechazados | Registrar nombre completo, teléfono, email, códigos o tokens en claro. |

**Recomendación:** Edge Function como frontera pública y RPC dedicada como autoridad de datos. La función puede usar una credencial server-side para invocar únicamente RPCs explícitas; nunca debe ofrecer un proxy genérico de PostgREST. Si una RPC usa `SECURITY DEFINER`, debe estar en schema no expuesto, tener `SET search_path` fijo y calificar todos los objetos, y ejecutar `REVOKE EXECUTE FROM PUBLIC` antes de conceder solo al caller previsto. `service_role` nunca sale del entorno server-side.

## 5. Mapa de rutas y componentes

Los nombres siguientes son propuesta de organización; los paths se mantienen como identificadores de implementación.

| Ruta | Render | Componentes principales | Función |
|---|---|---|---|
| `/` | `.astro` | `PublicLayout.astro`, `Hero.astro`, `BarberiaList.astro` | Entrada pública y descubrimiento mediante slug. |
| `/b/[slug]` | `.astro` | `BarberiaProfile.astro`, `ServiceCatalog.astro`, `BookingEntry.astro` | Perfil y catálogo DTO; inicia reserva. |
| `/b/[slug]/reservar` | `.astro` + island | `BookingPage.astro`, `BookingFlow.tsx` | Orquesta fecha, servicio, disponibilidad y datos del cliente. |
| `/b/[slug]/confirmar/[token]` | `.astro` + island opcional | `ConfirmationPage.astro`, `BookingConfirmation.tsx` | Confirma y muestra solo el resumen mínimo. |
| `/b/[slug]/reserva/[token]` | `.astro` + island opcional | `BookingStatus.astro`, `CancelBooking.tsx` | Consulta estado limitado y permite cancelar. |
| `/api/public/context` | Edge Function | — | Devuelve contexto público mínimo por slug. |
| `/api/public/catalog` | Edge Function | — | Devuelve catálogo publicado mínimo. |
| `/api/public/availability` | Edge Function | — | Devuelve slots calculados server-side. |
| `/api/public/bookings` | Edge Function | — | Crea una reserva idempotente. |
| `/api/public/bookings/confirm` | Edge Function | — | Consume verificación válida. |
| `/api/public/bookings/cancel` | Edge Function | — | Cancela mediante token opaco. |
| `/api/public/bookings/reschedule` | Edge Function, futuro | — | Reservado para una operación atómica posterior. |

Un `.astro` puede contener una island React, pero no debe hidratar el sitio completo. La disponibilidad no debe depender de datos congelados en un build estático; debe consultarse en runtime.

## 6. Contratos de la API pública

Los contratos son DTOs, no representaciones de tablas. Los nombres de rutas son orientativos y deben versionarse antes de publicar (`/api/public/v1/...` si se adopta versionado explícito).

### Convenciones comunes

- `Content-Type: application/json` y tamaño máximo de body.
- `Idempotency-Key` obligatoria para mutaciones de creación; longitud y caracteres limitados.
- Fechas de calendario validadas como `YYYY-MM-DD` y `inicio` enviado como local-naive `YYYY-MM-DDTHH:mm:ss`, sin `Z`.
- Errores estables: `{ "error": { "code": "...", "message": "...", "retryable": false } }`.
- Nunca devolver `barbero_id`, `barberia_id`, `cliente_id`, `servicio_id`, `turno_id`, filas completas ni `CodigoVerificacion` salvo que una decisión posterior justifique un token público derivado.
- La API no debe distinguir “slug inexistente” de “slug no publicado” con información útil para enumeración; usar respuesta consistente.

### `GET /api/public/context?slug=<publicSlug>`

**Entrada:** `publicSlug` con formato y longitud limitada.

**Salida 200:**

```json
{
  "barberia": { "name": "...", "description": "..." },
  "barbers": [{ "publicToken": "...", "name": "...", "alias": "...", "description": "...", "photoUrl": "..." }]
}
```

Solo incluye barberías/barberos publicados y activos según la decisión de publicación. No expone `users_id`, horarios internos ni relaciones administrativas.

### `GET /api/public/catalog?barber=<publicToken>`

**Salida 200:**

```json
{ "services": [{ "publicToken": "...", "name": "...", "durationMinutes": 30, "price": 1000 }] }
```

La duración y el estado publicable se resuelven en la BD. El schema actual no tiene `Servicio.activo`; no se debe inventar esa columna ni tratar `null` como “activo” sin decisión y migración.

### `POST /api/public/availability`

**Entrada:** `{ "barber": "...", "service": "...", "date": "YYYY-MM-DD" }`.

**Salida 200:** `{ "date": "YYYY-MM-DD", "slots": [{ "start": "YYYY-MM-DDTHH:mm:ss", "availabilityToken": "..." }] }`.

La función valida barbería/barbero/servicio, día hábil, horario de apertura y cierre, duración autoritativa, `BloqueoHorario`, turnos ocupantes y que el inicio sea futuro. El token de disponibilidad puede vincular fecha, servicio, barbería y expiración sin revelar IDs. La respuesta nunca es una garantía: la creación vuelve a validar todo.

### `POST /api/public/bookings`

**Headers:** `Idempotency-Key` obligatoria.

**Entrada:**

```json
{
  "barber": "...",
  "service": "...",
  "start": "YYYY-MM-DDTHH:mm:ss",
  "availabilityToken": "...",
  "customer": { "name": "...", "phone": "...", "email": "..." }
}
```

**Salida 201:** `{ "bookingToken": "...", "confirmationToken": "...", "status": "pending", "expiresAt": "...", "summary": { "start": "...", "serviceName": "...", "durationMinutes": 30 } }`.

La reserva nace `pending`, bloquea el intervalo y recibe una expiración server-side de 10 minutos. La confirmación solo es válida antes de `expiresAt`. Al vencer, la operación de limpieza la cambia a `cancelado`, de forma que deje de pertenecer a `turno_sin_solape`. Un reintento con la misma clave y payload equivalente devuelve el mismo resultado; la misma clave con payload diferente devuelve `IDEMPOTENCY_KEY_REUSED`.

Errores mínimos: `INVALID_INPUT`, `PUBLIC_RESOURCE_NOT_FOUND`, `SERVICE_NOT_BOOKABLE`, `OUTSIDE_WORKING_HOURS`, `BLOCKED_SLOT`, `PAST_START`, `SLOT_UNAVAILABLE`, `IDEMPOTENCY_KEY_REUSED`, `RATE_LIMITED` (extensión futura) y `INTERNAL_ERROR`.

### `POST /api/public/bookings/confirm`

**Entrada:** `{ "confirmationToken": "...", "code": "..." }`.

**Salida 200:** `{ "bookingToken": "...", "status": "confirmed", "summary": { "start": "...", "serviceName": "...", "durationMinutes": 30 } }`.

El token debe ser opaco, de un solo uso y con expiración. La función no devuelve el código ni la fila de `CodigoVerificacion`. Los intentos inválidos deben producir un error uniforme y no confirmar si el token expiró, ya fue usado o no corresponde. Si la reserva ya expiró, debe responder `BOOKING_EXPIRED` sin reactivarla.

### `POST /api/public/bookings/cancel`

**Entrada:** `{ "bookingToken": "...", "verificationToken": "..." }` más `Idempotency-Key`.

**Salida 200:** `{ "status": "cancelled" }`.

La cancelación debe autorizarse por posesión de token, validar política temporal cuando exista y cambiar el estado a `cancelado` dentro de una operación controlada. Al quedar fuera de `turno_sin_solape`, libera inmediatamente el intervalo. Repetir la misma cancelación debe ser idempotente y no revelar datos de otra reserva.

### `POST /api/public/bookings/reschedule` — futuro

No se implementa en el MVP. La extensión debe recibir un token de reserva, el nuevo servicio/horario y una `Idempotency-Key`, validar nuevamente todas las reglas y mover la reserva en una sola transacción. No debe modelarse como “cancelar y luego crear”: esa secuencia deja una ventana inconsistente y debe reemplazarse por una operación atómica.

## 7. Seguridad por capa

| Capa | Regla obligatoria |
|---|---|
| Frontend | Validar formato y mostrar errores; nunca presentar esa validación como autorización. |
| Edge Function | Rechazar body inesperado, longitudes excesivas, formatos inválidos, tokens inválidos, origen no permitido y métodos no previstos. Resolver recursos por slug/token. |
| Base/RPC | Revalidar todo dentro de la transacción; tomar la decisión con datos actuales; usar constraints y códigos estructurados. |
| Expiración | Ejecutar limpieza de `pending` vencidas antes de disponibilidad, creación y confirmación; una pendiente vencida nunca debe bloquear ni confirmarse. |
| RLS/grants | Mantener cerradas las tablas internas a `anon`; no agregar una policy global `USING (true)` para resolver el catálogo. |
| Tokens | Aleatorios, opacos, de alta entropía, con hash almacenado cuando corresponda, expiración y uso único; nunca IDs secuenciales ni códigos en URL sin protección adicional. |
| CORS/headers | Permitir únicamente origins publicados; `Content-Security-Policy`, `Referrer-Policy`, `X-Content-Type-Options`, `Permissions-Policy` y cache prudente. No cachear respuestas con tokens o datos personales. |
| Secretos | `service_role` y claves de firma solo en Edge Functions. El navegador recibe únicamente configuración pública necesaria. |
| Privacidad | Minimizar nombre/teléfono/email; no incluirlos en logs, URLs, HTML estático ni respuestas de disponibilidad. Definir retención y acceso antes del lanzamiento. |
| Observabilidad | Correlation ID, ruta, resultado, latencia, código de error, barbería anonimizada y hash de idempotencia; redactar payloads y tokens. Alertar sobre picos de `SLOT_UNAVAILABLE`, errores y latencia. |

## 8. Hechos actuales y límites de integración

### Confirmado por el repositorio

| Hecho | Evidencia | Consecuencia |
|---|---|---|
| `crear_turno` es `SECURITY INVOKER` y exige `auth.uid()` | `supabase/migrations/phase4_crear_turno_atomico.sql` | No sirve directamente para clientes anónimos; la web requiere nueva frontera y contrato. |
| `anon` no tiene acceso directo a tablas ni secuencias | `phase8_grants_hardening.sql` y `plan_seguridad.md` | Es el baseline correcto; no debe relajarse globalmente. |
| `Servicio` no es actualmente legible por `anon` | `phase3_servicio_catalog.sql` | La lectura pública debe ser DTO/RPC controlado. |
| Existe `turno_sin_solape` EXCLUDE GiST | `plan_seguridad.md`, referencia de las fases de seguridad | Debe seguir siendo la autoridad contra solapes. |
| `CodigoVerificacion` tiene RLS sin policies y está cerrada | `AGENTS.md`, `plan_seguridad.md`, `phase8_grants_hardening.sql` | Debe permanecer detrás de una función server-side. |
| `Servicio` no tiene columna `activo` | `src/types/database.types.ts` y `plan_adaptacion_bd.md` | La publicación/actividad requiere decisión y posiblemente migración. |
| `Turno` usa `inicio` único, `origen` y `duracion_minutos` obligatorios | `AGENTS.md`, tipos y `phase4_crear_turno_atomico.sql` | No enviar `fecha`, `hora_inicio`/`hora_fin` ni duración confiada por el cliente. |
| `inicio` es `timestamp without time zone` local-naive | `AGENTS.md`, `turnos.service.ts`, `phase4_crear_turno_atomico.sql` | Normalizar sin `Z`; no enviar ISO UTC ciegamente. |
| `BloqueoHorario` está ligado a `Barbero` y distingue día completo con horas nulas | `src/types/database.types.ts`, `bloqueos.service.ts` | La disponibilidad pública debe incorporarlo server-side. |
| Los services mobile no son una API pública | `src/services/turnos.service.ts`, `barbero.service.ts`, `bloqueos.service.ts` | No reutilizar esos métodos desde el navegador público ni exponer sus selects. |

### Debe verificarse o decidirse antes de implementar

- Nombre, unicidad y ciclo de vida de un `publicSlug` para `Barberia` y tokens públicos para `Barbero`/`Servicio`.
- Si el catálogo público se publica por barbería, por `Barbero` o por ambos.
- Modelo de “activo/publicado” de `Servicio`: agregar columna, tabla de publicación o regla centralizada. La decisión debe reflejarse en schema, tipos y RPC.
- Quién administra la publicación y con qué autorización; no asumir que `Barbero` puede administrar `Servicio` porque actualmente la fase 3 revoca sus escrituras.
- Política de confirmación, proveedor de email y formato del código.
- Política de cancelación y ventana temporal.
- Disponibilidad de envío de email y almacenamiento seguro de secretos en Edge Functions.
- La reserva pública nace resuelta como `pending`, bloquea durante 10 minutos y vence automáticamente en `cancelado`; no queda abierta esta decisión.
- Dedupe de `Cliente` por barbería: el schema actual no autoriza inventar una clave de negocio.
- Estado efectivo de RLS/grants en el proyecto de destino antes de cada migración; este documento no ejecuta SQL ni mutaciones remotas.

## 9. Reglas de consistencia de una reserva

La operación autoritativa debe cumplir todas estas reglas, aunque la disponibilidad ya las haya evaluado:

1. `inicio` se interpreta como local-naive y se valida con formato estricto.
2. La duración se obtiene de `Servicio.duracion` en la BD y se guarda como snapshot en `Turno.duracion_minutos`; jamás se acepta una duración del navegador.
3. `Servicio` debe pertenecer al `Barbero` solicitado y este a la `Barberia` publicada.
4. El día debe estar en `dias_habiles` aplicable y el intervalo completo dentro de `hora_apertura`/`hora_cierre`.
5. El intervalo no puede comenzar en el pasado.
6. El intervalo no puede intersectar `BloqueoHorario`, incluido el bloqueo de día completo.
7. El servicio debe estar publicado/activo según la decisión pendiente; no inferirlo de la ausencia de `Servicio.activo`.
8. Cliente y turno se crean en una sola transacción; un error revierte todo.
9. `turno_sin_solape` es la autoridad final. Debe permitir back-to-back y dejar libre inmediatamente un turno `cancelado`.
10. Una reserva `pending` guarda una expiración server-side de 10 minutos en `pending_expires_at` o equivalente; ese valor no lo puede elegir el navegador. La disponibilidad y la creación deben convertir pendientes vencidas a estado terminal antes de evaluar solapamientos.
11. La confirmación solo puede ocurrir dentro de la ventana de expiración; una pendiente vencida no se reactiva.
12. La idempotencia se aplica antes de repetir efectos y se persiste de forma compatible con concurrencia.
13. Estados, `origen` y límites de datos se validan en el servidor; la web no puede crear sobreturnos ni modificar `barbero_id`.

La RPC pública no debe llamar sin cambios a `crear_turno`: dicha función exige autenticación y actualmente no valida horario laboral, bloqueos, publicación ni idempotencia pública.

## 10. Antifraude y antiabuso diferido

El MVP deja extensiones explícitas para:

- CAPTCHA o desafío equivalente antes de mutaciones de alto riesgo.
- Rate limiting distribuido por IP, token, teléfono normalizado y otras señales con cuidado de privacidad.
- Panel del `Barbero` para revisar abuso sin exponer secretos.
- Notificaciones SMS y verificación de teléfono.
- Detección de patrones y bloqueo gradual.

CAPTCHA solo demuestra, de forma imperfecta, que una interacción pasó un desafío; no impide replay, requests directos, carreras, duplicados, abuso de credenciales ni manipulación de campos. Por eso la base del diseño sigue siendo validación server-side, expiración de pendientes, idempotencia, límites y constraints. La reprogramación futura debe ser atómica: “cancelar + crear” en dos requests no es una solución segura.

## 11. Plan de implementación por fases

No avanzar si la aceptación de la fase anterior no está demostrada.

### Fase 0 — Congelar evidencia y cerrar decisiones

1. Exportar schema, RLS, grants, funciones, triggers, constraints, advisors y configuración de Edge Functions del proyecto objetivo.
2. Confirmar slug, publicación de servicios, confirmación, cancelación, dedupe y retención de datos.
3. Crear entorno/branch de prueba; no modificar producción.
4. Definir versión de API y DTOs.

**Dependencias:** ninguna. **Salida:** decisiones aprobadas y evidencia reproducible.

### Fase 1 — Modelo público y frontera de lectura

1. Crear la migración mínima para identidad pública/publicación elegida.
2. Diseñar schema privado o función estrecha para `context` y `catalog`.
3. Mantener `anon` sin privilegios de tabla; conceder solo la ejecución estrictamente necesaria, o invocar desde Edge Function server-side.
4. Implementar Edge Functions de contexto, catálogo y disponibilidad con DTOs mínimos.
5. Verificar no enumeración por IDs ni acceso a tablas mediante REST.

**Dependencias:** Fase 0, decisión de `Servicio.activo`/publicación.

### Fase 2 — Operación transaccional de reserva

1. Implementar RPC dedicada para reserva pública con validación completa.
2. Añadir almacenamiento server-side de idempotencia, o el mecanismo equivalente aprobado.
3. Añadir `pending_expires_at` o equivalente server-side, con una regla de integridad que impida una reserva `pending` sin expiración, y una operación transaccional para convertir pendientes vencidas a estado terminal.
4. Ejecutar esa limpieza antes de consultar disponibilidad y antes de insertar; un cronjob queda como limpieza complementaria, no como única garantía.
5. Revalidar horario, día hábil, `BloqueoHorario`, servicio publicado, duración, futuro y relaciones.
6. Resolver creación/dedupe de `Cliente` y creación de `Turno` en una transacción.
7. Revisar `SECURITY DEFINER`, `search_path`, calificación de objetos y `REVOKE EXECUTE FROM PUBLIC` si aplica.
8. Mapear `23P01` y errores de negocio a códigos estables.

**Dependencias:** Fase 1 y reglas de consistencia cerradas.

### Fase 3 — Confirmación y cancelación

1. Implementar generación, hash, expiración y consumo único de tokens/códigos.
2. Encapsular `CodigoVerificacion`; no otorgar acceso directo a `anon`.
3. Implementar confirmación y cancelación idempotentes.
4. Rechazar confirmaciones vencidas y probar que la reserva ya no bloquee después de expirar.
5. Integrar proveedor de email solo después de definir secreto, rebotes y privacidad.

**Dependencias:** Fase 2 y decisión de proveedor/política.

### Fase 4 — Frontend Astro e islands

1. Crear páginas `.astro`, layout y rutas públicas usando DTOs.
2. Implementar `BookingFlow.tsx` y `BookingConfirmation.tsx` como islands acotadas.
3. Añadir validación UX, estados de carga, reintento seguro con `Idempotency-Key` y errores de negocio.
4. Evitar que el bundle contenga secretos o acceso genérico a Supabase.

**Dependencias:** contratos de Fases 1–3.

### Fase 5 — Verificación, despliegue y rollback

1. Ejecutar typecheck/lint/build del nuevo proyecto web.
2. Probar requests directos hostiles, IDOR, enumeración, inputs extremos, replay y concurrencia.
3. Probar que cancelación libera disponibilidad y que fallos no dejan clientes huérfanos.
4. Ejecutar advisors y revisar grants efectivos antes del release.
5. Desplegar por flags o slug piloto; observar errores y latencia.
6. Preparar rollback por migración reversible, despublicación de slugs y desactivación de Edge Functions, sin ejecutar rollbacks que reabran permisos inseguros de fases anteriores.

**Dependencias:** todas las fases anteriores y evidencia aprobada.

## 12. Criterios de aceptación

### Funcionales

- [ ] Un visitante puede descubrir una barbería publicada por `publicSlug`.
- [ ] El catálogo devuelve únicamente servicios publicados y DTOs mínimos.
- [ ] La disponibilidad respeta día, horario, duración, bloqueos y futuro.
- [ ] Una reserva válida devuelve un token opaco y un resumen mínimo.
- [ ] Una reserva `pending` bloquea el horario durante como máximo 10 minutos.
- [ ] Una reserva `pending` vencida se libera sin depender exclusivamente de un cronjob.
- [ ] Una reserva inválida no crea `Cliente` ni `Turno` parcialmente.
- [ ] Confirmación y cancelación funcionan solo con tokens válidos y no exponen `CodigoVerificacion`.
- [ ] Una confirmación posterior a la expiración devuelve `BOOKING_EXPIRED` y no reactiva el turno.
- [ ] Cancelar libera inmediatamente el intervalo.
- [ ] Reintentar con la misma `Idempotency-Key` no duplica efectos.

### Seguridad

- [ ] `anon` no puede leer ni escribir directamente `Turno`, `Cliente`, `BloqueoHorario` o `CodigoVerificacion`.
- [ ] `anon` no puede enumerar `Servicio`, `Barbero` o barberías por IDs secuenciales.
- [ ] Nunca se entrega `service_role` al navegador.
- [ ] Duración, pertenencia, publicación, bloqueos y estado se validan en PostgreSQL/Edge Function.
- [ ] Una cadena de reservas `pending` no puede bloquear indefinidamente la agenda.
- [ ] Dos requests concurrentes al mismo intervalo producen como máximo una reserva exitosa.
- [ ] El frontend no puede activar sobreturno ni cambiar ownership.
- [ ] Las funciones privilegiadas tienen schema, `search_path`, grants y `REVOKE EXECUTE` revisados.
- [ ] Logs y errores no contienen PII, códigos ni tokens en claro.

### Evidencia de release

- [ ] Contratos versionados y revisados.
- [ ] Migraciones y rollback revisados sin abrir permisos globales.
- [ ] Resultado de advisors y grants efectivos archivado.
- [ ] Tests de IDOR, replay, inputs inválidos y concurrencia archivados.
- [ ] Build sin secretos y configuración de CORS/headers verificada.
- [ ] Plan de despublicación/rollback probado en entorno no productivo.

## 13. Decisiones abiertas finales

1. ¿Cuál será el `publicSlug` y dónde se almacenará su unicidad?
2. ¿La publicación se modelará con `Servicio.activo`, una tabla separada o una allowlist?
3. ¿Qué canal y proveedor entregará el código de confirmación?
4. ¿Qué ventana y token autorizarán la cancelación?
5. ¿Cómo se deduplicará `Cliente` por `Barberia` sin colisiones ni fuga de datos?
6. ¿Qué mecanismo de idempotencia persistente se aprobará?
7. ¿Se desplegará la Edge Function con acceso server-side a una RPC privada o con otra identidad mínima equivalente?
8. ¿Qué política de retención y eliminación de datos personales se aplicará?

## 14. Atajos prohibidos

- No abrir `SELECT` global sobre `Servicio` con `USING (true)`.
- No conceder `anon` acceso directo a tablas internas para “simplificar” el frontend.
- No reutilizar `crear_turno` actual como API anónima sin rediseñar su autenticación y validaciones.
- No exponer `service_role` en Astro client-side, React islands, variables públicas ni bundles.
- No confiar en validación frontend, rutas no enlazadas, headers enviados por el cliente o un booleano como prueba de autorización.
- No aceptar `duracion_minutos`, `barbero_id`, estado interno o ownership desde el navegador.
- No usar IDs secuenciales como tokens de reserva, confirmación o cancelación.
- No resolver reprogramación con “cancelar y luego crear”.
- No usar `toISOString()` UTC para `inicio` local-naive.
- No crear una `SECURITY DEFINER` sin `search_path` fijo, nombres calificados y `REVOKE EXECUTE FROM PUBLIC` explícito.
- No ejecutar SQL ni mutaciones remotas como parte de esta especificación; cada cambio deberá llegar mediante migración revisada, pruebas y rollback.

## Referencias del estado actual

- `AGENTS.md`
- `plan_seguridad.md`
- `plan_adaptacion_bd.md`
- `supabase/migrations/phase2_turno_tenant_integrity.sql`
- `supabase/migrations/phase3_servicio_catalog.sql`
- `supabase/migrations/phase4_crear_turno_atomico.sql`
- `supabase/migrations/phase8_grants_hardening.sql`
- `src/services/turnos.service.ts`
- `src/services/barbero.service.ts`
- `src/services/bloqueos.service.ts`
- `src/lib/supabase.ts`
- `src/types/database.types.ts`

## 15. Handoff de sesión e implementación

> Esta sección registra el estado al mover el trabajo al repositorio propio de la web.

### SDD Session Preflight (ya respondido)

| Campo | Valor |
|---|---|
| Execution mode | `interactive` |
| Artifact store | `both` (OpenSpec en este repo + Engram, proyecto `conexion-demo`) |
| Delivery strategy | `ask-on-risk` |
| Chain strategy | se define solo si el forecast excede el presupuesto |
| Review budget | 400 líneas cambiadas |

### Decisiones cerradas en esta sesión

- **Una sola barbería** para el MVP → el catálogo público es a nivel `Barberia`. Queda resuelta la ambigüedad "por barbería / por barbero" para el alcance de la demo.
- Se **elimina el link "Iniciar sesión"** del flujo público: no existe cuenta de cliente.
- Se agrega un **switch claro/oscuro**. El tema oscuro ya está definido en `conexion-barber-flujo-completo (2).html`; el claro en `conexion-barber-blanco.html`.
- **Fuente de verdad visual:** los archivos HTML del prototipo. Se implementan respetando el diseño existente.
- **Fuente de verdad técnica y de seguridad:** este documento. Donde haya conflicto entre el prototipo y este plan, manda este plan.

### Mapa prototipo → aplicación

| Vista del prototipo | Selector | Ruta propuesta |
|---|---|---|
| Home (hero + servicios) | `#view-home` | `/b/[slug]` |
| Fecha y hora | `#view-datetime` | paso dentro de `/b/[slug]/reservar` |
| Contacto + código OTP | `#view-contact` | paso dentro de `/b/[slug]/reservar` |
| Confirmación | `#view-confirm` | `/b/[slug]/confirmar/[token]` |

Elementos del prototipo que **no** se reutilizan tal cual:

- `CORRECT_CODE = '123456'` (OTP simulado en cliente).
- Arrays `services` y `TIMES` hardcodeados.
- Día cerrado fijo `d.getDay() === 0`.
- Link "Iniciar sesión" y "Unite a la lista de espera".

### Rutas de referencia en el repositorio hermano

`AGENTS.md`, `plan_seguridad.md`, `plan_adaptacion_bd.md`, `supabase/migrations/*` y `src/**` viven en:

`D:\ComIT\proyecto-final-rn`

Este repositorio (`conexion-demo`) contiene únicamente la web pública.

### Próximo paso

1. Ejecutar `sdd-init` en el proyecto `conexion-demo`.
2. Exploración y propuesta del cambio.
3. Cerrar las decisiones abiertas de la sección 13 antes de cualquier migración.
