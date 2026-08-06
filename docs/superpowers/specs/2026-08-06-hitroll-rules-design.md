# Hitroll Rules Design

**Date:** 2026-08-06  
**Status:** Approved for implementation planning

## Context

LegendHUB's builder still models an older hitroll implementation. The live
game now derives natural hitroll only from dexterity, and its equipment
hitroll cap starts at 30 and rises when current dexterity exceeds 90. Hitroll
from spells, familiars, and other non-equipment sources remains outside the
equipment cap.

This is the first iteration in a broader stat-rule update. The change will stay
limited to hitroll so later stat changes can be specified and verified
independently.

## Goals

- Match the live game's dexterity-only natural hitroll formula.
- Preserve the disabled strength and constitution formulas in explanatory
  comments so their relationship to the game's C-side feature flag remains
  clear.
- Model the dexterity-dependent equipment hitroll cap.
- Keep non-equipment hitroll outside the equipment cap.
- Keep game formulas in the `gameStats` service and builder orchestration in
  the builder controller.
- Add focused regression coverage and record the user-visible correction in
  the changelog.

## Non-goals

- No changes to damroll or any stat other than hitroll.
- No JavaScript feature flag for re-enabling strength- or
  constitution-derived hitroll.
- No generic stat-rule or equipment-cap framework before the remaining rule
  changes are known.
- No release promotion, image publication, deployment, tagging, or pushing.

## Natural Hitroll

`calculateNaturalStatBonus("hit", stats, items)` will calculate dexterity
hitroll with JavaScript truncation that matches C integer division:

```text
trunc((dexterity - 1) / 3)
```

This replaces the current algebraically similar expression because the old
expression incorrectly returns 1 for dexterity values 1 through 3. The new
formula returns 0 for those values.

Strength and constitution will no longer contribute to natural hitroll. The
local strength and constitution hitroll values will be set explicitly to zero.
Ample adjacent comments will retain their former formulas and explain that the
live game's corresponding C-side bonuses are disabled behind a flag. The
existing weapon-selection branches will remain, making the disabled behavior
and its relationship to weapon stat selection explicit without introducing a
JavaScript flag.

Because strength, constitution, and weapon choices cannot change the result,
the declared natural dependency for hitroll will change to dexterity only.

## Equipment Hitroll Cap

The `gameStats` service will expose
`calculateHitrollEquipmentCap(dexterity)`, a focused function that calculates
the equipment hitroll cap from final dexterity:

```text
30 + max(dexterity - 90, 0)
```

The expected boundaries are:

| Final dexterity | Equipment hitroll cap |
| ---: | ---: |
| 89 | 30 |
| 90 | 30 |
| 91 | 31 |
| 100 | 40 |
| 110 | 50 |

"Final dexterity" means the builder's capped dexterity total from all existing
sources, including base stats, equipment, KSM swaps, quests, and
dexterity-cap items.

The builder controller's existing item-cap path will call the service function
for hitroll. Only the first 24 equipment slots will be included before applying
this cap, preserving the current item grouping. Hitroll from spell, familiar,
and other later slots will be added after the capped equipment contribution.
Damroll will keep its current equipment cap of 27 until its rules are reviewed
in a separate iteration.

The call from hitroll totaling into final dexterity totaling is safe:
dexterity does not depend on hitroll, so the new cap lookup does not create a
calculation cycle.

## Data Flow

1. The builder begins totaling hitroll.
2. It sums hitroll from equipment slots 0 through 23.
3. It asks `gameStats` for the equipment cap using
   `$scope.getStatTotal("dexterity")`.
4. It records the existing `fromItems` restriction and caps the equipment
   subtotal when necessary.
5. It adds spell, familiar, and other later-slot hitroll without applying the
   equipment cap.
6. It adds the dexterity-only natural hitroll returned by `gameStats`.
7. It preserves the existing total and parenthesized equipment-subtotal
   display behavior.

## Testing

Focused service tests will cover:

- the exact natural formula at low dexterity and a representative normal
  value;
- strength- and constitution-based weapons not changing natural hitroll;
- hitroll declaring only dexterity as a natural dependency;
- equipment-cap boundaries at dexterity 90, 91, 100, and above 100;
- defensive copies from dependency lookup remaining intact.

Builder-facing regression coverage will verify that the hitroll item-cap path
uses final dexterity while keeping damroll at 27 and non-equipment hitroll
outside the equipment cap. Existing game-stat, web, lint, and relevant script
checks will run after the focused tests, followed by `git diff --check`.

## Release Record

The root `CHANGELOG.md` will describe the corrected natural hitroll and dynamic
equipment cap beneath the existing `2.6.0-beta` entry. The package version
will remain `2.6.0-beta`, and existing release tags will remain untouched.
