# Builder Damage Cap Design

**Date:** 2026-08-07
**Status:** Approved for implementation planning

## Context

LegendHUB already stores the editable `meleedamcap` item stat. Its
`ItemStatInfo` metadata places the field in the Melee category under the
`MeDamCap` heading and leaves the column hidden by default. The item editor,
GraphQL item shape, builder item queries, column chooser, and generic stat
aggregation therefore already carry item damage-cap values.

The missing behavior is the builder total. Because `meleedamcap` has no
natural calculation, the builder currently displays only the selected item
values. Legend does not maintain `APPLY_DAMCAP` in a `mod_damcap` character
field. `get_damcap_mod()` sums worn object and active affect modifiers when
queried, and `get_damcap()` combines that dynamic value with the configured
base, current-strength contribution, and wielded two-handed weapon bonus.

## Goals

- Make the builder's `MeDamCap` total match Legend's normal equipment-profile
  damage-cap calculation.
- Use the current configured base damage cap of 102.
- Add editable damage-cap modifiers from equipment, Familiar, and Other slots
  through the existing generic item aggregation path.
- Derive the strength contribution from capped current strength.
- Add the configured 64-point bonus when the Wield slot contains a two-handed
  item.
- Keep the column in the Melee category and hidden by default under
  “Hide/Show Columns.”
- Add focused service and builder regression coverage plus a public changelog
  entry.

## Non-goals

- No item-schema, migration, GraphQL, item-editor, or column-metadata changes.
- No changes to the Legend source repository or `sysconfig.lst`.
- No user-editable builder base damage-cap field.
- No Evasion override, Deadly Precision perception bonus, or other temporary
  combat-state modeling.
- No damage-cap restriction, maximum, or warning UI.
- No builder-list storage-version or import/export changes.
- No changes to any other melee or character stat formula.
- No push, image publication, deployment, tag, or release promotion.

## Source Calculation

The relevant Legend configuration is:

```text
DAMCAP = 102
DAMCAP_TWOHANDED_BONUS = 64
```

For the normal, non-Evasion, non-Deadly-Precision equipment profile,
`get_damcap()` calculates:

```text
damage cap = DAMCAP
           + worn object APPLY_DAMCAP modifiers
           + active affect APPLY_DAMCAP modifiers
           + strength contribution
           + two-handed wield bonus
```

The strength contribution uses C integer division:

```text
if strength > 50:
    contribution += trunc((strength - 50) / 2)

if strength > 100:
    contribution += trunc((strength - 99) / 2)
```

Only the item in Legend's `WEAR_WIELD` slot receives the two-handed bonus. In
LegendHUB that is represented by `slot == 14` with `twoHanded` enabled. A
two-handed value on any other slot must not add the bonus.

## Builder Data Flow

1. `gameStats` declares capped current strength as the natural dependency for
   `meleedamcap`.
2. The builder resolves that dependency through its existing stat-total path,
   preserving the raw over-cap warning while passing the effective capped
   strength into the damage-cap calculation.
3. `gameStats` returns the 102 configured base, the exact Legend strength
   contribution, and 64 when the selected Wield item is two-handed.
4. The builder's generic total path independently adds `meleedamcap` from its
   equipment, Familiar, and Other entries. This mirrors Legend's on-demand sum
   of worn-object and affect modifiers without introducing `mod_damcap` state.

The result remains a numeric total. Unlike damroll, hitroll, or regeneration,
damage cap has no equipment limit and does not need a parenthesized capped-item
subtotal or a restriction tooltip.

## Boundary Behavior

With no selected damage-cap items and no two-handed wielded item:

| Capped current strength | Strength contribution | Damage cap |
| ---: | ---: | ---: |
| 50 | 0 | 102 |
| 51 | 0 | 102 |
| 52 | 1 | 103 |
| 99 | 24 | 126 |
| 100 | 25 | 127 |
| 101 | 26 | 128 |
| 104 | 29 | 131 |

A two-handed Wield item adds 64 after the same calculation. For example,
capped strength 100, 12 damage cap from equipped items, 8 from an Other entry,
and a two-handed Wield item produce:

```text
102 + 25 + 12 + 8 + 64 = 211
```

Negative item modifiers remain additive because Legend sums
`APPLY_DAMCAP` modifiers without clamping the result in `get_damcap()`.

## Testing

Focused `gameStats` tests will verify:

- `meleedamcap` declares strength as its sole natural dependency;
- base damage cap is 102 at and below the first effective strength threshold;
- both strength-contribution branches match C integer division around 50 and
  100 strength;
- a two-handed item in Wield adds exactly 64;
- a two-handed item outside Wield adds nothing; and
- missing stats and items are handled safely.

Focused builder integration tests will verify:

- damage-cap values from equipment and Other entries add to the derived base;
- capped current strength, rather than the raw over-cap value, drives the
  strength contribution;
- the existing raw strength restriction remains intact; and
- the final total includes the two-handed Wield bonus exactly once.

The focused game-stat and builder tests, changelog test, complete web test
suite, and `git diff --check` will run before completion.

## Release Record

The root `CHANGELOG.md` will add this `2.6.0-beta` Fixed entry:

```markdown
- Added the builder's melee damage-cap total using Legend's configured base, capped-strength contribution, item modifiers, and two-handed wield bonus.
```

The version remains `2.6.0-beta`.
