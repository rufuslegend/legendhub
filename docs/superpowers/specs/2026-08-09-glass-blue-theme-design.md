# LegendHUB Glass Blue Theme Design

## Context

LegendHUB currently offers Light, Dark, and Solarized Dark Bootstrap themes.
Visitors without a saved theme preference receive Dark. The site needs a
fourth theme that borrows the material language of the LegendMUD WebClient's
blue Glass theme while retaining LegendHUB's existing layouts and behavior.

The visual reference is the Glass Blue theme in the read-only sibling project
`/Users/toddmckimmey/projects/lmproxy`. LegendHUB will reproduce its crisp
game-client chrome rather than copy its application layout: near-black wells,
steel-blue edges, restrained blue glow, rounded corners, glossy title strips,
and heavier serif display type.

## Goals

- Add Glass Blue as a fourth independently compiled theme.
- Make Glass Blue the default for visitors without a saved theme preference.
- Preserve existing Light, Dark, and Solarized Dark preferences unchanged.
- Apply the Glass Blue material treatment consistently across shared interface
  chrome, including cards, navigation, forms, buttons, tables, menus, and
  overlays.
- Keep current page structure, spacing, responsive behavior, routes, data, and
  application behavior unchanged.
- Retain clear semantic meaning for success, warning, danger, and informational
  states.

## Non-goals

- Reproduce the WebClient's pane layout, icon rail, gauges, map, or terminal.
- Replace or recolor any of the three existing themes.
- Add runtime hue variants or user-adjustable Glass colors.
- Redesign page content, navigation structure, or responsive breakpoints.
- Introduce JavaScript animation or a new front-end framework.
- Publish, deploy, tag, or push the completed work without separate approval.

## Selected Approach

Glass Blue will be a dedicated Bootstrap build rather than an overlay on Dark.
This keeps the existing themes stable and prevents a second stylesheet from
depending on fragile cascade order.

The theme will have three layers:

1. A `bootstrap-glass-blue.scss` entrypoint that compiles the theme.
2. A theme-variable partial loaded before Bootstrap to set palette,
   typography, radii, borders, and component defaults.
3. A Glass-specific chrome partial loaded after shared LegendHUB styles to
   express visual effects Bootstrap variables cannot represent, including
   sharp-seam gradients, inset highlights, recessed wells, and outer glows.

The existing shared `_custom.scss` remains the source of layout and behavioral
styling. Glass-specific rules will target Bootstrap's reusable component
classes rather than individual routes.

## Visual System

### Palette and Depth

The theme uses a near-black blue page background and darker content wells.
Primary panel edges use a one-pixel steel-blue border close to `#3a6a99` and a
restrained outer glow approximately equivalent to
`0 0 6px rgba(70, 140, 220, 0.35)`. The default component radius is about eight
pixels.

Title chrome follows the reference's hard midpoint seam. Its initial palette
is based on this vertical progression:

- pale blue highlight near `#8fb8dd` at the top;
- medium steel blue near `#4a7dab` and `#2b5580` across the upper face;
- a sharp transition around the midpoint;
- dark navy near `#12293f` and `#0d1f30` across the lower face.

Inset white highlights along the top and dark shadows along the bottom create
raised relief. Content wells and form controls use the inverse treatment:
near-black fill, subtle inset shadow, and a steel-blue rim. Glow remains local
to edges and focus states so the result reads as polished client chrome rather
than neon.

### Typography

The navbar brand, page headings, card headers, modal titles, and major section
labels use a heavier serif stack led by Palatino or Georgia with a bold weight
and restrained letter spacing. Body copy, table contents, controls, and form
values retain a system sans-serif stack for legibility.

### Component Coverage

The Glass-specific chrome partial covers the shared interface vocabulary:

- page background, navbar, navbar toggler, and breadcrumbs;
- cards, card headers and footers, jumbotrons, and list groups;
- buttons and button groups, including hover, active, disabled, and focus
  states;
- form controls, selects, input groups, custom controls, and validation states;
- tables, table headers, row dividers, striped rows, and hover states;
- dropdowns, pagination, badges, alerts, and progress bars;
- modals, popovers, tooltips, notification surfaces, and the cookie banner;
- the mobile category drawer and its close control.

Success, warning, danger, and info components keep their established semantic
hues. Their borders, gradients, shadows, and focus treatment adopt the same
Glass material language instead of being flattened into blue.

## Theme Selection and Data Flow

The theme menu lists Glass Blue, Light, Dark, and Solarized Dark. The existing
selection code converts `Glass Blue` to the stylesheet slug `glass-blue`, swaps
the theme link immediately, and saves the same slug when cookie consent permits
preference storage.

On each server render:

1. A recognized saved theme cookie selects its existing compiled stylesheet.
2. A request without a saved preference receives
   `bootstrap-glass-blue.min.css`.
3. Selecting another theme updates the page without a reload.
4. A consented selection is reused on future requests.

Existing Light, Dark, and Solarized Dark cookies therefore continue to look
and behave exactly as before. The default change affects only visitors without
a saved preference.

The HTML theme-color metadata and installable-app colors will be aligned with
the Glass Blue navigation/background palette so browser chrome does not retain
the previous generic Bootstrap blue.

## Build Artifacts

The CSS pipeline will compile, prefix, minify, create source maps for, and copy
the new theme alongside the three existing outputs. The build configuration
must name Glass Blue explicitly wherever the current scripts enumerate theme
artifacts. Generated expanded and minified files remain consistent with the
repository's current tracked-artifact convention.

## Responsive and Accessibility Requirements

Glass Blue does not change grid breakpoints, container widths, or control
placement. The desktop and mobile layouts continue to derive from the existing
Bootstrap and shared custom rules.

Text, borders, and controls must retain readable contrast against their wells.
Keyboard focus receives a visible blue ring that is distinguishable from hover
and active states. Disabled controls remain identifiable without relying only
on hue. Static gradients and shadows introduce no motion dependency, and
existing reduced-motion behavior remains intact.

## Verification

Implementation verification will include:

- focused tests written before theme behavior changes;
- SCSS linting and a complete CSS build;
- assertions that expanded, minified, copied, and source-map artifacts exist;
- a no-cookie render that selects `bootstrap-glass-blue.min.css`;
- cookie-backed renders that still select Light, Dark, and Solarized Dark;
- theme-menu and stylesheet-switching coverage for all four choices;
- the complete web test suite;
- desktop and mobile visual checks of the homepage, builder, list/detail/edit
  pages, login, feedback, changelog, forms, tables, dropdowns, and modals;
- keyboard focus, hover, active, disabled, validation, and semantic-state
  checks;
- `git diff --check` limited to the feature's files because an unrelated
  user-owned trailing-space edit predates this branch.

## Public Changelog

The root `CHANGELOG.md` will add a user-facing entry under `2.6.1-beta`
describing Glass Blue as the new default theme for visitors without a saved
preference and confirming that existing theme choices remain available.
