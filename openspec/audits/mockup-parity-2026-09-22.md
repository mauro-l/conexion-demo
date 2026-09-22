# Mockup parity audit — 2026-09-22

## Why this exists

The prototype HTML at the repository root is the agreed **single source of truth** for the
public UI. The change `public-availability` implemented part of that flow and was archived
as "verified" — yet it silently dropped the date selector and the time-of-day grouping.
This audit finds **every** such gap, not just the one that was noticed.

The failure was not in the code: the change's specs never contained those requirements, so
every suite (79 pgTAP assertions, 61 Vitest tests, 28 Edge checks, 12 end-to-end tests)
passed against a spec that had already lost them. **A verification pass can only see what
the spec contains.** That is the reason this audit is performed against the prototype, not
against the spec.

## Method and sources

- Prototypes: `conexion-barber-flujo-completo (2).html` (594 lines, **dark** theme) and
  `conexion-barber-blanco.html` (593 lines, **light** theme). A diff between them is ~109
  lines of fonts and colour tokens only — they are the **same application in two themes**,
  so this is one audit with a theme axis, not two audits.
- Implemented surface: `app/**`, `components/**`, `lib/**`, `types/**`.
- Scope authority: the archived proposals of `public-availability` and
  `web-publica-reservas`, plus the two planning documents.

Line numbers refer to the dark prototype unless stated. The light prototype is offset by
−1 in the CSS region (it has no `--fill-strong`) and is otherwise byte-identical in the
body and scripts.

## Verdict summary

| Bucket | Count |
|---|---|
| Faithful | 12 |
| Divergent | 10 |
| **Missing and should have been delivered** | **8** |
| Deliberately out of scope | 13 |

Two independent audits were run: one on structure and behaviour, one on visual fidelity.
They agree on the headline: the landing is largely faithful, and **the booking step is
structurally a different product**.

---

## A. Gaps in the delivered read flow (must fix)

These were in the prototype, were never excluded by any proposal, and are absent from the
app. The first five are the ones that caused the reported symptom.

| # | Element | Prototype | App | Why it matters |
|---|---|---|---|---|
| A1 | **`date-scroller` + `date-card`** | `:259`, built in `renderDates()` `:420-441` — 14 cards, each `dow`/`dnum`/`mon`, Sunday `disabled`, today selected by default | **absent**; `AvailabilityCalendar.tsx:62-82` renders a vertical day list | The core interaction of the step. This is the reported symptom ("tengo como 10 días") |
| A2 | **`Mañana / Tarde / Noche` grouping** | `:261`, `bucket()` `:442` (`h<12`, `h<18`, else), `renderTimes()` `:443-466` | **absent**; flat slot list per day | Times are the second half of the step; without grouping the list is unusable at 14 days |
| A3 | **`service-chip` meta (duration · price)** | `:249`, `dt-service-meta` set at `:408` | **absent on `/reservar`** — the data is already there (`types/booking.ts:28-29`, validated at `availability.server.ts:39-41`) but never rendered | Pure rendering omission: no data work needed |
| A4 | **Section labels "Elegí una fecha" / "Elegí un horario"** | `:258`, `:260` | **absent** | The step loses its two-step structure |
| A5 | **`cal-jump-btn` "Ir a una fecha específica"** | `:256` | **absent** | Calendar-jump affordance, never specified |
| A6 | **`modal-topbar` back / crumb / close** | `:242-246` (`dt-back`, crumb, `dt-close`) | **absent**; `/reservar` reuses the home header (`reservar/page.tsx:52`) | The step loses its navigation chrome |
| A7 | **Default selection (today pre-selected)** | `:437` (`if (i===0) … selected`) | **absent**; `selected` starts `null` | The prototype never shows an unselected state |
| A8 | **`rating-row` ★★★★★ · 5.0 · 37 reseñas** | `:226` | **absent** | See E2 — there is **no data for it anywhere**: no column, no DTO field, and no proposal excludes it. It fell through every layer |

Behavioural gaps that follow from A1/A2/A7: the prototype's date selection (click a card →
deselect the rest → re-render times → update the summary) and the step gating (`primary-btn`
enabled only once a date **and** a time are chosen) have no counterpart. The app's only
reproduced behaviour is "click a slot → show a chosen summary", and that summary's copy is
its own honest read-only dead end, not the prototype's recap.

---

## B. Visual fidelity bugs (must fix)

The palette is in good shape: **all eleven colour tokens match the prototypes exactly in
both themes**, `--radius: 16px` matches, the app loads the union of both prototype font
sets (no silent substitution), `prefers-reduced-motion` is honoured, and the cover image
correctly uses a local asset instead of `picsum.photos`.

What is wrong:

| # | Issue | Prototype | App | Impact |
|---|---|---|---|---|
| B1 | **Shadows are light-only and leak into dark** | brand-mark `rgba(0,0,0,0.35)` dark / `rgba(21,23,26,0.18)` light (`:78`); ticket `rgba(0,0,0,0.2)` dark / `rgba(21,23,26,0.04)` light (`:95`) | hardcoded light values for both themes (`globals.css:209`, `:319`) | Dark theme loses depth on the hero and the cards |
| B2 | **One letter-spacing variable for every heading** | logo `0.04em`; hero `h1` **none**; services `h2` `0.03em`; ticket name **none** | a single `--heading-letter-spacing: 0.03em` applied to all four (`globals.css:142,235,289,335`) | Dark logo is 19px instead of 18px, and the hero title and ticket names gain tracking the prototype never has |
| B3 | **Dead two-tone logo** | `.logo span { color: var(--brass) }` (`:50`), markup renders `CONEXIÓN <span>BARBER</span>` | `PublicHeader.tsx:7` renders a plain string, so the rule at `globals.css:145-147` never applies | The brand's brass accent never renders — a CSS rule that cannot fire |
| B4 | **Slot buttons are the wrong size** | `.time-slot` mono **14.5px / 600**, radius **12px** (`:144`) | `.availability-slot` mono **13px / 500**, radius **10px** (`globals.css:504-514`) | Visible at a glance in the step that matters most |
| B5 | **Professional selector is the wrong shape** | `.prof-select` **pill** (`border-radius:999px`, `padding:6px 14px 6px 6px`, 13.5px) with a 26px avatar and a chevron (`:124-127`, `:250-255`) | full-width card, radius 16px, `padding:14px 16px`, a "Profesional" label, no avatar, no chevron (`globals.css:459-469`, `reservar/page.tsx:64-67`) | Reads as a different control |
| B6 | **"Qué incluye" lost its chevron** | custom `button` + inline chevron rotating 180° on `[aria-expanded=true]` (`:98-100`) | native `<details>/<summary>` with no chevron (`ServiceCatalog.tsx:32-35`) | The affordance that says "this expands" is gone |

Also noted: the app adds styling the prototype does not have (an `eyebrow` "Reservar" on the
step, a "Profesional" label, `ThemeSwitch`'s moon/sun buttons, and the whole
`.availability-*` family). `ThemeSwitch` is plan-mandated and fine; the rest is invention.

---

## C. Confirmed out of scope (Fase 3 — not gaps)

Absent from the app **and** explicitly deferred by an archived proposal or a plan. Listed so
nobody re-litigates them as gaps:

- `view-contact`: the recap, the four form fields, the phone prefix and hint, the
  `verify-note`, and the reCAPTCHA note (`plan_next_web_completa.md:170,173,315`).
- `screen-code`: the OTP boxes, resend row and countdown (`web-publica-reservas/proposal.md:17`).
- `view-confirm`: the confirmation view and its actions (booking creation, Fase 3).
- The `sticky-bar` with `btn-primary` "Siguiente" / `btn-secondary` "Anterior" and the
  `sticky-summary`: there is no multi-step flow yet, and slot selection is terminal by design.
- The `waitlist` link (`plan_next_web_completa.md:316`, `plan_web_publica.md:473`).
- The "Iniciar sesión" link (`plan_web_publica.md:454` — there is no customer account).
- The client-side Sunday-closed rule: the RPC derives working days from the database, and
  the plan explicitly says not to assume the prototype's Sunday closure
  (`plan_next_web_completa.md:168`).
- SPA view swapping: Next.js uses real routes.

---

## D. Undocumented additions (decide: keep or drop)

| Element | App | Prototype | Note |
|---|---|---|---|
| Instagram row | `PublicInfo.tsx:41-51`, conditional | absent from both prototypes | Justified by the 7-field context DTO (`public-context-read/spec.md:34`), but it is a deviation from "the prototype is the source of truth" |
| `eyebrow` "Reservar" on `/reservar` | `reservar/page.tsx:54` | absent | Invented label |
| "Profesional" label | `reservar/page.tsx:64` | absent (the prototype shows only the pill) | Invented label |
| `not-found` page | `not-found.tsx` | absent | New route, required by the spec; acceptable |
| `ThemeSwitch` | `ThemeSwitch.tsx` | absent (each file is one hardcoded theme) | Plan-mandated addition |

---

## E. Decisions needed before the fix (product, not code)

> **Resolved 2026-09-22 by the product owner.**
>
> **E1 —** The prototype wins on **structure, labels and UI copy**; the shop's **data**
> (name, description, hours) keeps coming from the database. Consequence: "Conexión
> Barbería" stays as-is (changing it to the prototype's "Conexión Barber" is a **data**
> change, not a template change); the hero tagline keeps rendering `barberia.description`;
> the "Hoy " prefix returns because it is UI copy. The logo's brass accent returns under
> the rule "last word in `--brass`", since the name now comes from the database.
>
> **E2 —** The rating row is **excluded** until a data source exists. It is data, and there
> is no data: no column, no DTO field. It must be recorded as an explicit exclusion in the
> proposal, with that reason, so it is not mistaken for an oversight later.
>
> **E3 —** Confirmed: the step is the prototype's two-part interaction — a horizontal
> scroller of 14 date cards with one selected (today by default, non-working days disabled)
> and the times of the selected date bucketed into Mañana / Tarde / Noche.
>
> **E4 —** The time-of-day buckets are derived **client-side** in the island. The
> `<12 / <18` rule is presentation; the data contract is unchanged.
>
> **E5 —** `--fill-strong` becomes a first-class token before the professional avatar is
> added.

**E1 — Which wins when the prototype and the database disagree on copy?**
This is the root of several "divergences" and it is a genuine contradiction between two
recorded agreements:

- The instruction here: *the HTML is the single source of truth, replicate it as-is.*
- `plan_next_web_completa.md:147`: *the visual texts are a reference, not a rule.*

Concretely: the prototype says **"Conexión Barber"** everywhere (`<title>`, logo, `h1`,
crumb, confirmation) while the database and therefore the app say **"Conexión Barbería"**;
the prototype's hero tagline is fixed marketing copy while the app renders
`barberia.description`; and the prototype's hours row reads **"Hoy 10:00–20:00"** while the
app renders raw `barberia.hours` without the "Hoy " prefix. Three different outcomes,
all from the same unresolved question.

**E2 — Is the rating row in scope?**
`★★★★★ · 5.0 · 37 reseñas` exists only as hardcoded text in the prototype. There is no
rating column, no DTO field, and no proposal excludes it. It needs either a data source, or
an explicit exclusion. It cannot be "fixed" by copying the text.

**E3 — The booking step's exact shape.**
Confirm that the step must be the prototype's two-part interaction: a horizontal scroller of
14 date cards with one selected (today by default, non-working days disabled), and the times
of the selected date bucketed into Mañana / Tarde / Noche — rather than a vertical list of
every day.

**E4 — Where does the bucketing live?**
The DTO currently returns flat `days[].slots[]`. The buckets can be derived in the island,
or the Edge function / RPC can return them. Client-side derivation is simpler and keeps the
data contract unchanged; the trade-off is that the boundary rule (<12, <18) then lives in
the UI.

**E5 — `--fill-strong`.**
The dark prototype defines it (`#0E0E0F`) and uses it for the professional avatar; the app
folds the value into `--brand-mark-bg`. Promote it to a first-class token before the avatar
is added.

---

## F. Rule to prevent a repeat

1. **No change may be declared verified until its specs have been contrasted item by item
   against the prototype.** The spec is the ceiling of what verification can see; a green
   suite over an incomplete spec is a false signal, not evidence.
2. **A requirement that exists only in an exploration is not a requirement.** A1–A5 were
   described in `web-publica-reservas/exploration.md:52` and died there, because that change
   left booking out of scope and nothing carried them forward. Anything deferred must be
   re-stated as a requirement in the change that will actually deliver it.
3. **Every deviation from the prototype must be recorded with its reason**, either as an
   explicit exclusion in the proposal or as a documented decision — never left implicit
   (see the Instagram row and the invented labels in D).
