# Builder Era Abilities Design

## Goal

Track the persistent era abilities that change Builder stat totals so players no
longer need faux objects to represent them.

## Scope

The MVP tracks eight abilities whose persistent ranks directly affect Builder
calculations:

| Era | Ability | Maximum rank | Builder effect per rank |
| --- | --- | ---: | --- |
| Ancient | Mental Enhancement | 3 | +10 mana |
| Ancient | Arcane Focus | 5 | +1 spell damage and +1 spell critical |
| Medieval | Hardened Skin | 5 | -3 armor class |
| Medieval | Increased Potential | 5 | +1 maximum for each base attribute |
| Medieval | Physical Enhancement | 3 | +20 movement |
| Medieval | Weapon Focus | 1 | +5 hitroll and +5 damroll |
| Medieval | Innate Regeneration | 3 | +1 HP, mana, and movement regeneration |
| Industrial | Physical Endurance | 3 | +10 hit points |

Other era abilities remain out of scope until the broader checklist is designed.
Faux objects remain available and additive for temporary, conditional, or custom
adjustments.

## Data and calculations

`game-stats.js` owns a single ordered metadata catalog containing stable keys,
labels, eras, maximum ranks, and stat effects. Builder variants store selected
ranks in an `eraAbilities` object keyed by the catalog's stable keys. Missing,
invalid, fractional, and out-of-range ranks normalize to valid integer ranks.

The controller adds the catalog-derived bonuses after normal item-cap handling,
matching LegendMUD's persistent-character calculations. Increased Potential also
raises the overall cap for all six base attributes before dependent formulas use
their capped values.

## UI

Add a compact `Era Abilities` block below the character quest-resource fields.
Render rank selectors from metadata and group them under Ancient, Medieval, and
Industrial headings. Each selector offers `None` and every valid rank. This is an
MVP layout; visual refinement will happen after players can exercise the feature.

## Persistence and compatibility

Builder export format version 6 appends one rank character per catalog entry
after the version-5 quest-resource fields and before item slots. Version 6 import
rejects missing, malformed, or out-of-range ranks. Versions 1 through 5 and
unversioned lists continue to import with every era ability at rank zero.

## Verification and release note

Automated tests cover metadata isolation and rank normalization, every calculated
effect, Increased Potential's cap behavior, version-6 round trips and malformed
payloads, legacy defaults, and the generated UI bindings. Add the feature to the
root changelog under the 2.9.0-beta cycle.
