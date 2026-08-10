# Glass Blue Whole-Interface Density Design

**Date:** 2026-08-09
**Status:** Approved for implementation planning

## Context

Glass Blue currently uses LegendHUB's standard Bootstrap sizing with a small
builder-specific density refinement. During visual evaluation, the interface
felt better with Chrome set to 80% zoom: more information remained visible,
cards and controls felt less oversized, and the game-client-inspired chrome
read as a cohesive working interface rather than a collection of large web
panels.

Literal browser zoom is not an appropriate application default. It shrinks
text, focus indicators, and controls indiscriminately, changes the effective
CSS viewport and responsive breakpoint behavior, and cannot be applied
reliably as a theme implementation. Glass Blue instead needs an intentional
density system that reproduces the preferred compact impression at normal
browser zoom.

## Goal

Make the complete Glass Blue interface at 100% browser zoom feel approximately
as compact as the current interface at 80% Chrome zoom, while retaining
comfortable reading text and the current mobile touch experience.

## Scope

The density treatment applies to the whole Glass Blue interface, including:

- navigation and breadcrumbs;
- page and section headings;
- containers, rows, columns, cards, jumbotrons, and list groups;
- buttons, form controls, selects, input groups, and custom controls;
- tables, pagination, badges, alerts, and progress surfaces;
- dropdowns, modals, popovers, tooltips, and notification surfaces;
- builder panels, filters, column choices, and other shared overlays; and
- shared footer and cookie-consent chrome.

Light, Dark, and Solarized Dark retain their current sizing and generated
artifacts.

## Selected Approach

Use a responsive Glass Blue density system rather than CSS `zoom`, transforms,
or isolated page-specific fixes.

At viewport widths of 768 pixels and above:

- use a `0.875` type-scale target so ordinary text renders at 87.5% of its
  current size;
- use a `0.8` space-scale target for component padding, vertical rhythm, grid
  gutters, and common gaps;
- reduce control heights in proportion to their padding without weakening
  their borders or focus indicators;
- reduce headings proportionally while preserving a clear hierarchy; and
- retain one-pixel structural borders, visible focus rings, and the existing
  Glass gradients and shadows instead of scaling those effects away.

Below 768 pixels, Glass Blue retains its current font sizes, spacing, control
dimensions, responsive stacking, and touch targets. The density breakpoint
does not change Bootstrap's existing grid breakpoints or container behavior.

The SCSS will centralize these targets as clearly named Glass density values.
Component overrides will consume those values instead of introducing unrelated
per-page numbers. A component may deviate only where the target would clip its
content or weaken an interaction state, and the exception must be covered by a
focused regression assertion. Post-Bootstrap overrides remain in the Glass
Blue chrome partial because the density changes are responsive and must not
alter the other compiled themes.

## Alternatives Considered

### Literal 80% scaling

Applying CSS `zoom`, a transform, or an equivalent global shrink would most
closely resemble browser zoom in a single desktop screenshot. It was rejected
because it creates fragile width and overflow behavior, can leave unused page
space, changes hit testing and fixed-position behavior, and makes the mobile
exception difficult to reason about.

### Spacing-only compression

Reducing gutters and padding while preserving all current type sizes would be
the safest accessibility choice. It was rejected because the resulting visual
hierarchy still feels substantially larger than the preferred 80% view and
does not make the whole interface feel like one compact skin.

### Balanced responsive density

The selected approach combines roughly 80% spatial density with a less
aggressive text reduction. It preserves the character of the preferred view
without adopting browser-zoom side effects or unnecessarily small default
copy.

## Existing Builder Overrides

The current Glass Blue chrome partial contains builder-only rules that reduce
the top-row gutter, panel bottom spacing, and card-header title size. The new
system will replace or incorporate those values so the builder is not compacted
twice. Builder-specific selectors may remain only where the builder genuinely
differs from the shared component vocabulary.

The Columns modal contrast fixes remain intact. This density work changes its
spacing and typography only through the same shared Glass rules used by other
modals and list groups.

## Responsive and Accessibility Requirements

- Desktop body copy must remain readable at normal 100% browser zoom.
- Browser zoom must continue to enlarge the interface normally; the theme must
  not counteract a user's zoom preference.
- Keyboard focus rings retain their current visible thickness and contrast.
- Borders that communicate component boundaries remain at least one rendered
  CSS pixel.
- Disabled, hover, active, validation, and semantic states retain their
  existing distinctions.
- Controls must not clip labels, icons, validation text, or dropdown arrows.
- Long headings, table values, navigation labels, and translated-size content
  must wrap or overflow no worse than they do today.
- At widths below 768 pixels, current mobile font sizing and touch dimensions
  remain unchanged.
- Reduced-motion behavior and application interaction remain unchanged.

## Implementation Boundary

The work belongs in the Glass Blue theme source, its generated distribution
and public assets, and the Glass Blue regression tests. Shared EJS templates,
AngularJS behavior, routes, data, and the other three themes are outside the
implementation scope.

No CSS `zoom`, `scale()` transform, viewport metadata change, JavaScript sizing
logic, new breakpoint, or page-specific markup change will be introduced.

This design does not authorize a push, tag, image publication, test deployment,
or production deployment. The user-owned root `docker-compose-prod.yaml` and
unrelated working-tree files remain untouched.

## Verification

Implementation verification will include:

- tests written before the density behavior changes;
- compiled-CSS assertions for the desktop density breakpoint, readable type
  scale, shared component padding, grid gutters, and unscaled mobile defaults;
- shipped-CSS assertions that `zoom` and transform-based whole-page scaling are
  absent;
- a complete CSS build and lint pass;
- byte comparisons proving Light, Dark, and Solarized Dark artifacts did not
  change;
- byte comparisons proving the Glass Blue distribution and public copies
  match;
- the focused Glass Blue test and complete web test suite;
- desktop visual review at 100% browser zoom across the home page, builder,
  catalog/list and detail pages, account and feedback forms, tables, dropdowns,
  and modals; and
- mobile visual review confirming the existing sizing, stacking, and touch
  experience remain intact.

The desktop review succeeds when the full interface has the compact impression
of the previously preferred 80% Chrome view without clipped content, weakened
interaction states, or an unexpectedly early responsive layout change.

## Public Changelog

Tighten the existing Glass Blue bullet under the current beta version rather
than adding a duplicate entry. Use this wording:

```markdown
- Added the compact Glass Blue theme as the default for visitors without a saved preference; Light, Dark, and Solarized Dark remain available.
```

The implementation will not change the application version.
