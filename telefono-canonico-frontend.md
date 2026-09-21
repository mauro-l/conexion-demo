# Teléfonos: formato canónico `+549`

> Para el equipo de frontend web. Última actualización: 2026-09-21 (PR #69, Fase 9).

El teléfono del cliente dejó de ser un `numeric` y pasó a ser un canónico en `text`. El motivo es concreto: un `numeric` no puede preservar el `+` ni ceros iniciales, así que el link de WhatsApp nunca podía funcionar. Ahora el teléfono se guarda en formato internacional argentino y el botón de WhatsApp del detalle del turno abre el chat correcto.

Esta guía tiene **lo que necesitás para no romper nada**. Si vas a tocar teléfonos, leé las tres secciones marcadas como críticas.

---

## 1. Punto de partida

El diagnóstico original, verificado contra Supabase, era:

- `Cliente.telefono` era `numeric` y nullable.
- 12 clientes, 9 con teléfono, 3 con `NULL`.
- Los 9 tenían 13 dígitos y empezaban con `54`.
- **Ninguno empezaba con `0`** — esto no era señal de datos limpios, era la huella del daño: el `numeric` ya se había comido los ceros iniciales.
- No existía unicidad por teléfono. Solo un índice único parcial por `(barberia_id, email)`.

El plan original proponía tres pasos. **Se hicieron los dos primeros y el tercero se descartó a propósito** (ver sección 6):

| Paso del plan | Estado |
|---|---|
| 1. Definir el formato canónico argentino | ✅ `+549` + 10 dígitos |
| 2. Migrar `telefono` a `text` o agregar `telefono_normalizado` | ✅ Columna nueva `telefono_normalizado` |
| 3. Crear unicidad por `(barberia_id, telefono_normalizado)` | ❌ **Descartado** por decisión de producto |

---

## 2. Camino rápido

Si vas a escribir una pantalla o un servicio que toque teléfonos:

1. **Leer**: usá `Cliente.telefono_normalizado`. Nunca `Cliente.telefono`.
2. **Escribir**: pasá el input por `normalizarCelularAR(input)` → devuelve el canónico o `null`.
3. **Guardar**: llamá a `crear_turno` con `p_telefono` (canónico) y `p_telefono_raw` (lo que se tipeó).

Nada más. El resto de esta guía es el porqué.

---

## 3. El formato canónico

`+549` + código de área sin `0` + número sin `15`. Son **13 dígitos**, o **14 caracteres** contando el `+`.

```ts
import { normalizarCelularAR } from '@/lib/telefono';

normalizarCelularAR('+54 9 221 681-9377'); // '+5492216819377'  ← pegado de WhatsApp
normalizarCelularAR('0221 15 681-9377');   // '+5492216819377'  ← formato viejo con 15
normalizarCelularAR('2216819377');         // '+5492216819377'
normalizarCelularAR('0054 9 11 6864 3599'); // '+5491168643599' ← prefijo internacional
normalizarCelularAR('1568643599');         // null  ← 15 sin código de área
normalizarCelularAR('+1 415 555 2671');    // null  ← otro país
```

### API del módulo

`src/lib/telefono.ts` — TypeScript puro, sin dependencias de React Native, así que **porta a Next.js tal cual**.

| Export | Firma | Para qué |
|---|---|---|
| `normalizarCelularAR` | `(input: string) => string \| null` | Convierte cualquier input al canónico. `null` = inválido. |
| `areaPermitida` | `(tel: string, permitidas: string[]) => boolean` | Regla comercial. **Solo para el formulario público.** |
| `formatearTelefono` | `(tel: string) => string` | Presentación: `+5492216819377` → `+54 9 2216819377`. |

**Cobertura de códigos de área**: acepta `11` (AMBA) y cualquier área de 2 a 4 dígitos que empiece con `2` o `3`. Eso incluye Mar del Plata (`223`), La Plata (`221`), Bahía Blanca (`291`), Santa Fe, Rosario (`341`), Córdoba (`351`), Tucumán (`381`), y las áreas de 4 dígitos.

---

## 4. Qué cambió en la base de datos (Fase 9)

| Objeto | Antes | Ahora |
|---|---|---|
| `Cliente.telefono` | `numeric`, era la fuente de verdad | **Deprecado.** Sigue existiendo pero la RPC ya no lo escribe. Se elimina en una migración aparte. |
| `Cliente.telefono_normalizado` | — | `text`, canónico `+549…`. **Esta es la fuente de verdad.** |
| `Cliente.telefono_raw` | — | `text`, lo que se tipeó o pegó. Para auditoría. `NULL` en las 9 filas viejas (no es recuperable). |
| CHECK `cliente_telefono_formato_chk` | — | Obliga a `^\+549(11\d{8}\|[23]\d{9})$`. Es la red de seguridad real. |
| Índice `cliente_barberia_tel_idx` | — | `(barberia_id, telefono_normalizado)`, **no único**. Para búsqueda futura. |
| `Barberia.codigos_area_permitidos` | — | `text[]`, default `{11}`. |
| RPC `crear_turno` | `p_telefono numeric` | `p_telefono text` + `p_telefono_raw text` |

**Datos migrados**: los 9 teléfonos existentes se backfillearon a `+549…` sin ninguna pérdida (ya venían en formato internacional sin el `+`).

### La firma nueva de `crear_turno`

```
crear_turno(
  p_servicio_id bigint,
  p_inicio      timestamp without time zone,
  p_origen      text,
  p_nombre      text,
  p_apellido    text,
  p_telefono    text DEFAULT NULL,   -- canónico
  p_telefono_raw text DEFAULT NULL   -- lo tipeado
)
```

---

## 5. Los errores caros

Estos son los que ya nos costaron tiempo. Si vas a tocar teléfonos, chequealos antes.

| Error | Qué pasa |
|---|---|
| Leer `Cliente.telefono` | Devuelve `NULL` para **todo cliente nuevo** desde la Fase 9. El detalle del turno muestra "Sin teléfono" y el botón de WhatsApp queda muerto. |
| Mandar el teléfono **sin el `+`** | El CHECK lo rechaza (`23514`) y **la reserva falla**. |
| Ponerle **máscara** al input | Rompe el pegado. Una máscara tipo `11 6864-3599` mutila `+54 9 221 681-9377` **antes** de que la normalización lo vea. El input tiene que aceptar texto crudo. |
| Normalizar en `onChange` | Mismo problema que la máscara: pelea con el pegado. Normalizá en `onBlur` o al enviar. |
| `inputMode="numeric"` o `keyboardType="number-pad"` | El teclado no tiene `+`. Usá **`inputMode="tel"`**. |
| `autoComplete="tel"` | El navegador autocompleta el teléfono **del usuario** (el barbero), no el del cliente. No lo uses. |
| `CREATE OR REPLACE` en `crear_turno` | No puede cambiar el tipo de un parámetro. Deja un *overload* y PostgREST devuelve `PGRST203`. Hay que **DROPear la firma vieja explícitamente**. |

---

## 6. Decisiones tomadas (y lo que quedó afuera a propósito)

| Decisión | Consecuencia que tenés que conocer |
|---|---|
| **Sin unicidad** por teléfono | Cada reserva crea un cliente nuevo. No hay dedupe automático. El índice es normal, no único. |
| **`areaPermitida` solo en el formulario público** | El barbero carga cualquier zona, sin restricción. Hoy la función **no tiene ningún llamador**: `codigos_area_permitidos` es dato inerte. |
| **Se asume celular** | La numeración argentina no permite distinguir fija de móvil por los dígitos (ENACOM, Res. 1369/2023): el `15`/`9` es la única señal. Un fijo de 10 dígitos se guarda como `+549…` y su link de WhatsApp no funciona. Es aceptado: todo el negocio es por WhatsApp. |
| **`{11}` como default de áreas** | Cuando exista el formulario público, **bloqueará Mar del Plata** y todo lo que no sea AMBA. Se cambia por SQL: la app no puede escribir `Barberia`. |
| **No hay "permitir todo"** | `permitidas.some(...)` sobre un array **vacío** devuelve `false`. `codigos_area_permitidos = '{}'` rechaza a **todos**. Si querés "abierto", hay que usar un sentinel (hoy no existe). |

---

## 7. Checklist para el frontend

- [ ] Leo `telefono_normalizado`, nunca `telefono`.
- [ ] Todo input de teléfono pasa por `normalizarCelularAR` y maneja el `null`.
- [ ] El input acepta pegado crudo: sin máscara, sin `maxLength`, sin formateo en `onChange`.
- [ ] El input usa `inputMode="tel"` y **no** `autoComplete="tel"`.
- [ ] Muestro `formatearTelefono(...)` solo como confirmación visual.
- [ ] No llamo a `areaPermitida` fuera del formulario público.
- [ ] Si toco `crear_turno`, respeto los 7 parámetros y el orden del `DROP` + `CREATE`.

---

## 8. Pendientes

| Pendiente | Nota |
|---|---|
| Eliminar `Cliente.telefono` (numeric) | Migración aparte, cuando el código nuevo esté estable. |
| Formulario público de reserva | Ahí sí aplica `areaPermitida`, y la validación de zona debería vivir en el servidor. |
| Unicidad / dedupe de `Cliente` | Sigue abierto (pregunta 5 de `plan_web_publica.md`). |
| Verificación de teléfono por SMS | Ojo: el canónico para **SMS** es `+54` **sin** el `9`. WhatsApp usa el `9`, SMS no. No es el mismo valor. |

---

## 9. Nota de despliegue

**La base y el código tienen que moverse juntos.** Esta no es una recomendación teórica: el 2026-09-21 se aplicó la migración de Fase 9 antes de deployar el código y el sitio quedó con **la reserva rota durante aproximadamente una hora**. La app vieja mandaba `549…` sin el `+` y el CHECK lo rechazaba.

Regla general: **si cambiás la firma de una RPC, coordiná el deploy**. Migración y frontend no se pueden separar. Un preview deploy de una rama sin mergear tampoco alcanza: producción sale de `main`.

---

## 10. Referencias

- `src/lib/telefono.ts` — la normalización y el formateo.
- `supabase/migrations/phase9_cliente_telefono_canonico.sql` (+ su rollback).
- `docs/resumen-bd-rls.md` — estructura de la base y RLS.
- `plan_web_publica.md` — el formulario público, donde entra la regla de áreas.
- `AGENTS.md` — convenciones del proyecto.
