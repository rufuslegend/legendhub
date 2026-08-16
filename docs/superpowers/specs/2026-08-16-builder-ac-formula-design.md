# Builder Natural Armor Class Formula Design

**Date:** 2026-08-16
**Version:** 2.8.0-beta
**Status:** Approved

## Problem

LegendHUB's Builder still calculates natural armor class with a legacy rule
that begins at 83, uses dexterity and perception bonuses, and applies
strength, dexterity, and constitution thresholds. Production LegendMUD has
not used that rule since the 2022 combat rewrite.

The production game now begins a normal player at 100 armor class and applies
one stat-derived term when `AC_FROM_DEX` is enabled. That setting is enabled
in the production configuration. Battle Training, Hardened Skin, era
abilities, spells, buffs, equipment, and other affects remain separate armor
class modifiers.

The stale Builder formula can therefore produce the wrong total even when its
equipment data is correct. Its existing test protects a single legacy result
instead of the current game contract.

## Decision

Correct only the Builder's natural armor class term. Continue representing
skills, era abilities, buffs, and other conditional effects with the existing
faux objects in the Builder's Other slots.

For the Builder's normal level-50, standing, neutral-wary, non-vehicle
baseline, natural armor class is:

```text
100 - trunc((dexterity - 30) / 2)
```

Division must follow C integer semantics and truncate toward zero. This
matters for odd dexterity values and for values below 30.

## Architecture and Data Flow

The calculation remains in the existing UMD `gameStats` service and continues
through the current Builder aggregation path:

1. The controller asks `gameStats` which primary stats natural armor class
   depends on.
2. The service declares only `dexterity` as an armor class dependency.
3. The controller supplies the character's capped current dexterity.
4. `calculateNaturalStatBonus("ac", stats, items)` returns the natural armor
   class value from the approved formula.
5. The controller adds armor class from worn items, Familiar slots, and Other
   slots exactly as it does today.

The `items` argument remains part of the shared calculator interface but is
not needed by the natural armor class branch. Faux objects remain ordinary
item inputs and are added by the controller rather than inspected inside the
natural calculation.

## Conditional Armor Class Sources

The natural term must not include any of these sources:

- Battle Training
- Hardened Skin or other era abilities
- armor spells, Warding, or other buffs
- wary or aggressive stance
- rage's armor class cap
- vehicle armor class
- martial-arts stance bonuses

Existing faux objects remain the supported way to include skills, era
abilities, spells, and buffs in a build. Wary, rage, vehicles, and martial
stances are outside this correction because the Builder does not currently
model those states.

This separation prevents double-counting Battle Training, Hardened Skin, or
combined faux objects that already carry their own armor class values.

## Compatibility

No view, GraphQL schema, database schema, cookie, local-storage format, or
Builder import/export version changes.

Existing saved builds recalculate their displayed armor class when opened.
Their selected real and faux objects remain unchanged.

## Testing

Replace the legacy single-sample armor class assertion with table-driven
service tests whose expected values are derived directly from the production
C rule. Cover:

- dexterity below 30, proving the natural penalty is retained;
- dexterity exactly 30, proving the baseline is 100;
- odd dexterity above 30, proving truncation toward zero;
- representative level-50 dexterity values, including 40 and 100;
- different strength, constitution, and perception values at identical
  dexterity, proving those stats no longer affect natural armor class.

Add or update controller-level coverage to prove armor class from an Other-slot
faux object remains additive and is not duplicated by the natural term.

The focused tests must fail against the legacy formula before the service is
changed, then pass after the minimal implementation. Full web tests and the
existing CSS checks remain the completion gate because the working tree also
contains the separate shared-picker icon-size change.

## Public Documentation

Add a `2.8.0-beta` changelog entry explaining that the Builder's natural armor
class calculation now matches the current dexterity-based LegendMUD rule.

## Acceptance Criteria

- Natural armor class equals `100 - trunc((dexterity - 30) / 2)`.
- Only capped current dexterity feeds the natural armor class calculation.
- Strength, constitution, and perception do not change natural armor class.
- Real-item and faux-object armor class values remain additive.
- Existing saved builds and import/export strings require no migration.
- Focused regression tests, the full web suite, and CSS lint pass.
- No image publication, push, or deployment occurs without separate
  authorization.
