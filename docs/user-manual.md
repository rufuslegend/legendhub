# LegendHUB User Manual

## Welcome and Quick Start

### Get oriented

LegendHUB is a community reference and character-planning site for LegendMUD. You can browse game information and use the character planner without an account. Records may be maintained by community contributors or imported from LegendMUD; an **Official item** notice identifies imported equipment managed from game data. Because community information can be incomplete or mistaken, confirm anything critical in the game.

This manual covers player and community-contributor tasks. It does not cover site administration, deployment, database maintenance, importer operation, or permission management.

Start in the area that matches your task:

- [Builder](/builder/) plans a character's stats, quest choices, era abilities, and equipment.
- [Items](/items/) searches equipment by name, properties, and stat expressions.
- [Mobs](/mobs/) browses creatures by era and area.
- [Quests](/quests/) finds quest information, including stat quests.
- [Wiki](/wiki/) contains categorized community reference pages.

No account is needed to read these catalogs. The Builder can also keep profiles in this browser after you accept storage consent. A verified account adds synchronized Builder storage and account-backed preferences.

Use [Login](/login.html) to sign in or register. See the [Changelog](/changelog) for recent site changes, or [Send Feedback](/feedback.html) when something is incorrect or not working.

## Finding Game Information

### Browse and open records

Items, Mobs, Quests, and Wiki pages show **Recently Modified** records when no search or category is active. Results are displayed 20 at a time. Use the paging controls above or below a result table, and select a column heading to change the sort. A record's main link opens in the same tab; its external-link action opens the same details in a new tab.

Mob, Quest, and Wiki category lists become overlays on narrow screens. Open the areas or categories control, choose an entry, and close the overlay when you are finished.

### Search Items

Enter an ordinary name, a stat expression, or a name followed by a comma and a stat expression, then select **Search**. Advanced expression rules and examples are in [Item-search expression syntax](#item-search-expression-syntax).

Use **Filters** to choose the available item properties and **Columns** to control the result table. Filter changes do not affect the current results until the next **Search**. The **Name** column is mandatory. Other visible columns persist in account preferences for a verified account, or in the browser after cookie consent. Search terms, filters, sorting, and page are placed in the URL, so you can copy that URL to share or revisit the search.

When **Pop-up stat windows** is on, rest a non-touch pointer over an item name or move keyboard focus to it for two seconds to open a stat preview. Move into the preview to keep it open, or press Escape to dismiss it. Touch input does not open previews; use the item link instead.

### Read Item details

An Item page shows every eligible slot, the item's displayed stats and alignment, any notes, and linked Mob or Quest records. A single item may be eligible for multiple slots. The history control lists earlier revisions with their modifier and date, while the current modifier and date appear in the toolbar.

Imported equipment carries an **Official item** notice. When attribution is available, its visible credit follows the template `Submitted by <name> via LegendMUD Import`. Official status means the record is managed from LegendMUD data, not that every community record has been game-verified.

### Search Mobs, Quests, and Wiki pages

- **Mobs:** choose an era and area, or search by name. Results can be sorted by the displayed Name, Area, Experience, Gold, and Agg columns.
- **Quests:** choose an era and area, optionally turn on the **Stat** filter, or search title, whois, area, or content.
- **Wiki:** choose a category and, where available, a subcategory, or search title, tags, or content. A lock icon marks a locked page. Pinned results use the highlighted pinned styling in recent or search results.

Each details page includes its public modification date and contributor name, plus a history control when revisions exist.

## Using the Character Builder

### Understand where builds are saved

The [Builder](/builder/) has two storage modes:

- Without verified account storage, profiles are browser-local. Persistence requires cookie consent, and the status reads **Saved in this browser**. The data belongs to that browser profile and is not automatically available on another device or browser.
- With a verified account, the Builder loads synchronized profiles and account preferences. Changes autosave; **Saving…** and **Saved to account** report progress. There is no separate Save button.

Signing in does not silently merge browser-local profiles into the account. When eligible local data exists, select **Review local Builder data**, inspect the proposed copy, and then select **Copy all to my account**. Copying preserves the originals in the browser. Results identify copied, renamed, deduplicated, or rejected profiles.

### Manage characters and variants

Use the **Character** selector and its actions to add, select, rename, or delete a character. The **Variant** selector manages alternative builds for that character and displays each variant's name. **Add Variant** immediately clones and selects the currently selected build, including its choices and equipment. Copies are named **Variant 1**, **Variant 2**, and so on, using the first available number for that character. Use **Edit Variant** whenever you want to give a copy a different name. You can select or delete variants and use **Set Variant as Primary** to move the selected variant into the primary position.

Deletion asks for confirmation. Keep an export before making broad changes you may want to reverse.

### Enter base stats, quest choices, and era abilities

Enter the six base attributes: Strength, Mind, Dexterity, Constitution, Perception, and Spirit. Tab and Shift+Tab move directly between these inputs without stopping at the stat quest information icons. Hover over an icon or focus its stat input to read the quest hint; press Escape while in the input to dismiss it. Screen readers can read the hint as part of the input's description. A valid base total is 198 or 244; the Builder displays a red message for another total.

Open **KSM Swap/Quest Mods** for KSM movement and quest choices. KSM changes must be zero-sum across the six attributes. The total absolute movement may be at most six points, which represents no more than three points moved from some attributes into others. Quest modifier choices are available for a base total below 244. Enter permanent resource bonuses in **Quest HP**, **Quest Mana**, and **Quest Mv**.

Open **Era Abilities** and choose the rank earned for each Ancient, Medieval, or Industrial ability. Rank limits and effects are listed in [Builder calculations](#builder-calculations).

### Choose and remove equipment

The equipment table has repeated positions for slots that can hold more than one item. Select an item name or any selectable stat cell in a position to open **Choose Item**. The slot column and lock control themselves do not open the picker.

The picker lists candidates eligible for that slot. Search within those candidates with the same expression language used by Items, select headings to sort, and use **Previous**, numbered pages, and **Next** when needed. The most recently selected heading is the primary sort; earlier heading selections remain as tie-breakers. Select the primary heading again to reverse its direction. Closing and reopening **Choose Item** clears this layered sort. The main Items page continues to use one sort heading at a time.

Select a candidate row or name to equip it. Select the `-` choice to remove the current item. Item names also provide a new-tab details action and, when enabled, the two-second stat preview.

Not every restriction is a filter. For example, slot candidates remain listed when equipping one would exceed hand capacity, but that choice is disabled with an explanation. A locked position also disables replacements. Other compatibility concerns, including alignment combinations and equipment warnings, are reported in the build rather than assumed to be filtered from every result.

### Manage three-hand capacity

**Shield**, **Wield**, and the three **Hold** positions share one three-hand pool. A normal item in any of those positions uses one hand; an item marked two-handed uses two. If all three hands are already occupied, an empty hand position cannot open **Choose Item**. Within an open picker, candidates that would raise usage above three hands are disabled.

This hand model is separate from the melee damage-cap rule: only an equipped two-handed **Wield** weapon adds 64 to the melee damage cap. A two-handed Hold item does not add that bonus.

### Lock, clear, and customize equipment

Use a position's lock control to protect it. The lock control in a **Total** row asks for confirmation before locking or unlocking all items. **Clear Items** also asks for confirmation and removes only unlocked equipment; locked items remain.

The **Runecraft Customizer** is offered in supported Neck and Wrist positions. Choose the rune charms and select **Save Runecharm** to place the customized item in that position.

### Read totals and warnings

The **Total** rows combine base and quest effects, era abilities, equipment, and modeled natural values. For Hit, Dam, HPR, MAR, MVR, Spell Damage, and Spell Critical, a parenthetical value is the capped contribution from normal equipment. Other additive sources are included in the leading total.

Red cells and question-circle help identify restrictions. Common warnings include:

- **Unique:** the same unique-wear item cannot be equipped twice.
- **Wield weight:** a Wield item requires Strength of at least four times its weight.
- **Limited:** no more than three limited items can be equipped.
- **Hands:** Shield, Wield, and Hold choices cannot exceed three hands in total.
- **Caps:** a normal-equipment or overall contribution exceeded the displayed limit and the Builder used the capped amount.
- **Alignment:** `ERROR` means the equipped restrictions leave no compatible Good, Neutral, or Evil alignment.

After a successful item-data refresh, a saved item ID that cannot be found may appear as `DELETED`. Treat that as a cue to check the item and refresh rather than as proof of a general deletion rule. If item details fail to load at all, the Builder retains the encoded build and asks you to retry instead of replacing the saved data with an empty build.

### Export, import, and share builds

Select **Export** and copy the scope you need:

- **All Lists**
- **Current List (w/ all variants): &lt;character&gt;**
- **Current List Variant: &lt;variant&gt;**

These values are encoded text. To back up or share a build, copy the chosen string and store or send it yourself; there is no Share button.

Select **Import**, paste a **Builder list import string**, and review any name collisions. Existing character-and-variant collisions are listed with selectable **Overwrite?** choices, so you control which existing variants may be replaced. An invalid string is rejected. If imported item details cannot load, keep the encoded string and use the offered retry path rather than repeatedly changing the source text.

Synchronized Builder storage is limited to 10 MB. Network failures are retried for a short period. If a sync conflict occurs, the newer account copy is kept and your edits are saved as a conflict copy. For a quota, revision, generation, or persistent sync error, changes remain in memory: select **Export Builder data** before **Reload account data** or before closing the page.

## Accounts and Preferences

### Register, verify, and sign in

Open [Login](/login.html), expand **Register**, and enter a username, email, password, and confirmation. Use the verification link sent by email. In [Account Settings](/account/), **Change** or add an email by entering the new address and current password. A replacement address stays pending until verified; **Resend verification** sends another link.

Sign in with your username or a verified email address. **Stay logged in** keeps the session across browser sessions. Use **Logout** from the account menu to end it.

Account Settings can change a password after you enter the current password. If you cannot sign in, use **Forgot password?** and follow the emailed recovery link. Email verification is required for email-based recovery and synchronized Builder storage.

### Review synchronized Builder storage

Verified accounts show **Builder storage** as an amount **of 10 MB used**, plus the synchronized profile count and storage version. **Export all Builder data** downloads a fresh encoded backup. **Delete all synced Builder data** opens a confirmation before permanently deleting synchronized profiles. That action does not change browser-local copies saved anonymously in the same browser.

### Choose display preferences

Use the palette menu to choose Light, Dark, Solarized Dark, High Contrast, or a Glass theme in Blue, Emerald, Ruby, Amethyst, or Amber. Dark is the default. With a verified account the selection follows account preferences; otherwise persistence in the browser requires cookie consent.

Account Settings also controls equipment displays:

- **Pop-up stat windows** defaults to **On**.
- **Hide zeros in equipment tables** defaults to **Off**. When turned on, zero-valued numeric equipment cells are hidden, but **Rent** remains visible even when it is zero.

### Choose notifications and privacy settings

The eight notification choices are **Item Added**, **Item Updated**, **Mob Added**, **Mob Updated**, **Quest Added**, **Quest Updated**, **Wiki Page Added**, and **Wiki Page Updated**. Set each independently to **On** or **Off** and save the notification settings.

LegendHUB uses cookies for login, consent, and preferences, and browser storage for browser-local Builder content. Review the [Privacy Policy](/privacy.html) and [Cookie Policy](/cookies.html) for what is handled and how to control it. Without cookie consent, LegendHUB does not save browser-local Builder data or new browser-only preference changes.

## Contributing Information

### Add or edit community records

You must sign in to add, edit, or restore ordinary Items, Mobs, Quests, and Wiki pages; email verification is not required for those ordinary contributor actions. Use the plus action on a catalog to add a record, or **Edit** on its details page. These editors expose:

| Record | Visible fields |
| --- | --- |
| Item | One or more Slots; the currently configured editable stat and property fields; an optional related Mob; an optional related Quest; Notes |
| Mob | Name, Area, Xp, Gold, Aggro, Notes |
| Quest | Title, Area, Whoises, Stat Quest, Content |
| Wiki page | Title, Category, optional required Subcategory, Tags, Content |

Item fields are grouped by the categories currently shown. Weapon-only fields appear when Wield or Hold is among the selected slots. The item relationship controls let you search for a Mob or Quest and link it to the item; check that a related record does not already exist before adding another.

Quest Whoises and Wiki Tags use semicolons between multiple values. Notes and Content fields support Markdown and emoji and display a live **Preview** before you save.

### Review and restore history

Details pages show the current modifier and date. Open the history control to inspect previous revisions, also labeled with modifier and date. While signed in, open an earlier ordinary-record revision and select **Use this version** to restore its content as the current version.

Deleting a record requires additional permission and asks for confirmation. If the delete action is not present, signing in alone does not grant it.

Official imported equipment is protected from editing, deletion, and revision restoration for now. Its details banner says `Official item. Managed from Legend game data. Editing is unavailable for now.` and, when attribution exists, shows `Submitted by <name> via LegendMUD Import`. LegendHUB has no player-facing form for submitting official imports.

## Troubleshooting

### Recover missing or unsaved Builder data

- **Browser data is missing:** return to the same browser profile in which it was created. Confirm that cookie consent was accepted and that site cookies and storage were not cleared. Consent must exist before LegendHUB reads or writes browser-local Builder data.
- **Data changed after signing in or out:** a verified account uses synchronized storage, while a signed-out or ineligible session uses browser-local storage. These stores are separate. Sign back into the intended mode, or use **Review local Builder data** and **Copy all to my account** when the copy offer appears.
- **The Builder or item details did not load:** use **Retry** or refresh. On a hydration failure, the Builder keeps the encoded data and avoids saving an empty fallback. Export as soon as the data is available again.
- **Sync remains on a problem message:** allow the short automatic retry window to finish. If a conflict copy was created, compare it with the newer account copy. For quota, revision, or storage-generation messages, export the in-memory edits before selecting **Reload account data**. Reduce stored profiles if the 10 MB quota is full.
- **An imported build is invalid:** copy the entire encoded string again without extra changes. Review **Overwrite?** for each collision. If item loading fails during import, retain the string and retry later.
- **A row says `DELETED`:** retry a full refresh first. After a successful refresh, it means the saved positive item ID is deleted or no longer available to the Builder; replace or remove that row only after deciding the record is no longer usable.

### Fix search and preview problems

- **Item search reports an error:** check that each stat comparison has a recognized numeric label, a supported operator, and a number. Use a comma between a plain item name and the expression, balance parentheses, and see the syntax reference below.
- **A preview does not appear:** wait two seconds with a non-touch pointer over the item name, or focus the name with the keyboard. Confirm **Pop-up stat windows** is **On**. Previews intentionally do not open from touch input; open the details link instead. Press Escape to close an open preview.

### Request a new account link or help

Verification links last 24 hours and password-reset links last one hour. Either can also become unusable after it has been used or replaced. For verification, sign in and use **Resend verification**. For password recovery, return to **Forgot password?** and request a fresh link for the verified address.

If these steps do not resolve the problem, use [Send Feedback](/feedback.html). Feedback creates a public GitHub issue, so describe what you were doing, the message shown, and whether the build was browser-local or synchronized, but do not include a password, recovery link, private build string, or other secret.

## Reference

### Item-search expression syntax

A plain phrase performs a case-insensitive item-name search. If the query contains comparisons, each comparison has a numeric stat label or alias, an operator, and a signed integer or decimal value. Stat labels and aliases are case-insensitive.

| Form | Meaning | Example |
| --- | --- | --- |
| Plain name | Name contains the phrase | `silver sword` |
| `=` | Equal | `2H = 1` |
| `>` or `<` | Greater than or less than | `strength > 15` |
| `>=` or `<=` | Inclusive comparison | `Armor Class <= -10` |
| Comma or `and` | Both comparisons must match | `strength >= 15 and mind < 10` |
| `or` | Either side may match | `hit > 5 or dam > 5` |
| Parentheses | Override grouping | `(strength > 15 or dexterity > 15), rent <= 500` |

`and` binds more tightly than `or`; parentheses make the intended order explicit. A comma also means `and` between comparisons. To combine a name with comparisons, put the name first and separate it with a comma: `sword, strength > 15`.

Use only the operators shown above. Free-form name text is either the whole plain-name query or the part before the first comma; do not join a free-form name clause to comparisons with `and`.

### Builder calculations

The Builder models a level-50 character. It first caps each final primary attribute and then uses those capped totals in dependent calculations; it does not feed uncapped raw sums into the formulas below. In this reference, `trunc` means discard the fractional part toward zero, and `max` or `min` chooses the larger or smaller value.

#### Caps and allowances

| Value | Builder rule |
| --- | --- |
| Each primary attribute | `100 + Increased Potential rank + matching item cap bonuses` |
| Hit normal-equipment contribution | `30 + max(Dexterity - 90, 0)` |
| Dam normal-equipment contribution | `30 + max(Strength - 90, 0)` |
| Spell Damage normal-equipment contribution | `40` |
| Spell Critical normal-equipment contribution | `40` |
| HPR, MAR, or MVR normal-equipment allowance | `20 - high-stat contribution` for its governing Constitution, Mind, or Dexterity |
| High-stat regeneration contribution | `trunc((stat - 75) / 5)` when the governing stat is above 79; otherwise `0` |
| Mana Reduction overall cap | `50` |
| Battle Training natural Mitigation | `trunc(max(Constitution - 75, 0) / 5)` |
| Mitigation overall cap | `trunc(max(min(Constitution, 70) - 30, 0) / 2)`, plus `10` with Battle Training |

The Builder warns when AC is below `-250`; it does not currently clamp AC to `-250`. A capped Total such as `78 (44)` shows the final value first and the capped normal-equipment contribution in parentheses.

#### Natural and resource values

Quest resource values are included in these level-50 formulas. Equipment and applicable era abilities are added elsewhere in the total.

- Effective Constitution for HP is `Constitution + max(Constitution - 90, 0)`, so Constitution points above 90 count twice.
- HP is `216 + 5 × effective Constitution + Quest HP`.
- Mana is `296 + 5 × Mind + Quest Mana`.
- Movement is `346 + 5 × Dexterity + Quest Mv`.
- Natural Hit is `trunc((Dexterity - 1) / 3)`.
- Natural Dam is `trunc((Strength - 1) / 3)`.
- Melee damage cap starts at `102`. Above 50 Strength, add `trunc((Strength - 50) / 2)`; above 100, also add `trunc((Strength - 99) / 2)`. An equipped two-handed Wield weapon adds `64` once.
- Natural AC is `100 - trunc((Dexterity - 30) / 2)`.
- Natural Spell Damage is `trunc((Mind - 52) / 2)`.
- Natural Spell Critical is `trunc((Mind - 60) / 4) + trunc(max(Perception - 60, 0) / 8) + trunc(max(Spirit - 60, 0) / 8) + 5`.

Natural regeneration includes the same high-stat contribution used to reduce the normal-equipment allowance:

| Value | Governing stat and natural formula |
| --- | --- |
| HPR | Constitution `C`: high-stat contribution `+ trunc(C / 10)`, and when `C > 100` add `trunc((C - 100) / 10)` |
| MAR | Mind `M`: high-stat contribution `+ trunc(M / 10)`, and when `M > 100` add `trunc((M - 100) / 2)` |
| MVR | Dexterity `D`: high-stat contribution, plus `trunc((D - 49) / 5)` when `D > 53`; otherwise that second term is `0` |

#### Era abilities

Abilities appear in this order, grouped by era. Effects are per rank.

| Era | Ability | Maximum rank | Effect per rank |
| --- | --- | --- | --- |
| Ancient | Mental Enhancement | 3 | `+10 Mana` |
| Ancient | Arcane Focus | 5 | `+1 Spell Damage`, `+1 Spell Critical` |
| Medieval | Hardened Skin | 5 | `-3 AC` |
| Medieval | Increased Potential | 5 | `+1` to each primary-attribute cap |
| Medieval | Physical Enhancement | 3 | `+20 Mv` |
| Medieval | Weapon Focus | 1 | `+5 Hit`, `+5 Dam` |
| Medieval | Innate Regeneration | 3 | `+1 HPR`, `+1 MAR`, `+1 MVR` |
| Industrial | Physical Endurance | 3 | `+10 HP` |

Alignment is calculated across equipped item restrictions. An Alignment total of `ERROR` means no alignment remains compatible with the complete equipment set.

### Terms and abbreviations

| Term | Meaning in LegendHUB |
| --- | --- |
| AC | Armor Class. Lower totals are generally better; the Builder warns below its documented threshold. |
| KSM | The Builder's zero-sum primary-stat swap section. At most three points may be moved. |
| HP | Hit points. |
| Mana | The resource displayed as Mana or Ma. |
| Mv | Movement points. |
| HPR | Hit-point regeneration. |
| MAR | Mana regeneration. |
| MVR | Movement regeneration. |
| Cap | A maximum contribution or total enforced by the Builder; warnings show when an input exceeds it. |
| Variant | A named alternative build within one character profile. |
| Official item | Equipment imported from and managed by LegendMUD game data. |
| Browser-local data | Builder profiles stored only in one browser profile after cookie consent. |
| Synchronized data | Builder profiles and preferences stored with a verified account and loaded across eligible sessions. |
