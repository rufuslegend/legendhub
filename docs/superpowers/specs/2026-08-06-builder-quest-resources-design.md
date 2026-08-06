# Builder Quest Resource Bonuses Design

## Goal

Let builder users enter character-specific quest bonuses for hit points, mana,
and movement. These values must affect the displayed natural resource totals and
survive local saves, imports, exports, and upgrades from older builder-list
formats.

## User Interface

Add a second row directly beneath the existing Longhouse, Amulet, and Hazelnut
row in the builder's Stats block. The row contains three number inputs:

| Label | Model property |
| --- | --- |
| Quest HP | `selectedList.baseStats.quest_hp` |
| Quest Mana | `selectedList.baseStats.quest_mana` |
| Quest Mv | `selectedList.baseStats.quest_move` |

The inputs accept non-negative whole numbers and default to zero. Empty,
missing, or invalid values are treated as zero. Changing an input saves the
builder data through the existing client-side save path. The values are not
equipment bonuses and are not subject to equipment caps.

## Resource Calculations

`game-stats.js` remains the source of truth for natural resource calculations.
The builder controller passes the three quest values alongside the existing
stat dependencies without adding them to the recursive stat dependency map.

The level-50 formulas become:

```text
hp = 381 + ((constitution - 30) * 5)
     + (constitution > 89 ? max(constitution - 88, 0) * 5 : 0)
     + quest_hp
mana = 281 + trunc((50 * mind) / 10) + quest_mana
move = 496 + ((max(constitution, dexterity) - 30) * 5) + quest_move
```

The HP and movement base formulas remain otherwise unchanged. Mana removes the
previous fixed 40-point assumption: the five saved mana boosts contributed 15
and the assumed Valley completion contributed 25. Quest Mana now represents
whatever resource-quest mana the character actually has.

The calculation service normalizes an absent quest value to zero so callers
that do not know about the new fields retain valid behavior.

## Builder Data and Compatibility

The quest values live in `baseStats`, beside the existing Longhouse, Amulet,
and Hazelnut quest selections. This extends the current structure without
introducing a second quest-data container or representing quest rewards as
items.

Increment the compact builder-list format from version 4 to version 5. Version
5 writes each quest value as a three-character base-62 integer immediately
after the Hazelnut value and before the item-slot data, in this order:

1. `quest_hp`
2. `quest_mana`
3. `quest_move`

Three base-62 characters support values from 0 through 238,327. The inputs and
serializer constrain values to that range so an oversized value cannot shift
the remaining compact fields and corrupt item decoding.

Compatibility behavior is explicit:

- New lists initialize all three quest values to zero.
- Legacy version-1 lists initialize all three values to zero.
- Version-2 through version-4 lists consume no quest-value characters and
  initialize all three values to zero.
- Version-5 lists decode the three persisted values before decoding items.
- All newly saved and exported lists use version 5.

## Validation and Failure Behavior

UI input is limited to non-negative integers in the representable version-5
range. Formula callers and old in-memory lists may still provide missing,
non-numeric, fractional, negative, or oversized values; these are normalized
by converting to a number, replacing non-finite values with zero, truncating
fractions, and clamping the result to 0 through 238,327 before calculation or
serialization. Malformed version-5 compact data continues through the
builder's existing invalid-list handling instead of silently shifting item
fields.

## Testing

Add regression coverage for:

- HP, mana, and movement totals with zero and nonzero quest values.
- The mana baseline with the old fixed 40 points removed.
- Missing quest fields behaving as zero for compatibility.
- Builder totals passing each quest value to the correct resource formula.
- The three labeled inputs and their model bindings in the Stats block.
- Version-5 save/load round trips for all three values.
- Version-4 loads defaulting all three values to zero without disturbing item
  decoding.
- Default new lists containing zero values.

Run the focused builder/game-stat tests first, then the full web test suite and
`git diff --check` before integration.

## Documentation and Deployment

Record the user-visible builder enhancement in root `CHANGELOG.md` under
`2.6.0-beta`. Do not push, publish images, tag, or deploy without separate,
deployment-specific authorization.
