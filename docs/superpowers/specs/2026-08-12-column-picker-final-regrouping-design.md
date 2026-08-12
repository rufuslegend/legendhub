# Column Picker Final Regrouping Design

## Goal

Rearrange the shared column picker's known stat sets into four specific visual
columns while preserving the recently deployed styling, behavior, and
responsive layout.

## Approved arrangement

The shared picker will render the known stat sets in this column and vertical
order:

1. `Basic`
2. `Main`, `Limits`, `Ranged`
3. `Regen`, `Tank`, `Melee`
4. `Mage`, `Weapon`

The set names retain their existing source capitalization, including `Regen`.

## Implementation boundary

Update the existing `knownStackNames` configuration in
`www/src/views/shared/columnsModal.ejs`. The current stack renderer remains the
single source of truth for the Builder and Items pages because both consume the
shared partial.

No CSS or theme artifact changes are required. The existing responsive grid,
smaller option font, larger headings, raised category surfaces, instruction
copy, and compact reset action remain unchanged.

## Missing and unknown sets

If a known set is unavailable on a page, omit it without rendering an empty
card or column. Preserve the existing fallback for future unknown sets: append
each unknown set as its own independent column after all remaining configured
stacks, in source order. When every known set is present, unknown sets therefore
begin at column 5.

## Behavior and accessibility

Do not change selection bindings, reset behavior, native button semantics, DOM
order within each column, or theme-aware text contrast. The DOM order must
match the requested visual reading order.

## Testing and release record

Update the shared modal regression tests to assert the exact four-column order,
known-set omission behavior, and unknown-set fallback. Run the focused modal
test, the complete web suite, and CSS lint. Refine the existing `2.6.1-beta`
changelog entry to describe the final grouping.

Merging, pushing, image publication, and Dunwich deployment remain separate
actions requiring explicit authorization for this pass.
