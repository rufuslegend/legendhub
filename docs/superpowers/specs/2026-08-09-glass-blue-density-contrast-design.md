# Glass Blue Density and Columns Contrast Design

## Goal

Refine the approved Glass Blue theme after visual review without changing the
other themes or shared application markup.

## Changes

- Reduce card-header titles such as **Character** and **Stats** from Bootstrap's
  `1.5rem` `h4` scale to `1.25rem` in Glass Blue only. Other headings retain
  their existing hierarchy.
- Reduce the builder's top-panel horizontal gutter and bottom spacing by about
  half, from roughly 24–30 pixels to 12–15 pixels. Keep the outer page padding
  and responsive stacking behavior intact.
- Make headings inside contextual list-group action buttons inherit the
  button's computed text color. Scope the Columns modal's `.list-group-item-light`
  rows to a dark Glass well with light text, blue hover/focus treatment, and a
  distinct pressed state. Preserve contextual list groups outside that modal.

## Implementation Boundary

The changes belong in the Glass Blue post-Bootstrap chrome partial and its
theme regression test. Rebuild and copy the existing generated Glass Blue CSS
and source maps. Do not edit builder or Columns modal templates, change Light,
Dark, or Solarized Dark, or alter application behavior.

## Verification

- Add compiled contract assertions for the smaller card-header title, reduced
  builder spacing, inherited contextual-list heading color, and dark Columns
  modal row states.
- Run the focused Glass Blue tests, CSS lint/build, and full web suite.
- Confirm generated dist/public CSS and source maps remain byte-identical.
- Perform a local desktop visual check if available without MCP browser
  automation; otherwise rely on the user's visual review after rebuild.
