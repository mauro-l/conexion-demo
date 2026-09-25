# Delta for public-theme-switch

## MODIFIED Requirements

### Requirement: Theme switch
Toggling MUST swap the `:root` tokens between the light values of `conexion-barber-blanco.html` and the dark values of `conexion-barber-flujo-completo (2).html` (e.g., `--paper:#FFFFFF` vs `#1C1C1D`), and swap the heading font between Playfair Display (light) and Oswald (dark), matching each prototype. Both themes MUST define identical token names, including first-class `--fill-strong`; the light value MUST be the light prototype's strong ink and the dark value MUST be `#0E0E0F`. The professional avatar MUST use `var(--fill-strong)`.
(Previously: Both themes had to define identical token names, but `--fill-strong` was not required and the avatar token source was unspecified.)

#### Scenario: Toggle swaps theme
- GIVEN the page in light (or dark) theme
- WHEN the visitor activates the switch
- THEN tokens and heading font swap to the other prototype's values (Playfair Display ↔ Oswald)

#### Scenario: Strong-fill token exists in both themes
- GIVEN either theme is active
- WHEN the stylesheet and professional avatar are inspected
- THEN `--fill-strong` is defined for that theme and the avatar background resolves from `var(--fill-strong)`

## ADDED Requirements

### Requirement: Theme-specific fidelity tokens and brand mark
The dark theme MUST use the prototype's dark brand-mark and ticket shadows, while the light theme MUST use its light shadow values. Logo letter-spacing MUST be `0.04em`; service heading spacing MUST be `0.03em` in dark and `0.06em` in light; hero headings and ticket names MUST have no forced tracking. A shared heading-spacing rule MUST NOT override those per-element values. The logo MUST split the database shop name on whitespace and render only its last word in `var(--brass)`; a single-word name MUST remain plain.

#### Scenario: Shadow and typography isolation
- GIVEN the visitor toggles between light and dark themes
- WHEN computed styles are inspected for the brand mark, ticket, logo, service heading, hero heading, and ticket name
- THEN each element uses its theme-specific prototype value and no value leaks across themes

#### Scenario: Database logo split
- GIVEN the database shop name is `Conexión Barbería`
- WHEN the public header renders
- THEN `Conexión` remains plain and only `Barbería` uses `var(--brass)`

### Requirement: Accessible service disclosure
The `Qué incluye` control MUST be a button with `aria-expanded` and an associated detail region; activating it MUST toggle the region and rotate its chevron 180 degrees when expanded.

#### Scenario: Expand and collapse service detail
- GIVEN a collapsed service detail
- WHEN the visitor activates `Qué incluye` twice
- THEN the first activation exposes the detail and sets `aria-expanded="true"`, and the second hides it and restores `false`
