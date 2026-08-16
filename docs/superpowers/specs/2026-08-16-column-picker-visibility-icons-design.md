# Shared Column Picker Visibility Icons Design

## Goal

Replace the check and X state indicators in the shared `Select visible columns`
picker with the maintainer-provided eye icons. A visible column uses the open-eye
icon in the existing success color, and a hidden column uses the closed-eye icon
in the existing danger color. Because every Columns picker renders the same EJS
template, the change applies everywhere the shared picker is used.

## Icon Source and Rendering

Use the exact SVG geometry supplied in `~/Downloads/eye.svg` and
`~/Downloads/eye-closed.svg`. Both icons have a `24 24` view box and draw with
`currentColor`, so their paths can be inlined in the shared template and inherit
the existing Bootstrap state colors without editing the artwork.

Render the icons as conditional inline SVG elements:

- `showColumn(...)` true: open eye with `text-success`.
- `showColumn(...)` false: closed eye with `text-danger`.

Each icon remains approximately the same size as the existing Font Awesome
indicator by using a dedicated class with `1em` width and height. Preserve the
current trailing position, spacing, and non-growing flex behavior. Remove the
picker indicator's `fas`, `fa-check`, and `fa-times` classes; other Font Awesome
icons elsewhere are out of scope.

Inlining is preferred over public image files, CSS masks, or a new SVG sprite.
It preserves `currentColor` directly, avoids additional requests and sprite
plumbing, and keeps the two picker-only shapes beside their Angular visibility
bindings.

## Behavior and Accessibility

This is a visual-state change only. Preserve the native option buttons,
`toggleColumn(...)` click binding, `showColumn(...)` state binding, selected
defaults, category grouping, reset behavior, persistence, and responsive layout.

The stat label already supplies the option's accessible name, so both SVGs are
decorative. Add `aria-hidden="true"` and `focusable="false"` to prevent redundant
screen-reader or keyboard exposure. The success and danger colors remain a
secondary cue; the distinct open and closed eye shapes also communicate state.

## Files and Testing

- Update `www/test/columns-modal.test.js` first with a focused regression test
  that requires the open and closed eye SVGs, their Angular conditions, their
  success/danger colors, their decorative attributes, the shared sizing class,
  and the absence of picker-local check/X icon classes.
- Run that test and confirm it fails because the old Font Awesome indicator is
  still rendered.
- Update `www/src/views/shared/columnsModal.ejs` with the supplied inline SVG
  paths and existing selection expressions.
- Add the minimal shared icon sizing rule to `css/scss/custom/_custom.scss` and
  rebuild all generated theme CSS/public copies through the existing CSS build
  command.
- Extend the focused CSS assertion to require `1em` width and height, then run
  the focused picker test, CSS lint/build, the complete web suite, and
  `git diff --check`.

## Branch and Release Scope

Implement on `feat/column-picker-visibility-icons`, created from current
`master` (`2.8.0-beta`) in an isolated worktree. The maintainer's dirty WebStorm
checkout and downloaded source SVGs remain untouched. Local implementation
commits are within the requested change; pushing, merging, publishing images,
and deployment require their own explicit authorization. This change does not
create or move a release tag.

## Out of Scope

- Changing picker copy, dimensions, category arrangement, fonts, or surfaces.
- Changing any check/X icon outside the shared Columns picker.
- Changing the Filters modal or builder result-grid state icons.
- Changing application version, release tags, images, or deployed services.
