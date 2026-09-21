# public-theme-switch Specification

## Purpose

Light/dark switch as a `:root` CSS-token swap plus heading-font swap.

## Requirements

### Requirement: Theme switch

Toggling MUST swap the `:root` tokens between the light values of `conexion-barber-blanco.html` and the dark values of `conexion-barber-flujo-completo (2).html` (e.g., `--paper:#FFFFFF` vs `#1C1C1D`), and swap the heading font between Playfair Display (light) and Oswald (dark), matching each prototype. Both themes MUST define identical token names.

#### Scenario: Toggle swaps theme

- GIVEN the page in light (or dark) theme
- WHEN the visitor activates the switch
- THEN tokens and heading font swap to the other prototype's values (Playfair Display ↔ Oswald)
