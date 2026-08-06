# Damroll Rules Design

**Date:** 2026-08-06
**Status:** Approved for implementation planning

## Context

LegendHUB's builder still models an older damroll implementation. The live
game is configured with `STR_ONLY_DAMROLL` enabled, so natural damroll comes
only from current strength. Its equipment damroll cap starts at 30 and rises
when current strength exceeds 90. Damroll from spells, familiars, and other
non-equipment sources remains outside the equipment cap.

The live game also adds Weapon Focus and martial-arts expert-wield bonuses
after the equipment cap. The builder has no character-ability model from which
to determine either bonus, so both are deliberately deferred for a later
iteration. This change will correct only the portions the builder can represent
without adding new character-option or persistence behavior.

## Goals

- Match the live game's strength-only natural damroll formula.
- Preserve the disabled dexterity and constitution weapon formulas in ample
  explanatory comments so their relationship to `STR_ONLY_DAMROLL` remains
  clear.
- Model the strength-dependent equipment damroll cap.
- Keep non-equipment damroll outside the equipment cap.
- Keep game formulas in the `gameStats` service and builder orchestration in
  the builder controller.
- Add focused regression coverage and record the user-visible correction in
  the changelog.

## Non-goals

- No JavaScript feature flag for disabling `STR_ONLY_DAMROLL`.
- No Weapon Focus control or `+5` bonus in this iteration.
- No martial-arts expert-wield calculation in this iteration.
- No character-ability model, builder-list format change, or persistence
  migration.
- No generic stat-rule or equipment-cap framework before the remaining rule
  changes are known.
- No changes to hitroll or any stat other than damroll.
- No release promotion, image publication, deployment, tagging, or pushing.

## Natural Damroll

`calculateNaturalStatBonus("dam", stats, items)` will calculate strength
damroll with JavaScript truncation that matches C integer division:

```text
trunc((strength - 1) / 3)
```

This replaces the current expression, which incorrectly returns 1 for
strength values 1 through 3. The corrected formula returns 0 for those values,
1 at strength 4, and 29 at strength 90.

Because `STR_ONLY_DAMROLL` is enabled, dexterity and constitution will not
contribute to natural damroll regardless of the equipped weapon's base damage
type. Their local damroll alternatives will be set explicitly to zero. Ample
adjacent comments will document the inactive C-side formulas:

```text
constitution: trunc(min(constitution, 100) / 4)
dexterity:    trunc(min(dexterity, 100) / 5)
```

The existing weapon-selection branches will remain, making the disabled
behavior and its relationship to weapon damage type explicit without adding a
JavaScript flag.

Because dexterity, constitution, and weapon choices cannot change the active
result, the declared natural dependency for damroll will change to strength
only.

## Equipment Damroll Cap

The `gameStats` service will expose
`calculateDamrollEquipmentCap(strength)`, a focused function that calculates
the equipment damroll cap from final strength:

```text
30 + max(strength - 90, 0)
```

The expected boundaries are:

| Final strength | Equipment damroll cap |
| ---: | ---: |
| 89 | 30 |
| 90 | 30 |
| 91 | 31 |
| 100 | 40 |
| 110 | 50 |

"Final strength" means the builder's capped strength total from all existing
sources, including base stats, equipment, KSM swaps, quests, and
strength-cap items.

The builder controller's existing item-cap path will call the service function
for damroll. Only the first 24 equipment slots will be included before applying
this cap, preserving the current item grouping. Damroll from spell, familiar,
and other later slots will be added after the capped equipment contribution.

The call from damroll totaling into final strength totaling is safe: strength
does not depend on damroll, so the new cap lookup does not create a calculation
cycle.

## Deferred Post-cap Bonuses

The live C calculation adds `ch->mod_buf_damroll`, Weapon Focus, and
martial-arts expert wield after the capped equipment contribution and natural
strength bonus. The builder's spell, familiar, and other later slots already
model uncapped damroll values corresponding to configurable post-cap sources.

Weapon Focus is a flat `+5` when the character has the `WeaponFocus` era
ability. The builder cannot currently represent that ability, so it must not
assume the bonus. Martial-arts expert wield also depends on character and weapon
state the builder does not model. Neither bonus will be silently folded into
another subtotal. Their omission will remain explicit in this design until a
separate ability-model change is approved.

## Data Flow

1. The builder begins totaling damroll.
2. It sums damroll from equipment slots 0 through 23.
3. It asks `gameStats` for the equipment cap using
   `$scope.getStatTotal("strength")`.
4. It records the existing `fromItems` restriction and caps the equipment
   subtotal when necessary.
5. It adds spell, familiar, and other later-slot damroll without applying the
   equipment cap.
6. It adds the strength-only natural damroll returned by `gameStats`.
7. It preserves the existing total and parenthesized equipment-subtotal
   display behavior.

## Testing

Focused service tests will cover:

- the exact natural formula at strengths 1, 3, 4, and a representative normal
  value;
- dexterity- and constitution-based weapons not changing natural damroll;
- damroll declaring only strength as a natural dependency;
- equipment-cap boundaries at strengths 89, 90, 91, 100, and 110;
- the new cap helper being available through both CommonJS and AngularJS;
- defensive copies from dependency lookup remaining intact.

Builder-facing regression coverage will verify that the damroll item-cap path
uses final strength, starts from the corrected base cap of 30, and keeps
non-equipment damroll outside the equipment cap. Existing hitroll behavior will
remain covered as a regression boundary. Existing game-stat, web, lint, and
relevant script checks will run after the focused tests, followed by
`git diff --check`.

## Release Record

The root `CHANGELOG.md` will describe the corrected strength-only natural
damroll and dynamic equipment cap beneath the existing `2.6.0-beta` entry. The
package version will remain `2.6.0-beta`, and existing release tags will remain
untouched.
