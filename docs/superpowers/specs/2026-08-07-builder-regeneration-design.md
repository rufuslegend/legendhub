# Builder Regeneration Formula Design

**Date:** 2026-08-07

**Status:** Approved for implementation planning

## Objective

Make the level-50 LegendHUB builder display Hit Point Regen, Mana Regen, and
Move Regen using the current Legend runtime formulas. The builder must apply
the level-50 equipment cap correctly, preserve uncapped Familiar and Other-slot
bonuses, use capped current stats, and expose the effective equipment
contribution consistently for all three regeneration totals.

## Authoritative Runtime Behavior

The implementation is derived from the read-only Legend source in
`/Users/toddmckimmey/projects/legendmud/current/player.c`:

- `get_max_regen()` gives a level-50 player an object-based regeneration cap of
  `(50 / 3) + 4`, or 20 using C integer division.
- `get_hp_regen_evt()`, `get_mana_regen_evt()`, and `get_move_regen_evt()` add
  a high-stat contribution to object regeneration before applying that cap.
- `get_hp_regen_wsp()`, `get_mana_regen_wsp()`, and `get_move_regen_wsp()` add
  natural stat bonuses, spell regeneration, and Innate Regeneration outside
  the object cap.
- The governing stat is the runtime current stat, so LegendHUB must use its
  already-capped displayed Constitution, Mind, or Dexterity value rather than
  an over-cap raw equipment total.

The three high-stat contributions inside the equipment cap use the same rule:

```text
inside_cap(stat) = stat > 79 ? trunc((stat - 75) / 5) : 0
```

JavaScript must use `Math.trunc()` where the C code performs integer division.

## Regeneration Formulas

### Hit Point Regen (`hpr`)

Constitution governs HP regeneration.

```text
con_natural = trunc(constitution / 10)
if constitution > 100:
    con_natural += trunc((constitution - 100) / 10)

hpr_natural = inside_cap(constitution) + con_natural
hpr_equipment_allowance = 20 - inside_cap(constitution)
```

The inside-cap contribution is included in the natural value while the
equipment allowance is reduced by the same amount. This preserves the C
identity:

```text
min(equipment + inside_cap, 20)
  == min(equipment, 20 - inside_cap) + inside_cap
```

### Mana Regen (`mar`)

Mind governs mana regeneration.

```text
mind_natural = trunc(mind / 10)
if mind > 100:
    mind_natural += trunc((mind - 100) / 2)

mar_natural = inside_cap(mind) + mind_natural
mar_equipment_allowance = 20 - inside_cap(mind)
```

### Move Regen (`mvr`)

Dexterity governs move regeneration.

```text
dex_natural = dexterity > 53 ? trunc((dexterity - 49) / 5) : 0

mvr_natural = inside_cap(dexterity) + dex_natural
mvr_equipment_allowance = 20 - inside_cap(dexterity)
```

## LegendHUB Architecture

`www/src/public/js/services/game-stats.js` remains the source of truth for
natural stat-derived bonuses. It will:

1. Add `mind` as the dependency for `mar` and `dexterity` as the dependency for
   `mvr`; `hpr` continues depending on `constitution`.
2. Implement the three natural regeneration cases in
   `calculateNaturalStatBonus()` using the formulas above.
3. Provide an exported regeneration equipment-cap helper based on the shared
   inside-cap rule and the fixed level-50 base cap of 20.
4. Keep the shared arithmetic in named helpers with comments tying thresholds,
   divisors, and cap placement back to the C functions.

`www/src/public/js/controllers/builder/main.js` retains responsibility for
combining stat sources. It will:

1. Ask `game-stats.js` for the dynamic equipment allowance for `hpr`, `mar`,
   and `mvr`, passing the builder's already-capped governing stat.
2. Apply that allowance only to the first 24 equipment positions.
3. Continue adding positions 24 and later (Familiar and Other) after the cap.
4. Format all three totals as `total (effective equipment)`.

This division keeps the C-derived arithmetic testable without replacing the
builder's generic item, spell, restriction, and total-calculation pipeline.

## Ability and Slot Semantics

- Familiar and Other-slot regeneration remains uncapped. These positions model
  spell, familiar, and ability contributions that are added outside the normal
  equipment cap.
- Innate Regeneration is not calculated directly. For now it remains modeled
  by a compensating Other-slot object that adds equally to all three regen
  values.
- No new era-ability controls or saved-profile fields are introduced.

## Display and Restrictions

If normal equipment exceeds its stat-adjusted allowance, the builder will keep
the existing red restriction indicator. Its tooltip will report the raw normal
equipment total and the dynamic effective limit.

All three totals will show the same breakdown convention. For example, a total
of 30 with 15 effective equipment regeneration displays as `30 (15)`.
Familiar and Other-slot contributions affect the first number but not the
parenthesized equipment number.

## Verification

Unit coverage in `www/test/game-stats.test.js` will establish the C thresholds
and integer-division behavior for all three formulas and the shared equipment
allowance. At minimum it will cover:

- Stat 79 versus 80, where the inside-cap contribution begins.
- Stat 100.
- Values above 100 that exercise each resource's distinct extra-stat divisor.
- Missing or unrelated stats continuing to produce safe, isolated results.

Expected natural values at stat 80 with no equipment, spell, Familiar, Other,
or ability bonus are:

| Resource | Natural value | Equipment allowance |
| --- | ---: | ---: |
| HP Regen | 9 | 19 |
| Mana Regen | 9 | 19 |
| Move Regen | 7 | 19 |

At stat 100, all three natural values are 15 and all three equipment allowances
are 15.

Builder integration coverage in `www/test/builder-game-stats.test.js` will:

- Exceed each dynamic equipment allowance and verify the capped contribution.
- Verify the restriction amount and dynamic limit.
- Verify Familiar/Other regeneration remains uncapped.
- Verify all three `total (effective equipment)` strings.
- Verify raw stats above an applicable stat cap do not influence natural regen
  or the equipment allowance.

The complete `www` test suite must pass before integration.

## Public Documentation

Root `CHANGELOG.md` will record the corrected HP, mana, and move regeneration
formulas and dynamic equipment caps as a public builder bug fix. The project
version remains `2.6.0-beta`.

## Out of Scope

- Changes to the Legend source repository.
- Modeling Innate Regeneration as a first-class builder ability.
- Changes to actual regeneration tick timing, character position, combat,
  hunger, bleeding, or other runtime regeneration modifiers.
- Saved-profile format or database changes.
- Changes to non-regeneration builder stats.
