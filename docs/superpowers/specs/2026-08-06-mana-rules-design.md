# Mana Rules Design

**Date:** 2026-08-06
**Status:** Approved for implementation planning

## Context

LegendHUB's builder models level-50 characters. Its natural maximum-mana
calculation currently returns `446 + ((mind - 30) * 5)`, which accounts for
the level-50 base, the five saved mana boosts totaling 15, and the mind-based
mana contribution. It does not account for the 25 mana granted by
`VALLEY_COMPLETE`.

The builder already represents Mental Enhancement by loading a compensating
object into an Other slot. The natural calculation must therefore exclude
Mental Enhancement to avoid counting that bonus twice.

## Goals

- Model natural maximum mana for level-50 characters only.
- Continue assuming completion of the five saved mana boosts totaling 15.
- Also assume `VALLEY_COMPLETE`, adding 25 mana.
- Preserve the current mind contribution of five mana per point of current
  mind.
- Keep Mental Enhancement outside the natural formula.
- Leave existing equipment, spell, familiar, and Other-slot mana additions
  unchanged and uncapped.
- Add focused regression coverage and record the user-visible correction in
  the changelog.

## Non-goals

- No support for character levels 1 through 49.
- No level selector or generalized level-based mana API.
- No quest-completion toggles or persistence changes.
- No direct Mental Enhancement calculation or ability model.
- No equipment or total maximum-mana cap.
- No changes to hitroll, damroll, or other stats.
- No image publication, deployment, tagging, pushing, or release promotion.

## Level-50 Natural Mana

The level-50 calculation consists of:

| Component | Mana |
| --- | ---: |
| Base mana, including the five `SAV_*_MANA_BOOST` flags | 296 |
| Assumed `VALLEY_COMPLETE` | 25 |
| Mind contribution | `5 * mind` |

The five saved mana boosts are `1 + 2 + 3 + 4 + 5 = 15`. They are already
included in the established level-50 base of 296 and must not be added again.

The mind contribution follows the configured C calculation:

```text
(level * current mind) / MANA_FOR_MIND_DIV
```

At level 50 with `MANA_FOR_MIND_DIV` set to 10, this simplifies exactly to
five mana per point of current mind. The complete natural mana formula is
therefore:

```text
296 + 25 + (5 * mind)
```

To retain the existing builder expression's readable 30-mind baseline,
`calculateNaturalStatBonus("ma", stats, items)` will use the equivalent form:

```text
471 + ((mind - 30) * 5)
```

At 30 mind, natural maximum mana will increase from 446 to 471. Every other
mind value will also increase by exactly 25.

An adjacent comment will identify the fixed level-50 assumptions, explain
that the saved mana boosts are already included in the 296 base, and state
that Mental Enhancement is represented through Other-slot objects.

## Builder Data Flow

1. The builder totals maximum mana under the existing `ma` stat name.
2. It adds any stored base, KSM, quest, and equipment `ma` values through the
   existing generic stat-total path.
3. It adds spell, familiar, and Other-slot `ma` values without applying a cap.
4. It asks `gameStats` for the natural mana bonus using final current mind.
5. `gameStats` returns the level-50 natural total, including the assumed saved
   mana boosts and Valley completion but excluding Mental Enhancement.
6. The builder adds this natural value to the other mana sources without
   changing its display format.

The natural dependency for `ma` remains mind only. No new builder state or
calculation cycle is introduced.

## Testing

Focused service tests will verify:

- natural mana is 471 at 30 mind;
- natural mana is 321 at 0 mind and 821 at 100 mind, demonstrating the fixed
  25-point Valley addition and unchanged five-per-mind slope;
- `ma` continues to declare only mind as its natural dependency;
- browser registration exposes the corrected calculation through AngularJS.

Existing builder and service tests will remain regression coverage for the
generic item and Other-slot addition paths. The complete web test suite, CSS
lint, relevant script checks, and `git diff --check` will run before the work
is considered complete.

## Release Record

The root `CHANGELOG.md` will describe the assumed Valley completion and the
resulting 25-point increase to level-50 natural maximum mana beneath the
existing `2.6.0-beta` entry. The package version and immutable release tags
will remain unchanged.
