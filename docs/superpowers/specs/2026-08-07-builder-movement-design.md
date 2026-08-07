# Builder Movement Formula Design

**Date:** 2026-08-07
**Status:** Approved for implementation planning

## Context

LegendHUB's builder models level-50 characters. Its natural maximum-movement
calculation is algebraically close to the current Legend formula, but it still
uses the higher of constitution and dexterity. Current Legend configuration
uses current dexterity only because `MV_STATIC_SUBTITUTE_FOR_DEX` is zero.

The builder already has an explicit Quest Mv field. It also represents the
Physical Enhancement era ability with a faux item, so neither quest movement
nor Physical Enhancement should be hidden in the natural base.

## Goals

- Match the current Legend maximum-movement calculation for level-50
  characters.
- Use capped current dexterity as the only stat-derived movement input.
- Add the normalized Quest Mv value exactly once.
- Preserve existing equipment, spell, familiar, and Other-slot movement.
- Keep Physical Enhancement outside the natural formula because its faux item
  supplies the ability's 20 movement.
- Add source-parity comments, regression coverage, and a changelog entry.

## Non-goals

- No changes to the Legend source repository.
- No support for levels 1 through 49 or a configurable builder level.
- No direct Physical Enhancement ability model.
- No changes to Quest Mv storage, import, export, or normalization.
- No movement equipment or total cap changes.
- No changes to movement regeneration or any other stat formula.
- No image publication, deployment, tagging, pushing, or release promotion.

## Source Calculation

The relevant Legend configuration is:

```text
BASE_MOVE = 150
MOVE_PER_LEVEL = 4
MV_STATIC_SUBTITUTE_FOR_DEX = 0
MV_DIV = 10
```

At level 50, `reroll_move_internal()` calculates the stat-independent base:

```text
150 + (4 * (50 - 1)) = 346
```

Because `MV_STATIC_SUBTITUTE_FOR_DEX` is zero, `mv_for_stat()` uses current
dexterity:

```text
movement for dexterity = trunc((50 * capped current dexterity) / 10)
```

The complete LegendHUB natural movement formula is therefore:

```text
346 + movement for dexterity + normalized Quest Mv
```

At level 50 this simplifies to `346 + (5 * dexterity) + Quest Mv`, but the
implementation will retain the named values and structure of the C calculation
so future comparisons with Legend's configurable formula remain straightforward.

`reroll_move()` also adds 20 movement for Physical Enhancement. LegendHUB
excludes that bonus from the natural formula because the builder's faux item
adds it through the normal item path.

## Builder Data Flow

1. The builder resolves capped current dexterity through the existing
   stat-total path. This retains the existing raw-value warning and support for
   stat-cap-increasing equipment while using only the effective capped value.
2. It passes dexterity and Quest Mv to `gameStats`.
3. `gameStats` calculates the level-50 reroll base and dexterity contribution,
   then adds normalized Quest Mv exactly once.
4. The builder's generic total path independently adds equipment, spell,
   familiar, and Other-slot movement, including the Physical Enhancement faux
   item when selected.

Movement's natural stat dependency changes from constitution and dexterity to
dexterity only. Constitution no longer triggers or affects natural movement.

## Boundary Behavior

With Quest Mv set to zero, expected natural movement is:

| Dexterity | Natural movement |
| ---: | ---: |
| 0 | 346 |
| 30 | 496 |
| 50 | 596 |
| 90 | 796 |
| 100 | 846 |
| 105 | 871 |

Quest Mv is added after the C-derived base and stat contribution. For example,
50 dexterity and 29 Quest Mv produces 625 natural movement. Missing Quest Mv
continues to normalize to zero.

## Testing

Focused service tests will verify:

- the level-50 reroll base and dexterity calculation;
- movement declaring dexterity as its only natural stat dependency;
- constitution having no effect, including when it exceeds dexterity;
- capped dexterity values being used through the builder integration path;
- missing Quest Mv behaving as zero;
- Quest Mv adding exactly once; and
- existing movement equipment and faux-item bonuses remaining additive.

The focused game-stat and builder tests, complete web test suite, and
`git diff --check` will run before completion.

## Release Record

The root `CHANGELOG.md` will record that the builder's level-50 maximum
movement now follows Legend's current dexterity-only calculation. The version
remains `2.6.0-beta`.
