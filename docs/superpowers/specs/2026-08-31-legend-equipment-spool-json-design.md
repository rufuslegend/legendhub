# Legend Equipment Spool JSON Design

**Date:** 2026-08-31
**Status:** Approved design

**Phase boundary:** This document is a producer contract only. No LegendHUB consumer, database, or spool implementation is authorized yet.

## Purpose

Legend will publish player-submitted equipment observations to a shared filesystem. LegendHUB will consume each observation, validate it, record its provenance, and expose every distinct official variant as its own item row.

This contract is deliberately independent of LegendHUB's current MySQL column names and numeric lookup values. Legend emits readable game concepts; LegendHUB owns normalization and storage.

Version 1 covers raw equipment only. It does not link equipment to mobs, quests, areas, or other acquisition metadata.

## Ownership and spool layout

The MUD and LegendHUB run on the same host and share this filesystem:

```text
/var/spool/legendhub/
|-- incoming/
|-- processing/
|-- processed/
`-- rejected/
```

- Legend may create files only in `incoming/` and never reads from the spool.
- LegendHUB claims completed files from `incoming/` and owns every subsequent directory.
- Directories use group `legendhub`, mode `2770`, and the setgid bit.
- Legend creates files group-readable and group-writable, normally mode `0660` via `umask 007`.
- Legend writes `incoming/.eq-<submission-id>.json.tmp`, closes it, and atomically renames it to `incoming/eq-<submission-id>.json`.
- The temporary and final paths must reside on the same mounted filesystem. LegendHUB considers only non-hidden `*.json` files complete.
- A submission ID used in a filename must contain only ASCII letters, digits, `.`, `_`, or `-`, begin with a letter or digit, and be at most 128 characters.

## Version 1 document

One file contains one JSON object and one equipment observation.

```json
{
  "schema_version": 1,
  "event_type": "equipment.observed",
  "submission": {
    "id": "018f8f29-7e62-7bf0-a8f4-6d44f1439a40",
    "submitted_at": "2026-08-31T14:25:36Z",
    "submitted_by": {
      "character": "Rufus",
      "account_id": "optional-stable-account-id"
    }
  },
  "source": {
    "server": "legend"
  },
  "item": {
    "vnum": 1234,
    "name": "twisted silver ring",
    "slots": ["finger"],
    "alignment": "none",
    "flags": {
      "unique_wear": false,
      "limited": false,
      "heroic": false,
      "soulbound": false,
      "bonded": false,
      "light": false,
      "holdable": false,
      "two_handed": false
    },
    "requirements": {
      "level": 0
    },
    "attributes": {
      "strength": 0,
      "mind": 2,
      "dexterity": 3,
      "constitution": 0,
      "perception": 0,
      "spirit": 0
    },
    "attribute_caps": {
      "strength": 0,
      "mind": 0,
      "dexterity": 0,
      "constitution": 0,
      "perception": 0,
      "spirit": 0
    },
    "resources": {
      "hp": 0,
      "mana": 0,
      "movement": 0,
      "hp_regen": 0,
      "mana_regen": 0,
      "movement_regen": 0
    },
    "combat": {
      "armor_class": -2,
      "hitroll": 0,
      "damroll": 0,
      "spell_damage": 0,
      "spell_critical": 0,
      "mana_reduction": 0,
      "concentration": 0,
      "mitigation": 0,
      "parry": 0,
      "damage_shield": 0,
      "melee_critical_percent": 0,
      "melee_critical": 0,
      "melee_damage_cap": 0
    },
    "weapon": {
      "type": null,
      "governing_attribute": null,
      "accuracy": 0,
      "ranged_accuracy": 0,
      "ammo_limit": 0,
      "quality": 0,
      "speed_factor": 0,
      "minimum_damage": 0,
      "maximum_damage": 0,
      "average_damage": 0
    },
    "economy": {
      "rent": 436,
      "value": 436,
      "weight": 0.0
    },
    "casts": [],
    "raw_text": "optional exact equipment output for diagnostics"
  }
}
```

## Field rules

Every property shown above is required except `submission.submitted_by.account_id` and `item.raw_text`. Every object is closed: fields not defined by this version are rejected rather than silently discarded.

- `schema_version` is the integer `1`.
- `event_type` is the string `equipment.observed`.
- `submission.id` is an opaque, non-empty string of at most 128 characters containing only ASCII letters, digits, `.`, `_`, or `-`, and beginning with a letter or digit. UUID is recommended but not required. LegendHUB does not derive meaning from it.
- `submission.submitted_at` is an RFC 3339 UTC timestamp ending in `Z`.
- `submission.submitted_by.character` is a non-empty string of at most 60 characters.
- `submission.submitted_by.account_id`, when present, is an opaque, non-empty string of at most 128 characters.
- `source.server` is a lowercase ASCII slug of at most 32 characters, such as `legend` or `testmud`.
- `item.vnum` is a non-negative 32-bit integer. It identifies the underlying item definition, so generated variants share a vnum.
- `item.name` is a non-empty string of at most 255 Unicode code points after color-code removal and normalization. Legend must never truncate a name to satisfy the limit; it rejects an ineligible over-limit submission instead.
- `item.slots` is a non-empty array containing every location where the underlying item may be worn, not the location where this particular copy was observed. Each entry uses the slot vocabulary below. LegendHUB sorts and removes duplicates during normalization.
- All flag values are JSON booleans.
- All stat, requirement, damage, rent, and value fields are 32-bit JSON integers. Zero explicitly means no modifier; Legend must not omit zero-valued fields.
- `economy.weight` is a non-negative JSON number with at most two decimal places and a maximum value of `999.99`.
- `casts` is an array of strings. Each entry is non-empty after trimming and at most 50 characters.
- `raw_text`, when present, is a string of at most 65,535 characters. It is diagnostic evidence and does not affect duplicate detection.
- JSON `null` is allowed only for `weapon.type` and `weapon.governing_attribute`, where it means the property is not applicable.
- The entire file must be valid UTF-8 and must not exceed 256 KiB. Legend strips MUD color codes before emitting names and converts source text to valid Unicode. Undecodable diagnostic text may use the Unicode replacement character, but an undecodable item name is rejected rather than truncated or guessed.

LegendHUB calculates derived values such as net stat. Legend does not send database IDs, an `official` flag, modification audit fields, community notes, mob IDs, or quest IDs.

## Enum vocabulary

Each `item.slots` entry accepts:

```text
light, finger, neck, body, head, face, legs, feet, hands, arms, shield,
about, waist, wrist, wield, hold, ear, arm, amulet, aux, familiar, other
```

The distinct `arms` and `arm` values preserve Legend's two existing wear locations.

An item that can be worn in more than one location lists every applicable value in the same submission. The eventual LegendHUB storage and filters must preserve that complete set rather than collapsing it to the first slot.

`item.alignment` accepts:

```text
none, good-only, neutral-only, evil-only, non-good, non-neutral, non-evil
```

`item.weapon.type` accepts `null`, `bladed`, `piercing`, or `blunt`.

`item.weapon.governing_attribute` accepts `null`, `strength`, `dexterity`, or `constitution`.

Producers should emit the lowercase spelling. LegendHUB normalizes enum case before comparison but does not accept alternate wording.

## Identity, duplicates, and variants

The source item identity is `(source.server, item.vnum)`. The submission identity is `(source.server, submission.id)`.

LegendHUB creates two canonical hashes:

1. A submission payload hash over the canonical full JSON document. JSON property order and insignificant whitespace do not affect this hash.
2. An item fingerprint over the normalized `item` object, excluding `raw_text`.

Normalization:

- trims leading and trailing text whitespace;
- applies Unicode NFC normalization to text;
- lowercases enum values;
- converts negative zero to zero;
- represents weight to two decimal places;
- sorts and removes duplicates from `slots`; and
- trims, removes duplicates from, and lexically sorts `casts`.

Processing rules:

1. A previously accepted submission identity with the same payload hash is an idempotent replay. It creates nothing new.
2. A previously accepted submission identity with a different payload hash is rejected as an ID collision.
3. An existing official source item with the same vnum and item fingerprint is a duplicate observation. The submission is recorded against the existing item row.
4. The same vnum with any different normalized item field creates a new official variant row.
5. Name, complete slot set, flags, stats, requirements, weapon values, casts, rent, value, and weight all participate in the item fingerprint.
6. Matching a community item never converts or overwrites it. LegendHUB creates or reuses a separate official item row.

This intentionally implements the initial rule that any normalized difference is a variant. Fingerprint calculation is isolated so that policy can change without changing the producer document.

## Producer eligibility gate

LegendHUB cannot reliably distinguish permanent item-definition data from temporary player alterations after receiving a normalized observation. Producer-side eligibility is therefore a load-bearing part of version 1: LegendHUB trusts Legend to keep ineligible objects out of the spool.

Legend initially refuses submission of:

- strung or otherwise player-renamed items;
- rune-created items;
- items carrying temporary player-created effects;
- objects without a sane non-negative vnum; and
- any object covered by later producer eligibility restrictions.

Legend reports an in-game error instead of creating a spool file for an ineligible object. It also emits no file if it cannot obtain enough entropy for a strong unique submission ID.

## MySQL ownership

The physical names may follow repository conventions, but storage must provide these three logical records:

1. **Item row:** one player-visible `Items` row per distinct official variant, with an official marker available to Item Search and Builder filtering. Storage preserves names up to 255 Unicode code points and every listed wear slot; Item Search and Builder consider the item eligible for each of those slots.
2. **Official source variant:** a one-to-one record containing the item row ID, source server, vnum, item fingerprint, first-seen time, last-seen time, and observation count. `(server, vnum, fingerprint)` is unique.
3. **Submission:** one record per submission identity containing the payload hash, canonical JSON payload, source timestamp, receiving timestamp, submitter attribution, and resolved item row ID. `(server, submission ID)` is unique.

The database transaction records the submission and finds or creates its official variant atomically. Duplicate observations update last-seen time and observation count while retaining their individual submission records.

## Consumer workflow

1. Poll `incoming/` for non-hidden `*.json` files.
2. Atomically rename one file into `processing/` to claim it.
3. Enforce the file-size limit, decode UTF-8, parse JSON, and validate the complete versioned contract.
4. Canonicalize the submission and item, then calculate their hashes.
5. In one MySQL transaction, enforce submission idempotency, find or create the official variant, and record the submission.
6. Commit the transaction.
7. Move the original file to `processed/`.

The consumer may use filesystem notifications as a latency optimization, but polling is authoritative because shared-filesystem notifications are not reliable enough to be the only trigger.

## Failure and recovery

- Validation or database failure rolls back the transaction and moves the original file into `rejected/`.
- A rejected file receives a sibling `<filename>.error.json` containing a stable error code, a human-readable message, the failure time, and field paths when applicable. It contains no stack trace or secrets.
- Corrected input uses a new submission ID. An accepted submission ID is never repurposed.
- On startup, the sole consumer moves every file stranded in `processing/` back to `incoming/`.
- While running, the consumer also requeues a processing file older than 15 minutes. A valid 256 KiB ingestion is expected to finish well inside that lease.
- A crash before database commit therefore retries cleanly. A crash after commit but before the final file move becomes an idempotent replay and then completes the move.
- Multiple concurrent consumers are outside version 1. Introducing them requires an explicit lease owner rather than changing the JSON contract.

Completed-file defaults are operationally configurable: gzip files after one day and delete them after 30 days. Rejected files and their error records are retained for 90 days. MySQL remains the durable record.

## Schema evolution

Version 1 is immutable. A new field or changed interpretation introduces a new integer `schema_version`. LegendHUB may accept multiple versions concurrently and normalize them into its current storage model. It rejects unsupported versions rather than guessing or partially ingesting them.

## Acceptance tests

Implementation is complete when automated tests demonstrate:

- acceptance of a complete version-1 fixture and every allowed enum value;
- rejection of malformed JSON, oversized files, invalid UTF-8, missing fields, unknown fields, invalid enums, invalid timestamps, and out-of-range values;
- producer rejection of altered items, invalid vnums, over-limit names, and failed strong-ID generation without creating spool files;
- idempotent replay of an identical submission;
- rejection of one submission ID carrying different content;
- reuse of an existing official item for an identical vnum and fingerprint;
- creation of a separate official variant for every normalized item difference;
- creation of a separate official row when only a matching community row exists;
- exclusion of submission metadata and `raw_text` from variant comparison;
- deterministic canonicalization regardless of JSON key order, formatting, slot order, cast order, enum case, or negative zero;
- transactional rollback without partial rows;
- recovery before commit and after commit;
- startup and stale-file recovery from `processing/`;
- rejected-file error sidecars without sensitive details; and
- Item Search and Builder filtering by official status.
