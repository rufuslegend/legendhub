# Builder shared column layouts — design

Date: 2026-10-15
Branch: `feat/builder-shared-columns`, cut from `fix/builder-import-selection` at `705391e`.

## Problem

A player reported: "When you import a build from someone else, it just goes with default columns, instead of what would have been shown in the build."

The Builder export string (`7*<build>*<build>*`) carries character name, variant name, base stats, KSM stats, selections, quest resources, era abilities, and item IDs. Column visibility is not part of a build. Column choices are stored per character outside the string: anonymous players keep an `sc-<character name>` cookie (falling back to the Items-search `sc2` cookie, then stat defaults); verified accounts keep `builderColumns[profileId]` in account preferences (falling back to `itemColumns`, then defaults).

When an import creates a character the importer has never had, no saved columns exist for it, so the Builder shows the fallback columns. `fix/builder-import-selection` now opens the imported character immediately and loads the importer's own saved columns for that name, which makes the fallback visible right away.

## Goal

A build shared from one player to another opens with the column layout the sharer had on screen, for characters the importer does not already have. Existing import strings keep working unchanged.

## Non-goals

- Changing column order or adding column preferences to saved builds (cookies, account payloads).
- A Share button or URL-based sharing.
- Changing how existing characters' column preferences are stored or synced.

## Export format

`BUILDER_LIST_VERSION` stays 7. A new `BUILDER_SHARE_VERSION = 8` is used only by the Export fields. A version 8 string is:

```
8*<build segment>*<build segment>*...*<column segment>*<column segment>*
```

- Build segments are unchanged from version 7 (same slot order, same rune charm indexes).
- A column segment is `~<character name>~<Short>-<Short>-...`. It begins with `~`, which a build segment can never do because `takeName` requires at least one character before its first `~`. Column shorts are the `ItemStatInfo.Short` values already used by the `sc-*` cookies and account preferences (for example `Name-Ac-Hit-Dam-Ma Redux`). Shorts contain letters, digits, and spaces, never `-`, `~`, or `*`.
- Column segments follow all build segments. At most one segment per character name. A character with no known columns has no segment.
- Column segments are optional. `8*<build>*` with no column segments is valid.

Only the three Export fields (All Lists, Current List, Current Variant) emit version 8 strings with column segments. Saved payloads (cookie `cln`, account profile payloads, sync baselines) continue to be written by `encodeBuilderLists` at version 7 with no column segments, so stored `payloadVersion` values and the server's canonical form are unchanged. The decoder accepts version 8 and parses its build segments with the version 7 layout.

### Column sources at export time

| Character | Anonymous mode | Account mode |
|---|---|---|
| Selected character | columns currently shown (`state.statInfo`) | columns currently shown |
| Other characters (All Lists only) | `sc-<name>` cookie if present | `builderColumns[profileId]` if present |

Characters with no entry get no column segment. The `sc2` / `itemColumns` fallbacks are not exported, since they are the importer's own Items-search preference, not a per-build layout.

## Codec changes (`www/shared/builder-codec.mjs`)

- `BUILDER_SHARE_VERSION = 8`; `BUILDER_LIST_VERSION` remains 7.
- `decodeEntries` accepts versions 1 through `BUILDER_SHARE_VERSION`. Segments beginning with `~` are parsed as column segments when `version >= 8` and rejected (`Invalid list.`) for older versions, where they could only be corrupt input. A column segment with a malformed name or an empty column list is rejected. Column shorts are not validated against the stat list in the codec; the client drops unknown shorts when applying them so a string from a newer site still imports.
- New export `decodeBuilderShare(value)` returns `{entries, columns}` where `entries` is the result of `decodeBuilderEntries` and `columns` is a plain object mapping character name to an array of shorts. `decodeBuilderEntries` and `decodeBuilderLists` keep their current return shapes and ignore column segments, so the server-side payload decoder and existing callers are unaffected.
- New export `encodeBuilderShare(lists, columnsByCharacter)` returns the version 8 string with column segments appended for each character in `columnsByCharacter` that has at least one column. `encodeBuilderLists` is unchanged apart from the version constant.
- The client wrapper `www/client/features/builder/builder-encoding.js` re-exports the new functions.

## Builder changes (`www/client/features/builder`)

### Export dialog (`Builder.jsx` `exportValue`)

Build `columnsByCharacter`:
- selected character: `state.statInfo.filter(showColumn).map(short)`;
- other characters: `cookies()[`sc-${name}`]` in anonymous mode, or `preferenceStore.get().document.builderColumns[character.account.id]` in account mode, when present.

Each of the three export fields is produced with `encodeBuilderShare`, passing only the characters that field contains.

### Import dialog (`importChange`, `submitImport`, `lists/import`)

- `importChange` decodes with `decodeBuilderShare` and stores `columns` on `importModel` alongside `lists`. The collision table and `exists`/`overwrite` logic are unchanged.
- `submitImport` dispatches `lists/import` with `lists` and `columns`.
- In `action()`, the existing step that loads destination columns for an imported character name is extended: if the first imported entry creates a character that does not exist in `allLists` and `columns[name]` is present, the Builder applies `applySelectedColumns(columns[name], defaultStatInfo)` instead of the destination cookie lookup. Unknown shorts fall out naturally because `applySelectedColumns` only matches shorts present in `statInfo`. If the imported character already exists (overwrite or added variant), the current behavior stands: destination columns for that character, or fallbacks.
- This applies in both storage modes. In anonymous mode the existing persistence effect writes `sc-<name>` from `statInfo`, so the shared columns become that character's saved layout. In account mode the existing preference effect saves `builderColumns[profileId]` once the new profile has an id; implementation must verify that the first sync of a newly created profile persists the shared columns rather than overwriting them with the preference fallback, and add a test for it.

### Reducer

`lists/import` already selects the imported character and variant. Column application stays in `action()`, next to the existing destination-column step, so the reducer does not need `columns`.

## Documentation

- `CHANGELOG.md`, under the current `[4.0.0-beta]` heading, `Changed` or `Added`: exported Builder lists now include each character's column layout, and importing a character you do not already have shows the sharer's columns. Older export strings still import.
- `docs/user-manual.md`, "Export, import, and share builds": note that export strings carry the column layout shown for each character, that importing a new character applies that layout, and that importing into an existing character keeps your own columns.

## Testing

- `www/test/client/builder-encoding.test.js` (or a new codec test file): version 8 round trip with and without column segments; version 7 strings still decode with no columns; `~` segment in a version 7 string is rejected; multiple characters each get their own segment; shorts with spaces survive; `decodeBuilderLists` ignores column segments.
- `www/test/client/builder-reducer.test.js` or a Builder-level test: new character import applies shared columns; overwrite of an existing character keeps destination columns; unknown shorts are dropped.
- `www/e2e/builder-transfer.spec.js`: export a build with a non-default column set, clear local data (or use a second context), import it, and assert the sharer's columns are visible and the destination fallback columns are not.
- Server: no change. `validateBuilderProfile` canonicalizes through `encodeBuilderLists`, so a client that pastes a share string as a profile payload gets its column segments stripped and `payloadVersion` stays 7.

## Risks

- Any external tool that parses export strings by version number will see `8*`. None is known. Version 7 strings remain valid input.
- Column shorts are coupled to `ItemStatInfo.Short`; renaming a stat would silently drop that column from old shared strings. This matches how cookies already behave.
