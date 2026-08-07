# Builder Mana Base Correction Design

**Date:** 2026-08-07
**Status:** Approved for implementation planning

## Context

LegendHUB's builder models level-50 characters. Its natural mana calculation
currently starts at 281 because it subtracts the five possible saved mana
quest boosts, totaling 15, from the level-50 reroll result of 296.

That subtraction does not match the Legend source. `reroll_mana_internal()`
calculates 296 before any quest flags are considered:

```text
BASE_MANA + (MANA_PER_LEVEL * (level - 1))
100       + (4              * (50 - 1)) = 296
```

`reroll_mana()` adds the five saved boosts, Valley completion, and Mental
Enhancement afterward. LegendHUB now has an explicit Quest Mana field, while
Mental Enhancement is represented by a compensating Other-slot object. The
natural base must therefore remain 296 without assuming or subtracting any of
those later bonuses.

Hakim's imported builder profile exposed the error. His final current mind is
105, Quest Mana is zero, and his equipped mana modifiers total -55. Legend
reports 766 maximum mana:

```text
296 + ((50 * 105) / 10) - 55 = 766
```

The current 281 builder base instead produces 751 for the corrected imported
profile.

## Goals

- Match the current Legend level-50 quest-less base mana of 296.
- Continue using the C-derived mind contribution
  `trunc((50 * current mind) / 10)`.
- Add Quest Mana exactly once after the base and mind contribution.
- Preserve equipment, spell, familiar, and Other-slot mana aggregation.
- Keep Mental Enhancement outside natural mana.
- Add a builder integration regression for Hakim's 766-mana case.
- Update existing mana expectations and the public changelog.

## Non-goals

- No changes to the Legend source repository.
- No support for levels 1 through 49 or a configurable builder level.
- No automatic interpretation of individual mana quest flags.
- No direct Mental Enhancement ability model.
- No changes to the Quest Mana field, normalization, serialization, or UI.
- No changes to hit points, movement, hitroll, damroll, or other formulas.
- No image publication, deployment, tagging, pushing, or release promotion.

## Natural Mana Calculation

The builder's `ma` stat continues to represent maximum mana. Its natural
calculation will retain the structure of the Legend C calculation:

```text
level = 50
rerolled mana = 100 + (4 * (level - 1))
mind mana = trunc((level * current mind) / 10)

natural mana = rerolled mana + mind mana + normalized Quest Mana
```

At level 50 this is equivalent to:

```text
296 + (5 * current mind) + Quest Mana
```

The implementation will retain the existing explicit level and divisor
calculation. It will introduce named base-mana and mana-per-level values so
the 296 result is visibly derived rather than represented by another opaque
constant. The adjacent comment will state that 296 contains no quest mana,
that Quest Mana supplies all completed resource quests, and that Mental
Enhancement remains represented by an Other-slot object.

## Builder Data Flow

1. The builder calculates final current mind through its existing base, quest,
   equipment, spell, and cap path.
2. It passes current mind and the explicit Quest Mana value to `gameStats`.
3. `gameStats` returns the level-50 rerolled base, mind contribution, and
   normalized Quest Mana.
4. The builder independently adds equipped mana modifiers and Other-slot mana.

No interface, dependency-map, persistence, or controller data-flow change is
required.

## Expected Values

Service-level natural mana expectations become:

| Current mind | Quest Mana | Natural mana |
| ---: | ---: | ---: |
| 0 | 0 | 296 |
| 30 | 0 | 446 |
| 100 | 0 | 796 |
| 105 | 0 | 821 |
| 30 | 23 | 469 |

Hakim's integration regression uses a final current mind cap of 105, zero
Quest Mana, and -55 equipped mana:

```text
821 - 55 = 766
```

The existing quest-resource builder integration result for mana increases by
exactly 15 because it currently uses the incorrect 281 base.

## Testing

Focused service tests will verify the five expected natural-mana values above.
The builder integration suite will verify Hakim's 105-mind, -55-equipment case
and update the existing Quest Mana aggregation expectation. Existing tests
continue to cover Quest Mana normalization, default zero values, persistence,
and isolation between HP, mana, and movement quest fields.

Run the focused game-stat and builder tests first, then the complete web test
suite and `git diff --check` before completion.

## Release Record

The root `CHANGELOG.md` will state that level-50 builder mana now uses Legend's
296 quest-less reroll base before adding entered Quest Mana. The public version
remains `2.6.0-beta`.
