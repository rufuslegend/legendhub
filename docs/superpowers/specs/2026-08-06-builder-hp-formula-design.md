# Builder HP Formula Design

**Date:** 2026-08-06
**Status:** Approved for implementation planning

## Context

LegendHUB's builder models level-50 characters. Its natural maximum-HP
calculation still contains two assumptions that no longer match the current
Legend source:

- The fixed natural HP baseline includes 15 HP from the five India quest
  boosts even though the builder now has an explicit Quest HP field.
- The high-constitution adjustment uses the former `constitution - 88`
  expression instead of the current configured C calculation.

The builder represents the Physical Endurance era ability with a compensating
object. Natural HP must continue to exclude that ability so its 10 HP is not
counted twice.

## Goals

- Match the current Legend HP calculation for level-50 characters.
- Make Quest HP the complete explicit total of permanent quest HP, including
  any of the five India boosts the character has completed.
- Assume zero quest HP when the Quest HP field is absent or zero.
- Preserve the existing equipment, spell, familiar, and Other-slot HP paths.
- Keep Physical Endurance outside the natural formula.
- Add boundary-focused regression coverage and update the changelog.

## Non-goals

- No changes to the Legend source repository.
- No support for levels 1 through 49 or a configurable builder level.
- No automatic interpretation of individual quest-completion flags.
- No direct Physical Endurance ability model.
- No HP equipment or total cap changes.
- No changes to mana, movement, hitroll, damroll, or other stat formulas.
- No image publication, deployment, tagging, pushing, or release promotion.

## Source Calculation

The relevant Legend configuration is:

```text
BASE_HP = 20
HP_PER_LEVEL = 4
CON_FOR_ADDITIONAL_HP_CUTOFF = 89
HP_FOR_CON_DIV = 10
```

At level 50, `reroll_hps_internal()` calculates the stat-independent base:

```text
20 + (4 * (50 - 1)) = 216
```

`reroll_hps()` then adds quest HP and Physical Endurance. In LegendHUB, quest
HP is supplied by the explicit Quest HP field, while Physical Endurance is
supplied by its compensating object. Neither belongs in the internal natural
base.

Legend's `hp_for_con_internal()` adjusts constitution before calculating its
level-scaled contribution:

```text
effective constitution = constitution

if constitution > 89:
    effective constitution += constitution - 89 - 1

constitution HP = trunc((50 * effective constitution) / 10)
```

The complete LegendHUB natural HP formula is therefore:

```text
216 + constitution HP + normalized Quest HP
```

The implementation will retain the structure and named values of the C
calculation rather than replace it with an opaque simplified expression. This
makes future comparisons with Legend's configurable formula straightforward.

## Builder Data Flow

1. The builder resolves the character's current constitution through the
   existing stat-total path.
2. It passes constitution and Quest HP to `gameStats`.
3. `gameStats` calculates the level-50 base and constitution contribution,
   then adds normalized Quest HP exactly once.
4. The builder's generic total path independently adds equipment, spells,
   familiars, and Other-slot HP, including the Physical Endurance compensating
   object.

The natural dependency for HP remains constitution only. Quest HP remains a
direct resource input rather than a recursive stat dependency. Existing Quest
HP normalization and persistence remain unchanged.

## Boundary Behavior

With Quest HP set to zero, the expected natural HP values are:

| Constitution | Effective constitution | Natural HP |
| ---: | ---: | ---: |
| 30 | 30 | 366 |
| 89 | 89 | 661 |
| 90 | 90 | 666 |
| 91 | 92 | 676 |
| 100 | 110 | 766 |

Quest HP is added directly after this calculation. For example, 30
constitution and 15 Quest HP produces 381 natural HP. Missing Quest HP is
normalized to zero.

## Testing

Focused service tests will verify:

- the level-50 base and constitution calculation at 30 constitution;
- the cutoff behavior at constitution 89, 90, and 91;
- the high-constitution result at 100 constitution;
- missing Quest HP behaving as zero;
- Quest HP adding exactly once;
- HP continuing to declare constitution as its only natural stat dependency.

The builder integration test will be updated to expect the corrected total
when Quest HP and equipment are present. The focused builder/game-stat tests,
complete web test suite, and `git diff --check` will run before completion.

## Release Record

The root `CHANGELOG.md` will record that level-50 natural HP now mirrors the
current Legend base and high-constitution calculation, with all quest HP
entered explicitly. The version remains `2.6.0-beta`.
