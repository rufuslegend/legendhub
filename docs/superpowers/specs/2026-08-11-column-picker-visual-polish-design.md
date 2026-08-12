# Shared Column Picker Visual Polish Design

## Goal

Refine the shared visible-columns picker after reviewing the deployed stacked
layout. The reset action should no longer dominate the modal, category headings
should be more prominent, and each category card should read as a slightly
raised surface above the modal body in every supported theme.

The shared template means the change applies everywhere the picker appears,
currently the builder and item-search pages.

## Confirmed Causes

The deployed reset button is full width because it combines Bootstrap's
`col-12` grid class with `btn-block`. The category heading is fixed at `1rem`,
and several themes give category list-group cards the same surface as the modal
body or a transparent surface, so the sets do not separate visually from the
whole widget.

## Toolbar Layout and Copy

Replace the current two-row introduction and reset control with one compact
toolbar row inside the modal body.

- The left side reads exactly: `Select columns to show and hide from the following:`
- A compact `Reset to defaults` primary button sits on the right side.
- Remove `col-12` and `btn-block` from the reset button and use Bootstrap's
  small button size.
- Keep the existing `resetColumns()` click binding and add `type="button"` so
  the control remains an explicit non-submit action.
- The text may wrap within its left-side space at narrow widths, while the
  button retains its intrinsic compact width on the right. Both remain in the
  same flex row.
- The toolbar supplies its own bottom spacing, replacing the standalone
  `<br />` before the category grid.

## Category Heading Scale

Increase `.columns-picker-category-title` from `1rem` to `1.2rem`, exactly 20
percent. Preserve the current heading family, weight, color, and bottom margin.
Do not increase stat-option labels, which remain `0.875rem`.

## Raised Category Surfaces

Use theme-native colors rather than one translucent overlay. Add two
picker-specific Sass variables with Light-theme defaults, then override them in
the Dark, Solarized Dark, and Glass Blue theme variable files before the shared
custom partial is compiled:

| Theme | Modal body surface | Category-card surface |
| --- | --- | --- |
| Light | Bootstrap light gray (`$gray-100`) | White (`$white`) |
| Dark | Existing body background (`$body-bg`) | Dark gray (`$gray-800`) |
| Solarized Dark | Existing modal background (`$gray-800`) | Raised Solarized gray (`$gray-700`) |
| Glass Blue | Existing glass surface (`$glass-surface`) | Raised navy (`$gray-800`) |

Scope both backgrounds to the Columns modal. The modal-body background creates
the widget base, and `.columns-picker-category` receives the brighter raised
surface. Preserve existing category borders and Glass Blue glow vocabulary.

The stat-option buttons retain their current normal, hover, focus, active,
success/check, and danger/cross styling. Only the containing category surface
changes.

## Behavior and Accessibility

This is a presentation and copy change only. It does not alter category
grouping, option ordering, responsive stack wrapping, selected defaults,
cookies, reset behavior, filters, controllers, GraphQL queries, or database
metadata.

The reset control remains a native button with a visible label and keyboard
focus behavior. The larger headings retain semantic `h6` markup. Theme-specific
surfaces must preserve existing text and border contrast.

## Files and Generated Assets

- Update `www/src/views/shared/columnsModal.ejs` for the single-row toolbar,
  exact copy, compact reset button, and removal of the standalone break.
- Update `css/scss/custom/_custom.scss` for picker surface defaults, toolbar
  layout constraints, `1.2rem` headings, and scoped backgrounds.
- Update the Dark, Solarized Dark, and Glass Blue theme variable files with
  their picker-specific surface overrides.
- Extend `www/test/columns-modal.test.js` to cover exact toolbar copy and
  classes, reset binding/type, heading size, and compiled per-theme surfaces.
- Rebuild all generated theme CSS and public minified copies through the
  existing CSS build command.
- Refine the existing shared-picker entry under `2.6.1-beta` in root
  `CHANGELOG.md` without changing the application version.

## Verification

- Render the real shared EJS template and prove the toolbar text, compact
  right-side reset control, native button type, and reset binding.
- Confirm the approved five category stacks and all existing selection
  bindings remain unchanged.
- Verify every compiled theme contains a `1.2rem` heading and the intended
  Columns-modal body/card surface pair.
- Verify public minified assets remain byte-identical to their distribution
  copies.
- Run the focused picker and Glass Blue tests, CSS lint/build, the complete web
  test suite, and `git diff --check`.
- Inspect the builder and item-search pickers at wide and narrow viewport sizes
  when browser control or a configured deployment is available.

## Release and Deployment Scope

Implementation will occur on a feature branch from `master`. Publishing,
pushing, merging, and redeploying remain separate actions. The currently
deployed Dunwich release is `74c7e3562f7a`; its immediate verified rollback
candidate is `3d17acef3e4d`. Do not create or move a release tag.

## Out of Scope

- Changing the five approved category stacks.
- Changing stat-option font size, padding, order, or interaction states.
- Changing the Filters modal's full-width reset control.
- Renaming `Weapon`, changing selected defaults, or modifying persistence.
- Changing the application version or release tags.
