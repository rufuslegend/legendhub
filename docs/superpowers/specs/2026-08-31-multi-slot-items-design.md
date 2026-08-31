# Multi-Slot Items Design

**Date:** 2026-08-31
**Status:** Approved design pending written-spec review

## Purpose

Legend equipment can be eligible for more than one wear location, while
LegendHUB currently stores exactly one `Items.Slot` value per item row. Players
have worked around that limitation by creating duplicate rows for the same item
under different slots. That workaround loses the fact that one item definition
has several valid locations and makes Builder eligibility depend on ad hoc slot
inference.

LegendHUB will represent every item's complete set of eligible wear locations.
Equipping the item in Builder still chooses one location: an item capable of
Wield and Hold occupies only the particular Wield or Hold row where the player
places it.

This change deliberately preserves every existing item row and ID. It does not
merge apparent duplicates, introduce official-item ingestion, or implement the
equipment spool consumer.

## Slot Vocabulary

The existing numeric slot IDs remain stable:

```text
0 Light       1 Finger      2 Neck       3 Body
4 Head        5 Face        6 Legs       7 Feet
8 Hands       9 Arms       10 Shield    11 About
12 Waist     13 Wrist      14 Wield     15 Hold
16 Ear       17 Arm        18 Amulet    19 Aux
20 Familiar  21 Other
```

`Familiar` and `Other` remain LegendHUB concepts. `Familiar` can be selected by
players and editors but will not be emitted by Legend's future equipment
producer. `Other` is exclusive: it cannot be combined with any wearable slot.

## Database Representation

Add `Items.SlotMask INT UNSIGNED NOT NULL`. Bit `n` represents eligibility for
slot ID `n`, so the 22 current slots occupy bits 0 through 21. Application code
must reject unknown bits and empty masks.

Keep `Items.Slot` as a deprecated primary slot for compatibility with existing
queries, clients, ordering, and display code during this release. `SlotMask` is
the authoritative eligibility set; `Slot` must always name one of its set bits.

The item audit/history table and its insert/update audit paths gain both the old
and new `SlotMask` values so a capability change is traceable alongside the
other item fields.

### Existing-data migration

The migration updates each existing row in place and preserves its ID and all
other fields:

1. Begin with the singleton mask containing `Items.Slot`.
2. If `Items.Slot = 14` (Wield) and `Items.Holdable = 1`, also add bit 15
   (Hold).
3. Infer nothing else. Shield does not imply Hold or Wield, Hold does not imply
   Wield, and no name/stat similarity causes rows to be combined.

The migration is repeatable in tests and validates that every resulting mask is
nonempty, contains only known bits, and contains its legacy primary slot.

### Primary-slot rule

An existing primary slot remains unchanged while it is still selected. If an
editor removes it, the server selects the first remaining capability in the
canonical numeric order above. A new item uses the first selected capability in
that order. This keeps primary values stable without asking users to manage a
second, largely internal choice.

## GraphQL and Server Contract

The item GraphQL type adds non-null `slots: [Int!]!` and retains scalar `slot`.
Resolvers decode `SlotMask` into a sorted, duplicate-free array. `slot` exposes
the compatible primary value and is not the eligibility source for updated
clients.

Item create and update mutations accept `slots`. Server-side normalization and
validation require:

- at least one slot;
- integer IDs from 0 through 21;
- no duplicates after normalization; and
- slot 21 (`Other`) by itself.

Writes derive `SlotMask` and the compatible primary slot in one transaction.
Invalid input returns a field-level client error and does not partially update
the item or its audit record.

For transitional compatibility, a create that supplies only legacy `slot`
creates a singleton capability set. A legacy Wield create with `Holdable = 1`
also gains Hold, matching the existing-data migration. On update, a request that
omits `slots` preserves the authoritative mask. It may retain or change the
primary only to a slot already present in that mask; adding or removing
capabilities requires `slots`. Updated LegendHUB clients always send `slots`.

Item queries and fragments expose both fields. Filtering by a requested slot
uses bit membership in `SlotMask`; it no longer infers Wield, Hold, or Shield
eligibility through special SQL conditions. General ordering may continue to
use the compatible primary slot.

## Item Search, Details, and Editor

Item Search's slot filter matches an item when the requested bit is present in
its capability mask. Search results and item details render every eligible slot
in canonical order rather than presenting only the primary slot.

The item editor replaces the required single-slot select with an accessible
multi-select control covering the 22 Hub slots. It requires at least one
selection and enforces `Other` exclusivity before submission, while the server
remains the final validator.

Weapon-related editor fields are visible when the item is capable of Wield or
Hold according to `slots`, not according to its deprecated primary slot. Rules
specific to Wield continue to check Wield capability explicitly. Existing
weapon and `Holdable` values are preserved; `Holdable` no longer acts as a
runtime substitute for the capability set.

## Builder Equipment Rows

Builder adds the missing Shield row and a third Hold row and therefore presents
all five hand-role rows:

```text
Shield x1
Wield  x1
Hold   x3
```

The structural row counts enforce at most one Shield and at most one Wield.
Each picker requests items whose authoritative capability set contains that
row's role. An item capable of both Wield and Hold appears in both relevant
pickers, but after selection its saved `item.slot` remains the chosen equipment
row. No item automatically occupies every location it supports.

The current hand-role Slot Filter inside the picker is removed because the
opened row and authoritative capability query now determine eligibility. Other
search, stat, sorting, and pagination controls remain unchanged.

Unique-wear validation applies across all equipped rows, including Shield,
Wield, and every Hold row. Two appearances of the same unique-wear item ID are
invalid even when placed in different eligible roles.

## Three-Hand Capacity

Legend characters have a pool of three hands rather than three independent
named hand slots. Shield, Wield, and Hold all consume from that shared pool:

- an ordinary occupied hand-role row costs one hand;
- an item marked `TwoHanded` costs two hands; and
- an empty row costs zero hands.

Thus three held items, Shield plus Wield plus Hold, or Shield plus a two-handed
weapon can each consume the full pool. The fixed Shield and Wield rows prevent
two shields or two wielded items, while a weapon explicitly capable of Hold may
be placed in a Hold row and still contributes its existing weapon effects.

When choosing a replacement, capacity is calculated after crediting the item
currently occupying that row. Occupied rows therefore remain available even
when all three hands are in use. Empty rows and individual picker choices are
disabled only when the proposed item would exceed the remaining capacity.

Previously saved impossible or over-capacity equipment is never silently
deleted. Builder loads it, displays the normal restriction warning, and lets
the player replace or remove the offending item.

## Saved-Builder Compatibility

The compact Builder format advances from version 6 to version 7. Version 7 has
37 equipment positions. It inserts one Shield position and one additional Hold
position alongside the existing hand-role positions.

Versions 1 through 6 must continue decoding against their original 35-position
slot order. After decoding, they upgrade by inserting an empty Shield row and an
empty third Hold row at the new positions. No existing item, lock flag, rune
charm, or later slot shifts position semantically. New encoding always writes
version 7 and exactly 37 positions.

The server-side Builder payload validator, account storage path, local
persistence, import/export, migrations, and shared client/server codec all use
the same version-specific layout rules. Existing stored profiles remain valid
and are rewritten as version 7 only through the normal save flow.

## Failure Handling and Observability

- Schema migration failure aborts startup rather than serving mixed scalar and
  mask behavior.
- A malformed stored mask is reported as a data-integrity error; it is not
  silently replaced by the primary slot.
- Invalid mutation input identifies `slots` as the failing field.
- An unsupported future Builder list version continues to fail as an invalid
  list rather than being partially decoded.
- Existing request logging and error handling remain in place; slot masks and
  Builder strings contain no secrets and need no additional sensitive logging.

## Testing

Use test-driven development with focused failing tests before each production
change. Coverage includes:

- migration of singleton slots and Wield + `Holdable` rows without changing IDs;
- preservation of duplicate-looking item rows;
- mask encode/decode, canonical ordering, validation, `Other` exclusivity, and
  primary-slot retention/fallback;
- GraphQL output and create/update compatibility behavior;
- Item Search filtering by every member capability, with no inferred Shield,
  Wield, or Hold matches;
- multi-slot editor rendering, validation, submission, and weapon-field
  visibility;
- item details and search rendering all slots;
- five Builder hand rows and role-specific eligibility;
- three-hand capacity, two-handed costs, replacement credit, and unique-wear
  validation across hand roles;
- preservation-with-warning of an existing over-capacity build;
- decoding all legacy Builder fixtures without semantic movement, upgrading to
  one empty added Hold, and stable version-7 round trips; and
- server payload validation for both legacy and version-7 profiles.

Completion verification runs the focused database/API/client tests, the full
web unit suite, Builder browser tests, accessibility checks affected by the new
control and row, CSS lint, migration checks against representative existing
data, and repository diff checks. Unrelated pre-existing failures are reported
accurately rather than attributed to this change.

## Player Documentation

Update root `CHANGELOG.md` in player-friendly language to explain that items can
have several valid wear locations and that Builder now models all three hands,
including Shield, Wield, and two-handed capacity.

## Acceptance Criteria

- One item row can store and expose every eligible Hub slot.
- Every existing item row and ID survives migration unchanged.
- Only legacy Wield + `Holdable` gains an inferred Hold capability.
- Item Search and Builder match authoritative slot membership.
- Builder offers Shield, Wield, and three Hold rows sharing three hand units.
- A selected multi-slot item occupies only its chosen Builder row.
- At most one Shield and one Wield can be equipped.
- Two-handed items consume two hand units, including when used in Hold.
- Legacy Builder versions decode without shifting equipment and upgrade with an
  empty Shield row and an empty third Hold row.
- Existing over-capacity builds remain recoverable and visibly invalid.
- Player-facing item views, editing, and changelog describe multiple slots.
- No JSON spool consumer, item deduplication, image publication, push, tag, or
  deployment is included without separate authorization.
