# Builder Era Abilities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add metadata-driven era-ability ranks to Builder variants and apply their persistent stat effects automatically.

**Architecture:** `game-stats.js` owns the ordered ability catalog, rank normalization, and additive effects. The Builder controller consumes that API for defaults, stat totals, attribute caps, and version-6 serialization; the EJS template renders rank selectors from the same catalog.

**Tech Stack:** AngularJS, browser/CommonJS JavaScript, EJS, Node.js built-in test runner

**Spec:** `docs/superpowers/specs/2026-08-19-builder-era-abilities-design.md`

## Global Constraints

- Track exactly the eight persistent stat-changing abilities listed in the spec.
- Keep faux-object bonuses additive and unchanged.
- Preserve imports of unversioned and version 1 through 5 Builder codes.
- Use Builder save-code version 6 for era-ability ranks.
- Treat root `docker-compose-prod.yaml` as out of scope.
- Do not publish, deploy, tag, or push without separate authorization.
- Record the player-facing feature in root `CHANGELOG.md` for 2.9.0-beta.

---

### Task 1: Era ability catalog and calculations

**Files:**
- Modify: `www/src/public/js/services/game-stats.js`
- Test: `www/test/game-stats.test.js`

**Interfaces:**
- Produces: `getEraAbilities() -> Array<AbilityMetadata>` returning isolated metadata copies
- Produces: `getDefaultEraAbilityRanks() -> Record<string, number>`
- Produces: `normalizeEraAbilityRanks(ranks) -> Record<string, number>`
- Produces: `calculateEraAbilityBonus(statName, ranks) -> number`
- Produces: `calculateEraAbilityStatCapBonus(ranks) -> number`

- [ ] **Step 1: Write failing catalog and normalization tests**

Add tests with hand-written expectations for the eight stable keys, eras, maximum
ranks, default zero values, copy isolation, and normalization of missing,
fractional, negative, excessive, and non-numeric ranks.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/game-stats.test.js`

Expected: FAIL because the era-ability API does not exist.

- [ ] **Step 3: Implement the minimal catalog and normalization API**

Add one ordered private catalog and export copy-producing accessors. Normalize
each known rank with `Number`, `Math.trunc`, and clamping from zero through the
ability's maximum; ignore unknown input keys.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test test/game-stats.test.js`

Expected: PASS.

- [ ] **Step 5: Write failing effect tests**

Use literal rank fixtures to assert:

```text
Hardened Skin rank 5       ac -15
Increased Potential rank 4 attribute cap +4
Physical Endurance rank 3 hp +30
Mental Enhancement rank 3 mana +30
Physical Enhancement rank 3 move +60
Weapon Focus rank 1       hit +5, dam +5
Innate Regeneration rank 3 hpr/mar/mvr +3
Arcane Focus rank 5       spelldam/spellcrit +5
```

Also assert an unrelated stat receives zero and excessive input ranks are
normalized before calculation.

- [ ] **Step 6: Run the focused test and verify RED**

Run: `node --test test/game-stats.test.js`

Expected: FAIL because effect calculation is missing.

- [ ] **Step 7: Implement metadata-driven effect calculation**

Store per-rank effects in the catalog and sum normalized selected ranks for the
requested stat. Return Increased Potential's normalized rank as the shared base
attribute cap bonus.

- [ ] **Step 8: Run the focused test and verify GREEN**

Run: `node --test test/game-stats.test.js`

Expected: PASS.

### Task 2: Builder totals and version-6 persistence

**Files:**
- Modify: `www/src/public/js/controllers/builder/main.js`
- Test: `www/test/builder-game-stats.test.js`

**Interfaces:**
- Consumes: all Task 1 `gameStats` era-ability APIs
- Produces: `selectedList.eraAbilities: Record<string, number>` on every variant
- Produces: version-6 export/import with eight ordered rank characters

- [ ] **Step 1: Write failing Builder calculation tests**

Extend the real controller harness so fixtures have default era ranks, then assert
all eight abilities change their final Builder columns by the literal values in
Task 1 while existing equipment and Other-slot values remain additive. Add a
separate test proving Increased Potential rank 4 changes a raw 110 attribute with
a +4 item cap from a final 104 to 108 and that dependent calculations use 108.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/builder-game-stats.test.js`

Expected: FAIL because the controller does not apply era ranks.

- [ ] **Step 3: Implement defaults, totals, and caps**

Expose isolated catalog metadata and era names on `$scope`, add default ranks to
new and imported variants, sum `calculateEraAbilityBonus()` into number totals,
and add `calculateEraAbilityStatCapBonus()` to every base-attribute maximum.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test test/builder-game-stats.test.js`

Expected: PASS.

- [ ] **Step 5: Write failing version-6 persistence tests**

Add a round-trip fixture containing distinct valid ranks and an item sentinel.
Assert the `6*` prefix, exact imported rank map, and unchanged item position. Add
tests rejecting truncated, non-alphanumeric, and above-maximum rank blocks. Extend
each legacy import assertion to require the full default-zero rank map.

- [ ] **Step 6: Run the focused test and verify RED**

Run: `node --test test/builder-game-stats.test.js`

Expected: FAIL because the current format is version 5.

- [ ] **Step 7: Implement version-6 persistence**

Set `listVer` to 6. Serialize normalized ranks in catalog order after the nine
quest-resource characters. For version 6, require exactly one base-62 character
per catalog entry, decode it, reject values above each entry's maximum, and then
parse item slots. For older versions, retain zero defaults and existing offsets.

- [ ] **Step 8: Run the focused test and verify GREEN**

Run: `node --test test/builder-game-stats.test.js`

Expected: PASS.

### Task 3: MVP controls and changelog

**Files:**
- Modify: `www/src/views/builder/index.ejs`
- Modify: `www/test/builder-game-stats.test.js`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `$scope.eraAbilityEras`, `$scope.eraAbilities`, and `selectedList.eraAbilities`
- Produces: grouped rank selectors that persist through existing client-side saving

- [ ] **Step 1: Write a failing UI structure test**

Assert the Builder template contains an `Era Abilities` section after quest
resources, iterates the three era groups and shared metadata, binds each selector
to `selectedList.eraAbilities[ability.key]`, offers `None` plus metadata-derived
ranks, and invokes `saveClientSideData()` on changes.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/builder-game-stats.test.js`

Expected: FAIL because the controls are absent.

- [ ] **Step 3: Implement the compact metadata-driven controls**

Add one Bootstrap-compatible block below quest resources. Use `ng-repeat` for
eras, filtered ability metadata, and each ability's rank options. Do not add custom
styling during the MVP UI pass.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test test/builder-game-stats.test.js`

Expected: PASS.

- [ ] **Step 5: Add the player-facing changelog entry**

Create the 2.9.0-beta section and explain that Builder characters can record
stat-changing era abilities and receive their bonuses automatically instead of
using faux objects.

- [ ] **Step 6: Run complete verification**

Run:

```bash
cd www
npm test
cd ..
git diff --check
git status --short
```

Expected: 173 existing tests plus the new tests pass, with the one existing
integration skip; diff check is clean and only planned files are modified.

- [ ] **Step 7: Commit the completed MVP**

```bash
git add CHANGELOG.md \
  docs/superpowers/specs/2026-08-19-builder-era-abilities-design.md \
  docs/superpowers/plans/2026-08-19-builder-era-abilities.md \
  www/src/public/js/services/game-stats.js \
  www/src/public/js/controllers/builder/main.js \
  www/src/views/builder/index.ejs \
  www/test/game-stats.test.js \
  www/test/builder-game-stats.test.js
git commit -m "feat: track builder era abilities"
```
