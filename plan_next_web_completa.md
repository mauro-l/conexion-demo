# Plan técnico: web pública en Next.js

> **Estado:** plan de migración e implementación para revisión. No implementa cambios.
>
> **Aprobado en Fase 0:** conjunto de decisiones de producto entregado en este turno. Reemplaza la propuesta anterior de `plan_next_web_completa.md` sobre un único dominio con panel privado dentro del mismo proyecto Next.

## 0. Entradas aprobadas de Fase 0

Este documento incorpora como decisiones vinculantes el siguiente paquete aprobado por producto:

- Dos proyectos/aplicaciones separadas, no una sola.
  - **Pública:** `conexion-barberia.com/` (Next.js App Router), con landing y flujo de reserva.
  - **Privada:** `agenda.conexion-barberia.com`, hoy `https://proyecto-final-rn.vercel.app/`; gestiona login `/login`, turnos `/turnos`, perfil `/perfil`. No se modifica en este ciclo.
   - Ambas se despliegan en Vercel. El acceso al dominio y la gestión DNS se tratarán como trabajo operativo separado al finalizar la implementación.
- Rutas públicas: `/` y `/reservar` (más confirmación y cancelación). El `public_slug` se usa solo para resolución interna/backoffice, no en la URL pública.
- Catálogo demo atado a `Servicio.barbero_id`; sin migrar a catálogo de barbería ni agregar `Servicio.activo`.
- Datos del cliente obligatorios: nombre, apellido, teléfono. Email opcional, solo si se opta por confirmación por correo en un flujo futuro.
- Horarios, días laborables/excepciones y duración se configuran en la app privada; la app pública solo lee para calcular disponibilidad.
- Zona horaria fija del producto: `America/Argentina/Buenos_Aires`; no habrá selector ni soporte de otras zonas en este ciclo.
- Confirmación inmediata: la reserva queda `confirmado` dentro de la misma transacción. Sin código de confirmación en este MVP. `pending` puede seguir en el enum para usos futuros.
- Cancelación permitida hasta 5 minutos antes del inicio del turno, sin otro mínimo previo.
- Teléfono canónico argentino `+549` + 10 dígitos. La fuente de verdad es `Cliente.telefono_normalizado`; `Cliente.telefono_raw` conserva el input original. La migración `phase9_cliente_telefono_canonico` ya está aplicada. El índice `(barberia_id, telefono_normalizado)` existe y es deliberadamente no único.
- Selección de profesional: solo “Cualquier profesional” en el MVP; no selector explícito de barbero.
- Panel privado, roles y auditoría administrativa quedan fuera de este ciclo.
- Deployment, Vercel y DNS quedan fuera de este ciclo y se tratarán como trabajo operativo separado.

## 1. Decisión ejecutiva

Se migrará la landing pública actual a **Next.js App Router** como **aplicación pública independiente**, alojada en `conexion-barberia.com/`, con el flujo completo de reserva integrado en el mismo proyecto. El panel privado permanece en su propio proyecto/aplicación, accesible vía `agenda.conexion-barberia.com`, y no se altera en este ciclo.

| Decisión | Elección | Motivo |
|---|---|---|
| Framework | Next.js App Router + TypeScript | SSR, metadata, formularios y navegación optimizada para la web pública sin convertirla en SPA. |
| Render | Server Components por defecto | La landing y los datos públicos llegan como HTML; se reduce JavaScript y se favorece velocidad/SEO. |
| Interactividad | Client Components pequeños | Solo calendario, slots, formulario, tema y controles de UX necesitan estado en navegador. |
| Backend | Se conserva la frontera Supabase Edge Functions + RPC | Es la frontera ya existente y mantiene PostgreSQL como autoridad de reservas. No se agrega un BFF duplicado. |
| Dominio | `conexion-barberia.com/` para la app pública; `agenda.conexion-barberia.com` para la privada | Separa responsabilidades: la pública es solo landing y reserva; la privada es gestión interna. |
| Hosting | Un servicio Next administrado (Vercel) y un proyecto Supabase | Suficiente para una barbería; no se introducen Redis, colas, ORM ni microservicios. |
| Middleware | Ninguno inicialmente; solo protección ligera si se demuestra útil | La autorización y validación deben ocurrir en cada Server Action/Route Handler o función de servidor. |

**Importante:** actualmente la landing está implementada en Astro SSR, no en Next.js. `/b/[slug]` ya lee contexto y catálogo mediante Edge Functions, y existen migraciones de descubrimiento público. El booking todavía **no está implementado**: los botones del catálogo actual son visuales, no existe disponibilidad pública, creación transaccional anónima, confirmación ni cancelación. Los prototipos HTML tampoco son una implementación de negocio.

La elección de Next.js ahora se justifica por la siguiente etapa: unificar landing, flujo de reserva y despliegue bajo un solo dominio público, manteniendo la autoridad en Supabase.

## 2. Principios de alcance

- Una barbería en el MVP; dejar el `barberia_id` en la frontera de autorización para no bloquear una futura expansión.
- El cliente anónimo es hostil: todo input, estado, precio, duración, profesional y fecha se revalida en servidor y base.
- Los DTOs públicos no son tablas; no exponen IDs internos, PII ni estados administrativos.
- PostgreSQL decide la reserva final. La disponibilidad es una sugerencia que puede quedar obsoleta.
- No crear cuenta de cliente; el reconocimiento se basa en el token opaco de gestión de la reserva.
- No convertir los prototipos en fuente de datos: servicios, horarios, días cerrados y estados deben salir del backend.
- No agregar funcionalidades de escala antes de que una necesidad real lo exija.
- El panel privado, roles, permisos y auditoría administrativa son responsabilidad de la aplicación privada y quedan fuera de este ciclo.

## 3. Mapa de rutas de la app pública

| Ruta | Acceso | Render y responsabilidad |
|---|---|---|
| `/` | Público | Landing SSR: perfil, información, tema y catálogo. Resuelve la barbería por `public_slug` configurado. |
| `/reservar` | Público | Flujo de reserva: servicio, profesional “cualquier profesional”, fecha, disponibilidad y datos del cliente. |
| `/reserva/confirmada` | Público | Resumen mínimo tras reserva exitosa; incluye enlace de gestión con token opaco. |
| `/reserva/gestionar` | Público con token opaco | Resumen mínimo y cancelación autorizada por posesión del token. |
| `/api/public/*` | Interno/público controlado | Solo Route Handlers si agregan valor al navegador; no proxy genérico de Supabase. |

**Nota:** el panel privado no pertenece a esta aplicación. Las rutas `/login`, `/turnos`, `/perfil` están en `agenda.conexion-barberia.com` y no se modifican en este ciclo. El `public_slug` de `Barberia` se usa solo para resolución interna y backoffice, no como segmento de URL pública.

## 4. Arquitectura Next.js objetivo

```text
Navegador (conexion-barberia.com)
  ├─ HTML SSR de Next Server Components
  └─ Client Components mínimos para interacción
           │
           ├─ Server Components/Actions para lecturas propias
           └─ Route Handlers solo para requests del navegador que lo requieran
                          │
                          v
               Supabase Edge Functions
        DTO público, validación, tokens, límites, CORS
                          │
                          v
               RPC estrecha + PostgreSQL/RLS
        constraints, locks, anti-solape, tenant y auditoría mínima
```

### Regla de elección entre mecanismos Next

1. **Server Component:** lectura necesaria para renderizar una página. No llamar a un Route Handler propio desde el servidor; llamar al cliente server-only o a la frontera Edge directamente.
2. **Client Component:** solo estado de interacción, accesibilidad, loading y errores de UX. Nunca contiene secretos ni autoridad.
3. **Route Handler:** endpoint necesario para `fetch` desde un Client Component, descarga/redirect controlado o integración que no encaje en Server Action. Rechaza métodos y bodies inesperados.
4. **Server Action:** opción para formularios internos si el runtime y el despliegue la soportan de forma verificable. Debe repetir autorización, validación CSRF/origin e idempotencia; no reemplaza la RPC.
5. **Middleware:** únicamente redirección o headers baratos. No consultar la base ni decidir ownership allí.

## 5. Estructura de carpetas objetivo

```text
app/
  layout.tsx
  not-found.tsx
  page.tsx              # Landing pública (/)
  globals.css
  reservar/page.tsx     # Flujo de reserva
  reserva/
    confirmada/page.tsx
    gestionar/page.tsx
  api/public/{context,catalog,availability,bookings}/route.ts
components/
  public/               # Server Components salvo interacción explícita
  booking/              # Client Components del flujo
  ui/                   # primitives accesibles y sin reglas de negocio
lib/
  public-api.server.ts
  booking-api.server.ts
  validation.ts
  tokens.server.ts
  date-time.ts
  errors.ts
  theme.ts
types/
  public.ts
  booking.ts
supabase/
  functions/
  migrations/
  seed_demo.sql
tests/
  unit/ integration/ e2e/
```

La estructura es una guía, no una autorización para crear todo en la primera fase. Mantener los módulos de acceso a datos `server-only` evita importar accidentalmente credenciales o selects administrativos en un Client Component.

## 6. Migración Astro → Next.js

| Área actual | Estado observado | Plan Next.js |
|---|---|---|
| `src/pages/b/[slug].astro` | SSR con dos lecturas en paralelo y respuesta 404 reescrita | `app/page.tsx`, `Promise.all`, `notFound()` para recurso ausente; error genérico para fallos internos. |
| `src/layouts/PublicLayout.astro` | HTML, metadata básica, fuentes, tema inicial y topbar | `app/layout.tsx` + layout público; `metadata`/`generateMetadata`; bootstrap de tema antes del paint. |
| `src/pages/404.astro` | Página española de perfil no encontrado | `app/not-found.tsx`. |
| `ServiceCatalog.astro` | SSR desde DTO, detalles y precio; CTA inerte | Server Component `ServiceCatalog`; CTA navega a `/reservar?service=...` usando token público estable, nunca índice/ID. |
| `ThemeSwitch.tsx`, `theme.ts` | Island React, `localStorage`, preferencia del sistema | Client Component pequeño; conservar tokens, usar `suppressHydrationWarning`/bootstrap cuidadosamente y no hidratar el layout completo. |
| `tokens.css` | Tokens light/dark ya alineados con prototipos | Mover a `globals.css` o import CSS equivalente sin cambiar la fuente visual sin aprobación. |
| `public-api.server.ts` | Cliente server-side a `public-context` y `public-catalog` | Reescribir con `process.env` server-only, timeout, DTO validation y cliente de booking separado. No usar `NEXT_PUBLIC_*` para secretos. |
| `types/public.ts` | DTO público sin IDs; todavía sin tokens | Conservar como contrato base; añadir tipos versionados para disponibilidad/reserva, sin convertirlos en tipos de tabla. |
| Edge Functions existentes | `public-context`/`public-catalog` usan `service_role` y RPC estrecha | Mantener boundary; ampliar con funciones de disponibilidad/reserva/cancelación y ajustar CORS al origin definitivo. |
| Astro/Node/package scripts | `astro dev/check/build` y dependencias Astro | Reemplazar por scripts Next equivalentes en una fase de migración separada; lockfile y package son cambios de implementación futuros, no de este documento. |
| Datos hardcodeados de prototipos | `services`, `TIMES`, domingo cerrado | Eliminar del runtime; usar DTOs y reglas de BD. Los textos visuales sirven como referencia, no como regla. |

**Reuso:** tokens CSS, copy visual aprobado, iconografía simple, DTOs públicos y pruebas conceptuales. **Reescritura:** layouts Astro, routing, fetching, componentes de flujo y formularios. **No reutilizar:** arrays de slots, link de login del prototipo, waitlist o reCAPTCHA como si fueran funcionalidades reales.

## 7. Frontera de backend y autoridad

Se conserva **Supabase Edge Functions → RPC PostgreSQL** como frontera principal. Next no tendrá `service_role`; ni en bundle, variables `NEXT_PUBLIC_*`, logs ni requests del navegador.

### Responsabilidades

- **Next:** composición de páginas, validación de forma para UX, estado, navegación y lectura server-side.
- **Edge Function:** método/origin, tamaño y forma del body, rate limit específico si se añade, tokens, errores estables, DTOs y observabilidad redactada.
- **RPC:** resolver IDs a partir de tokens/slug, comprobar relaciones y publicación, aplicar transacción y devolver solo resultado mínimo.
- **PostgreSQL:** FKs, `CHECK`, RLS/grants, `turno_sin_solape` y consistencia final.

Una alternativa lean sería un Route Handler Next que use un cliente server-side para llamar RPC privadas. Se descarta como frontera primaria porque duplicaría CORS, autenticación operativa, despliegue y observabilidad ya resueltos por Edge Functions. Puede evaluarse para operaciones exclusivamente privadas si reduce complejidad; no puede convertirse en proxy genérico.

## 8. Flujo completo de reserva

1. **Servicio:** `/` muestra catálogo publicado. La selección navega con un token/identificador público; el servidor vuelve a resolver nombre, precio y duración.
2. **Profesional:** en el MVP solo se ofrece “Cualquier profesional”. La resolución a barbero concreto ocurre server-side dentro de la transacción de reserva. No se construye selector explícito de barbero en este ciclo.
3. **Fecha:** ofrecer un rango acotado de días futuros, definido por producto, calculado siempre en `America/Argentina/Buenos_Aires`. No asumir “14 días” ni domingo cerrado del prototipo.
4. **Disponibilidad:** Next solicita slots para servicio/profesional/fecha. Edge/RPC calcula día laborable, horario efectivo, duración, bloqueos, turnos activos y futuro. Cada slot lleva token de disponibilidad con expiración corta.
5. **Datos:** recopilar nombre, apellido y teléfono. Email no se pide en el MVP; queda reservado para una futura confirmación por correo opcional.
6. **Anti-abuso y validación básica:** límites de body, longitudes, teléfono según decisión, origin, método, token, fecha estricta, payload equivalente e idempotency key. CAPTCHA/rate limiting avanzado quedan diferidos salvo evidencia de abuso.
7. **Reserva atómica:** POST con `Idempotency-Key`; RPC resuelve entidades, recalcula duración/precio, valida bloqueos/horarios/futuro en la zona fija argentina, crea/actualiza cliente y turno en una transacción y deja el turno directamente en estado `confirmado`.
8. **Confirmación:** no hay código de confirmación en el MVP. El turno queda confirmado en la misma transacción. Email de confirmación es opcional/futuro; proveedor y política de reenvío quedan abiertos.
9. **Resultado:** mostrar resumen mínimo y enlace de gestión con token opaco. No incluir PII en la URL.
10. **Cancelación:** token opaco + límite de 5 minutos antes del inicio del turno. RPC idempotente cambia estado terminal y libera el intervalo. No implementar reprogramación como “cancelar y crear”.

Los estados de loading, error, retry y “slot ocupado” deben ser explícitos. Un retry de creación conserva la misma `Idempotency-Key`; no genera una nueva automáticamente.

## 9. Modelo de datos y migraciones necesarias

El baseline archivado indica que todas las tablas actuales tienen RLS y que `anon` no tiene grants. También indica que la constraint anti-solape fue aplicada en vivo pero su migración no está versionada en este repositorio. Ese hecho debe verificarse contra el proyecto objetivo antes de diseñar nuevas migraciones; `database.types.ts` no es autoridad suficiente.

### Tablas existentes a conservar y completar

| Tabla | Campos relevantes observados | Cambio/planteo |
|---|---|---|
| `Barberia` | `id`, `nombre`, `admin_user_id`, `dias_habiles`, `hora_apertura`, `hora_cierre`; ya existen `public_slug`, `description`, `publicado` y detalles de landing en migraciones phase9/phase10 | Mantener slug único y datos públicos. El `public_slug` se usa para resolución interna/backoffice, no en URL pública. |
| `Barbero` | `id`, `users_id`, `barberia_id`, `nombre`, `activo`, horarios propios | La asignación concreta de turno se resuelve server-side. No se expone selector de barbero en el MVP. |
| `Servicio` | `id`, `barbero_id`, `nombre`, `duracion`, `precio`, `descripcion` | Mantener el catálogo atado a `barbero_id` en este ciclo. No agregar `Servicio.activo` ni tabla de publicación. |
| `Turno` | `id`, `estado`, `inicio timestamp without time zone`, `cliente_id`, `barbero_id`, `servicio_id`, `origen`, `duracion_minutos` | Creación atómica directamente en `confirmado`. No ventana `pending` activa. No aceptar duración/estado/origen arbitrarios. |
| `Cliente` | `id`, `barberia_id`, `nombre`, `email`, `telefono`, `telefono_normalizado`, `telefono_raw`, notas y timestamps | Campos obligatorios: nombre, apellido, teléfono. Email opcional. `telefono_normalizado` `text` con formato `+549...` es la fuente de verdad; `telefono` numeric queda deprecated. `telefono_raw` conserva el input original. El índice `(barberia_id, telefono_normalizado)` no es único por decisión de producto. |
| `BloqueoHorario` | `barbero_id`, `fecha`, horas nullable, `motivo` | Null/null significa bloqueo de día completo; incluirlo en disponibilidad. |

### Nuevas estructuras mínimas a evaluar

- `booking_idempotency`: clave, hash de payload normalizado, resultado mínimo/token hash, estado, expiración y `barberia_id`; unique por operación/tenant. Nunca guardar PII innecesaria en la clave.
- Almacenamiento de tokens: hash de token opaco, tipo, `turno_id`, expiración, usado/revocado y timestamps; no guardar el token crudo si no hace falta.
- Constraint/índice de cliente: existe `cliente_barberia_tel_idx` sobre `(barberia_id, telefono_normalizado)` y no es único por decisión de producto.
- Normalización de teléfono: usar `normalizarCelularAR` y el formato documentado `+549` + 10 dígitos; aplicar el mismo contrato en frontend y RPC/backend. La base lo refuerza con `cliente_telefono_formato_chk`.

### Concurrencia

La constraint `EXCLUDE USING gist` sobre `barbero_id` y `tsrange(inicio, inicio + duración)` debe existir de forma versionada y cubrir estados que ocupen slot (por ejemplo `confirmado` y `completado`), excluyendo estados terminales que deben liberar el slot. Debe permitir reservas back-to-back. La RPC de creación:

1. normaliza fecha local-naive sin `Z` y obtiene duración desde `Servicio`;
2. bloquea/serializa lo necesario dentro de la transacción;
3. comprueba día, horario, bloqueo, publicación y pertenencia;
4. normaliza el teléfono, busca/crea/actualiza cliente atómicamente;
5. inserta turno en estado `confirmado` atómicamente;
6. traduce conflicto `23P01` a `SLOT_UNAVAILABLE`;
7. devuelve el resultado previamente persistido si la idempotency key coincide.

La disponibilidad nunca garantiza la reserva. Dos requests concurrentes al mismo intervalo deben producir como máximo una reserva exitosa aunque ambas hayan visto el slot libre.

## 10. Panel privado (aplicación separada, fuera de este ciclo)

La aplicación privada vive en `agenda.conexion-barberia.com` (actualmente `https://proyecto-final-rn.vercel.app/`). Sus rutas `/login`, `/turnos`, `/perfil` y sus responsabilidades de autenticación, roles, configuración de horarios, servicios, bloqueos y auditoría administrativa no se modifican en este documento.

Cualquier cambio en la app privada que afecte la disponibilidad leída por la app pública (horarios, días laborables, excepciones, duración de servicios) se considera requisito de la app privada y debe mantenerse compatible con los contratos públicos de disponibilidad.

## 11. Seguridad

- **Input:** validar en Client Component para UX y de nuevo en Edge/RPC; rechazar campos desconocidos, tamaños excesivos, fechas ambiguas y estados no permitidos.
- **Secretos:** `SUPABASE_SERVICE_ROLE_KEY` solo en Edge Functions/entorno seguro; nunca `NEXT_PUBLIC_*`, HTML, logs o variables que se envíen al cliente.
- **RLS/grants:** `anon` sin acceso directo a `Turno`, `Cliente`, `BloqueoHorario` ni catálogos internos. No abrir `USING (true)` para simplificar.
- **Autorización:** la app pública no tiene sesión de barbero; la autorización se basa en tokens públicos estables y en la validación server-side. La app privada mantiene su propia autenticación y autorización sin cambios en este ciclo.
- **Tokens:** aleatorios, opacos, alta entropía, hash almacenado cuando corresponda, expiración, uso único y revocación; no IDs secuenciales ni PII en URL.
- **CSRF/origin:** para POST desde el mismo dominio, comprobar `Origin`/`Host` y usar cookies con `HttpOnly`, `Secure`, `SameSite` apropiado. Edge CORS debe permitir solo el origin de producción y localhost de desarrollo.
- **Rate limiting:** no desplegar Redis por defecto. Empezar con límites server-side en operaciones de alto riesgo y almacenamiento/servicio administrado solo si el abuso real lo exige. Separar límites de disponibilidad de creación y cancelación.
- **PII:** acordar campos, retención, acceso y borrado; no registrar nombre, email, teléfono, token ni payload completo.
- **Headers:** CSP compatible con fuentes/imágenes aprobadas, `Referrer-Policy`, `X-Content-Type-Options`, `Permissions-Policy`, `Vary` correcto y no cachear respuestas con tokens/PII.
- **Logs:** correlation ID, ruta, resultado, latencia, código estable, tenant anonimizado y hash de idempotencia; jamás secretos.

## 12. Rendimiento y operación

- Landing y metadata en Server Components; no hidratar catálogo, hero ni layout completo.
- Cachear solo contexto/catálogo publicados si la invalidación está definida; no cachear disponibilidad, reservas ni respuestas con tokens.
- Disponibilidad bajo demanda, fechas acotadas y queries con límites; no traer agenda completa para cada visitante.
- Mantener la foto optimizada y con origen aprobado; no agregar pipeline de imágenes si una imagen estática optimizada es suficiente.
- No usar Realtime para la landing ni para disponibilidad MVP: la RPC y el conflicto transaccional son suficientes. No agregar Redis, colas, workers ni ORM salvo requerimiento medido.
- Índices a verificar/crear: slug único, FKs usadas en disponibilidad, `(barberia_id, fecha)` en bloqueos, turno por barbero/inicio/estado, claves de idempotencia/tokens y `(barberia_id, telefono_normalizado)` una vez migrado el tipo. Medir con `EXPLAIN` antes de optimizar más.
- Loading states: `loading.tsx` o boundaries pequeños para navegación; errores accionables y reintentos seguros, sin revelar estado interno.
- Fechas: `inicio` actual es local-naive; interpretar y validar siempre en `America/Argentina/Buenos_Aires` y no usar `toISOString()` ciegamente para persistirlo.

## 13. Plan por fases

No avanzar sin la verificación de la fase anterior.

### Fase 0 — Decisiones y baseline

**Entregables:** export/introspección del schema real, RLS, grants, constraint anti-solape y funciones; contrato de teléfono canónico verificado, decisiones de campos, cancelación, zona horaria argentina y contratos públicos aprobados (este documento).

**Verificación:** probes SQL de grants/RLS/constraints, advisors Supabase, inventario de secretos, migración canónica de teléfono y contrato aprobado.

**Rollback:** ninguno en producción; solo descartar artefactos de análisis.

### Fase 1 — Migración Next y paridad pública

**Entregables:** scaffold Next App Router, `/`, metadata, `notFound()`, layout, estilos y tema; reescritura del cliente server-only; paridad visual con ambos prototipos; sin booking.

**Dependencias:** Fase 0 y datos públicos actuales.

**Verificación:** `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`, `npx playwright test` contra un entorno reproducible; comprobar HTML sin IDs/secretos y parity unknown/unpublished.

**Rollback:** mantener Astro desplegado y cambiar el origin al deployment anterior; no tocar tablas de reservas.

### Fase 2 — Disponibilidad de solo lectura

**Entregables:** contrato Edge/RPC de availability, cálculo por horario/día/bloqueo/turnos, calendario y slots Client Component, expiración corta de availability token.

**Verificación:** fechas pasadas, día cerrado, bloqueo completo/parcial, duración real, límites de rango y ausencia de IDs.

**Rollback:** deshabilitar CTA/ruta de reserva o volver a landing pública; no hace falta borrar datos.

### Fase 3 — Creación confirmada atómica

**Entregables:** migración de idempotencia/tokens, RPC pública dedicada, Edge Function de booking, formulario y estados de error; verificación del tipo real de `Cliente.telefono` y migración a texto si es necesario.

**Verificación:** requests hostiles, payload cambiado, replay, doble click, concurrencia, rollback transaccional, `SLOT_UNAVAILABLE`, dedup por teléfono normalizado y creación directamente en `confirmado`.

**Rollback:** despublicar CTA y endpoint de creación; conservar migraciones aditivas y revisar reversión sin eliminar reservas existentes.

### Fase 4 — Cancelación

**Entregables:** tokens opacos hashados, resumen de reserva y cancelación idempotente con límite de 5 minutos antes del inicio.

**Verificación:** token ajeno, reserva ya iniciada o vencida, cancelación libera slot, idempotencia de cancelación y logs redactados.

**Rollback:** detener nuevas cancelaciones y dejar operación manual definida; no reabrir permisos `anon`.

### Fase 5 — Panel privado

**No forma parte de este proyecto/ciclo.** El panel privado permanece en `agenda.conexion-barberia.com` (actualmente `https://proyecto-final-rn.vercel.app/`). Las mejoras de autenticación, roles, agenda, servicios, horarios, bloqueos, reservas y auditoría administrativa se planifican en la aplicación privada, no en este documento.

**Nota:** si un cambio futuro de la app privada modifica los contratos que la app pública lee (horarios, días laborables, excepciones, duración), ese cambio debe mantener compatibilidad y versionarse aparte.

### Fase 6 — Endurecimiento y handoff operativo

**Entregables:** headers/CSP, backups/verificación, alertas básicas, runbook y prueba de rollback. El deployment, Vercel y DNS se entregan como trabajo operativo separado a la persona responsable.

**Verificación:** `npm run lint && npm run typecheck && npm test && npm run build`; E2E público; advisors; escaneo de bundle para secretos. El smoke de dominio queda fuera de este ciclo.

**Rollback:** cambiar alias del dominio al deployment anterior, despublicar slug/CTA y desactivar funciones nuevas de forma controlada.

## 14. Despliegue y costo

Configuración lean recomendada: un deployment Next.js administrado en Vercel con el dominio `conexion-barberia.com/`, un proyecto Supabase existente con PostgreSQL/Auth/Edge Functions y, en el futuro, un proveedor de email transaccional de bajo volumen si se activa confirmación por correo. La aplicación privada se mantiene en su propio deployment Vercel con `agenda.conexion-barberia.com`.

Mantener preview deployments para revisión, pero un único production origin en CORS de la app pública. No presupuestar Redis, CDN propio, Kubernetes, observabilidad empresarial, colas, workers permanentes, ORM ni Realtime. Usar logs del hosting/Supabase y alertas simples. Revisar costos de transferencia de imágenes y email; fijar límites y retención. La decisión final de proveedor debe considerar región, secretos, backups y soporte, no solo precio nominal.

## 15. Fuera de alcance deliberado

- Pago online, suscripciones o facturación.
- SMS/WhatsApp transaccional, salvo enlaces manuales existentes.
- CAPTCHA obligatorio y reputación avanzada antes de evidencia de abuso.
- Waitlist, reprogramación y cancelación + creación en dos pasos.
- Multi-sucursal, múltiples tenants operativos, RBAC complejo y SSO.
- Redis, queues, Realtime, ORM, analytics avanzada y aplicación nativa.
- Migrar o corregir el repositorio móvil no necesario para esta web.
- Panel privado, roles y auditoría administrativa en este ciclo.
- Editar ahora cualquier código, migración, HTML, package o artefacto SDD; este archivo es únicamente el plan.

## 16. Criterios de aceptación

### Producto

- [ ] `/` reproduce la landing actual desde DTOs, con metadata, 404 y temas light/dark.
- [ ] El visitante puede recorrer servicio → “Cualquier profesional” → fecha → disponibilidad → datos → reserva confirmada.
- [ ] No se usan arrays de slots, servicios ni estados hardcodeados del prototipo.
- [ ] La disponibilidad refleja horarios, días, bloqueos, duración y turnos actuales.
- [ ] Una reserva válida queda atómica, idempotente y confirmada en la misma transacción.
- [ ] Cancelación cumple la política de 5 minutos antes del inicio.
- [ ] El panel privado no se incluye en este proyecto; permanece en su aplicación separada.

### Seguridad

- [ ] Browser y bundle no contienen `service_role`, IDs internos sensibles, códigos ni PII innecesaria.
- [ ] `anon` no puede seleccionar tablas internas por REST/PostgREST.
- [ ] Cada mutación revalida input, relaciones, publicación y estado.
- [ ] Dos requests simultáneos no crean doble reserva.
- [ ] Tokens son opacos, expirables, de uso único cuando corresponda y no aparecen en logs.
- [ ] RLS, grants, `search_path`, `SECURITY DEFINER` y ejecución de RPC están auditados.

### Rendimiento y calidad

- [ ] Server Components son la opción por defecto y el JavaScript cliente está justificado por componente.
- [ ] No hay llamadas del servidor a Route Handlers propios innecesarias.
- [ ] Landing, availability y booking tienen políticas de cache explícitas.
- [ ] Queries están acotadas y tienen índices medidos.
- [ ] `lint`, typecheck, unit/integration, build y E2E reproducibles pasan en entorno no productivo.

## 17. Decisiones pendientes antes de codificar

1. **Email de confirmación opt-in:** no forma parte del MVP ni bloquea la implementación. Más adelante habrá que definir si se activa, en qué momento se pide el email, proveedor y política de reenvío/retención.

## 18. Próxima acción recomendada

Antes de crear el scaffold Next.js, ejecutar la verificación final de baseline (schema, RLS, grants, constraint anti-solape y funciones) y aprobar los contratos públicos de disponibilidad/reserva. El teléfono canónico ya está resuelto por `phase9_cliente_telefono_canonico`; la confirmación por email queda explícitamente fuera del MVP. Después, implementar la Fase 1 como migración de paridad pública sin activar booking. Esto mantiene un rollback simple y evita construir el flujo sobre reglas de negocio contradictorias.

### Referencias inspeccionadas

- `plan_web_publica.md`: reglas de seguridad, tokens e idempotencia; su decisión Astro queda supersedida aquí.
- `plan_next_web_completa.md` (versión anterior): propuesta de único dominio con panel privado; queda supersedida por este documento.
- `package.json`, `astro.config.mjs`, `tsconfig.json`: scaffold Astro SSR actual.
- `src/layouts/PublicLayout.astro`, `src/pages/b/[slug].astro`, `src/pages/404.astro`, `src/components/ServiceCatalog.astro`, `src/components/ThemeSwitch.tsx`, `src/styles/tokens.css`: implementación pública actual.
- `src/lib/public-api.server.ts`, `src/lib/theme.ts`, `src/types/public.ts`: cliente server-side, tema y DTOs existentes.
- `supabase/functions/**`, `supabase/migrations/**`, `supabase/seed_demo.sql`: frontera Edge/RPC, publicación y datos demo actuales.
- `telefono-canonico-frontend.md`: contrato canónico frontend para teléfonos argentinos y firma vigente de `crear_turno`.
- `conexion-barber-blanco.html`, `conexion-barber-flujo-completo (2).html`: fuente visual y flujo simulado; no fuente de autoridad de negocio.
- `openspec/specs/**` y `openspec/changes/archive/2026-09-14-web-publica-reservas/**`: alcance implementado del slice público Astro, advertencias de verificación y gaps del modelo.
