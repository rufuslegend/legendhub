# Stacked Shared Column Picker Design

## Goal

Refine the shared visible-columns picker by arranging its nine stat categories
into five responsive visual columns. Related category cards stack vertically
within a column, reducing width without returning to one long scrollable list.
The change applies everywhere the shared picker appears, currently the builder
and item-search pages.

## Current State

The shared picker renders each category as an independent card in a responsive
CSS Grid. The live categories arrive in this server-provided order:

1. Basic
2. Main
3. Limits
4. Regen
5. Melee
6. Mage
7. Tank
8. Ranged
9. Weapon

Every card currently occupies its own grid track. Existing selection, reset,
cookie, icon, keyboard, and theme behavior is implemented independently of the
layout and must remain unchanged.

## Approved Layout

Render five outer stack columns in this exact order:

| Column | Category cards, top to bottom |
| --- | --- |
| 1 | Basic |
| 2 | Main, Limits |
| 3 | Regen, Melee |
| 4 | Tank, Mage, Ranged |
| 5 | Weapon |

The displayed category label remains `Weapon`; this change does not rename the
underlying category to `Weapons`.

Each outer stack is one responsive grid item. Its category cards use a vertical
layout with the existing one-rem gap. When the modal narrows, entire stacks
wrap into later rows; cards belonging to one approved stack do not separate
into different outer columns.

The outer grid retains equal-width `minmax(12rem, 1fr)` tracks and the existing
`modal-xl` dialog. It therefore shows all five stacks in one row when space
permits, fewer stacks per row at intermediate widths, and one stack per row on
narrow screens without horizontal page scrolling.

## Grouping and Fallback Behavior

Grouping is a presentation concern local to
`www/src/views/shared/columnsModal.ejs`. The template builds an exact
name-to-category lookup from `vm.itemStatCategories`, then renders the approved
stack definition above.

- If an approved category is absent, omit its card without rendering an empty
  placeholder.
- Preserve every category object's existing `getItemStatInfo` order.
- After the five approved stacks, render every unrecognized future category in
  its own stack, preserving its relative server-provided order. No category may
  disappear because its name is not in the approved layout.
- Render each recognized category exactly once even if the source order changes.

The approved visual order intentionally places Tank before Mage even though the
current server order places Mage before Tank.

## Components and Styling

The existing category card remains responsible for its heading and stat-choice
buttons. Add one lightweight stack wrapper around one or more cards. The outer
`.columns-picker-grid` remains responsible for responsive horizontal layout;
the new stack class is responsible only for vertical card spacing.

Retain all current category and option styling:

- one-rem category heading size;
- `0.875rem` option labels;
- `0.5rem 0.75rem` option padding;
- bordered category cards;
- native `button type="button"` controls;
- success/check and danger/cross icons; and
- Glass Blue normal, hover, focus, and active surfaces.

Scope new styles to the Columns modal. Do not change the Filters modal or any
unrelated grid/list-group styling.

## Behavior and Data Flow

This remains a presentation-only change. Each choice continues to call
`toggleColumn(short)` and derive its icon from
`showColumn(short, selectedByDefault)`. Reset behavior, saved-column cookies,
default columns, sorting, filters, AngularJS controllers, GraphQL queries, and
database metadata remain unchanged.

There is no new runtime error state. Missing known categories and unknown future
categories are handled by the deterministic template fallback rules above.

## Files and Generated Assets

- Update `www/src/views/shared/columnsModal.ejs` to construct and render the
  five approved stacks plus fallback stacks.
- Update `css/scss/custom/_custom.scss` with Columns-modal-scoped vertical stack
  layout and spacing.
- Extend `www/test/columns-modal.test.js` with rendered-output coverage for
  exact stack order, membership, missing categories, fallback categories,
  native controls, and compiled theme styling.
- Rebuild all generated theme CSS and copied public assets through the existing
  CSS build command.
- Record the user-visible refinement under the existing `2.6.1-beta` section in
  root `CHANGELOG.md` without changing the release version.

## Verification

- Render the real shared EJS template with representative category fixtures and
  prove the five exact stack memberships and order.
- Prove an absent approved category produces no empty card or stack artifact.
- Prove unknown categories remain visible afterward in server order, each in an
  independent stack.
- Retain coverage for AngularJS bindings and native button controls.
- Verify generated CSS for every theme contains the responsive outer grid and
  vertical stack rules, and that public minified assets match their dist copies.
- Run focused picker and Glass Blue tests, CSS lint/build, the complete web test
  suite, and `git diff --check`.
- When a configured local or test instance is available, inspect builder and
  item-search pickers at wide and narrow viewport sizes.

## Out of Scope

- Renaming, adding, deleting, or modifying database categories.
- Reordering choices within a category.
- Changing selected defaults, persistence, reset behavior, filters, or
  controllers.
- Redesigning the Filters modal.
- Changing the application version or release tags.
- Publishing, deploying, tagging, or pushing without separate authorization
  for those actions.
