# Builder Capped Roll Stats Design

**Date:** 2026-08-07
**Status:** Approved for implementation planning

## Context

Legend characters have a base maximum of 100 for primary stats. Equipment,
abilities, and builder faux items can raise an individual stat's maximum. A
character can also equip more of a stat than that raised maximum permits.

The builder must preserve both values in that situation:

- the capped current stat used by game calculations; and
- the raw total used by the red over-cap warning and its tooltip.

Hitroll and damroll have two separate stat-dependent calculations. Their
natural bonuses use dexterity and strength respectively, and their equipment
caps rise by one for each point that the corresponding current stat exceeds
90. Both calculations must use the capped current stat, never the raw
over-cap total.

The supplied version-5 builder profile demonstrated the display behavior:

```text
5*Untitled~Original~0o0X0X0X0X0G000000300000000000_0ZG0ZG014017______________________________
```

After resolving its current item data, the profile has raw strength 114,
displayed strength 100, and a red restriction recording 114 against the 100
limit. Its natural damroll is 33, derived from capped strength 100, and its
equipment damroll cap is 40, also derived from capped strength 100.

Direct inspection and diagnostics show that the current builder already
routes capped values into both calculations. This change therefore records
the public fix and adds regression coverage so future calculator work cannot
silently substitute raw values.

## Goals

- Preserve capped primary-stat display values.
- Preserve red over-cap indicators and raw-value tooltip information.
- Prove natural damroll uses capped current strength.
- Prove the damroll equipment cap uses capped current strength.
- Prove natural hitroll uses capped current dexterity.
- Prove the hitroll equipment cap uses capped current dexterity.
- Document the corrected behavior in the public changelog.

## Non-goals

- No changes to the read-only Legend source repository.
- No changes to the builder's stat, stat-cap, item, spell, familiar, quest,
  or faux-item aggregation rules.
- No changes to natural hitroll or damroll formulas.
- No changes to hitroll or damroll equipment-cap formulas.
- No UI redesign or tooltip-copy change.
- No new raw-total field, public calculator interface, or controller
  refactor.
- No changes to hitroll/damroll ability bonuses such as Weapon Focus or
  martial arts.
- No support for levels other than the builder's existing level 50 model.
- No push, image publication, deployment, tag, or release promotion.

## Calculation Contract

For either roll stat, the builder first calculates the raw primary-stat total
from its existing sources. It separately calculates the applicable primary
stat maximum, beginning at 100 and including existing `*Cap` item or faux-item
bonuses. It then exposes:

```text
current stat = min(raw stat, applicable stat maximum)
```

If the raw stat exceeds the applicable maximum, the builder continues to
record a `fromTotalMax` restriction containing both values. The total table
uses that restriction to display its existing red indicator and tooltip.

Damroll then uses capped current strength for both dependent calculations:

```text
natural damroll = trunc((current strength - 1) / 3)
equipment damroll cap = 30 + max(current strength - 90, 0)
```

Hitroll similarly uses capped current dexterity:

```text
natural hitroll = trunc((current dexterity - 1) / 3)
equipment hitroll cap = 30 + max(current dexterity - 90, 0)
```

Equipment hitroll/damroll over the calculated cap remains represented by the
existing `fromItems` restriction. Spells, familiars, and faux Other-slot roll
bonuses remain outside the equipment cap.

## Regression Scenarios

Tests will use synthetic item values instead of mutable database item IDs.
Both strength and dexterity scenarios use:

```text
base stat = 90
equipment stat = 20
stat-cap bonus = 4
raw stat = 110
applicable stat maximum = 104
displayed current stat = 104
equipment roll = 55
natural roll bonus = trunc((104 - 1) / 3) = 34
equipment roll cap = 30 + (104 - 90) = 44
final roll display = 34 + 44 = "78 (44)"
```

Each scenario verifies:

- the primary stat returns 104;
- its `fromTotalMax` restriction records raw 110 and limit 104;
- the over-cap predicate remains true, which drives the red total-cell class;
- the natural roll contribution is based on 104;
- 55 equipment roll is restricted to 44; and
- the final roll display is `78 (44)`.

The damroll scenario uses strength and the hitroll scenario uses dexterity.
No production-code change is expected. If either regression fails against
the current implementation, implementation must stop and the design must be
revisited rather than broadening scope ad hoc.

## Public Changelog

The existing `2.6.0-beta` hitroll and damroll bullets will be tightened rather
than duplicated. They will state that each calculation uses its capped current
primary stat for both the natural bonus and equipment cap while retaining the
raw over-cap warning.

Proposed wording:

```markdown
- Corrected builder damroll to use capped current strength alone for its natural bonus and equipment cap while retaining raw over-cap warnings.
- Corrected builder hitroll to use capped current dexterity alone for its natural bonus and equipment cap while retaining raw over-cap warnings.
```

The version remains `2.6.0-beta`.

## Verification

Run the focused builder game-stat test suite first, followed by the changelog
test and complete web suite. `git diff --check` must remain clean. The final
branch must contain only the approved spec, plan, regression tests, and
changelog wording; user-owned untracked files remain untouched.
