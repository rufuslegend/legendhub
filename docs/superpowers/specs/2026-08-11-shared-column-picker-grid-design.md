# Shared Column Picker Grid Design

## Goal

Make the shared visible-columns picker denser and easier to scan by using a
smaller type scale and presenting its stat sets, such as Basic and Tank, as
adjacent columns. Apply the result everywhere the shared picker appears,
currently the builder and item-search pages.

## Current State

`www/src/views/shared/columnsModal.ejs` renders every stat category inside one
vertical Bootstrap list group. The modal uses Bootstrap's default dialog width,
so users must scroll through one long control even on screens wide enough to
show several categories at once. The builder and item search both include this
template and use their existing AngularJS controller methods to read and toggle
column visibility.

## Layout

- Use the existing `modal-xl` dialog size so the picker can take advantage of
  wider viewports without introducing a custom dialog width.
- Replace the outer vertical list-group layout with a picker-specific CSS Grid.
- Give the grid responsive, equal-width `minmax(12rem, 1fr)` tracks.
  It should fit as many complete category columns in a row as the available
  width permits and wrap whole categories into later rows when necessary.
- Keep every category's heading and choices together in one bordered card.
  Do not split a category across grid columns.
- On narrow screens, the same grid naturally reduces to fewer columns and then
  one column. The modal must not require horizontal page scrolling.

## Density and Appearance

- Use an `h6` category heading at `1rem` instead of the current `h4` presentation.
- Render choice labels at `0.875rem`, with `0.5rem 0.75rem` padding instead of
  the current list-group defaults.
- Retain the current check and cross icons, success and danger colors, hover and
  focus states, and theme-specific surfaces.
- Scope new selectors to the Columns modal so the visually similar Filters modal
  and unrelated list groups do not change.
- Preserve the Glass Blue rules that target Columns-modal choices. The new
  structure must continue using the existing list-group choice classes those
  rules depend upon.

## Behavior and Data Flow

This is a presentation-only change. The template continues to iterate over
`vm.itemStatCategories` and each category's `getItemStatInfo` in their existing
server-provided order. Each choice continues to call `toggleColumn(short)` and
derive its icon from `showColumn(short, defaultValue)`. Reset behavior, cookies,
selected columns, sorting, and builder/item-search controller logic remain
unchanged.

There is no new runtime error state. If a category has no choices, it may render
as an empty category card, matching the current server-driven behavior.

## Files and Generated Assets

- Update `www/src/views/shared/columnsModal.ejs` for the wider dialog and grid
  markup.
- Add shared Columns-modal layout and density styles under
  `css/scss/custom/_custom.scss`.
- Rebuild the generated theme CSS and public minified assets through the
  repository's CSS build command rather than editing generated files manually.
- Add focused regression coverage for the shared template and styling.
- Record the user-visible picker improvement under version `2.6.1-beta` in
  root `CHANGELOG.md`.

## Verification

- Prove the shared template uses the extra-wide dialog, a picker-specific grid,
  category cards, and compact label markup while retaining the existing Angular
  click and visibility bindings.
- Prove the SCSS defines responsive auto-wrapping grid tracks and smaller choice
  typography without changing the Filters modal.
- Run the focused template/style tests, CSS lint and build, and the relevant web
  test suite.
- Run `git diff --check` and review the rendered picker at representative wide
  and narrow viewport sizes when a local application instance is available.

## Out of Scope

- Changing which columns are selected by default.
- Changing column persistence, reset behavior, or AngularJS controllers.
- Reordering categories or choices.
- Redesigning the Filters modal.
- Publishing, deploying, tagging, or pushing any image or Git ref.
