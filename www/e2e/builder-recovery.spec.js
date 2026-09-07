"use strict";

const {test, expect} = require("./support/fixtures");
const {saveAction, profiles, renameCharacter, exportLists, freshLogin} = require("./support/builder");

// This regression calls the real storage service after browser login, bypassing
// the separate authentication transaction so both storage transactions can be
// queued precisely. All repository calls, row locks, and commits are real.
test("simultaneous character and preference storage transactions both commit", async ({signedIn: {page}, account, stack, newDevice}) => {
    const {createBuilderStorageService} = require("../src/routes/api/builder-storage-service");
    await renameCharacter(page, "Concurrent Hero");
    const [original] = await profiles(stack, account.id);
    const [preferences] = await stack.query("SELECT Payload, StorageGeneration FROM AccountPreferences WHERE MemberId = ?", [account.id]);
    const service = createBuilderStorageService({pool: stack.pool});
    const auth = {memberId: account.id, emailVerified: true};
    const {unlock, connectionId} = await stack.lockAccountPreferences(account.id);
    const operations = Promise.allSettled([
        service.createProfile(auth, {
            name: "Concurrent Second",
            payload: original.Payload.replaceAll("Concurrent Hero~", "Concurrent Second~"),
            storageGeneration: preferences.StorageGeneration
        }),
        service.updatePreferences(auth, {
            payload: {...JSON.parse(preferences.Payload), theme: "solarized-dark"},
            storageGeneration: preferences.StorageGeneration
        })
    ]);
    try {
        await expect.poll(async () => {
            const [row] = await stack.query(`SELECT COUNT(DISTINCT waits.requesting_trx_id) AS Waiting
                FROM information_schema.INNODB_LOCK_WAITS AS waits
                JOIN information_schema.INNODB_TRX AS blocker ON blocker.trx_id = waits.blocking_trx_id
                WHERE blocker.trx_mysql_thread_id = ?`, [connectionId]);
            return row.Waiting;
        }).toBeGreaterThanOrEqual(2);
    }
    finally {
        await unlock();
    }
    const results = await operations;
    for (const result of results)
        expect(result.status, result.reason?.message).toBe("fulfilled");
    const rows = await profiles(stack, account.id);
    expect(rows.map(row => row.Name)).toEqual(["Concurrent Hero", "Concurrent Second"]);
    expect(rows[0]).toEqual(original);
    const fresh = await freshLogin(newDevice, account);
    await expect(fresh.page.getByLabel("Character", {exact: true}).locator("option")).toHaveText(["Concurrent Hero", "Concurrent Second"]);
    await expect(fresh.page.locator("link#theme")).toHaveAttribute("href", /bootstrap-solarized-dark\.min\.css/);
});

test("a rejected database save retains unsaved edits, preserves committed data, and recovers", async ({signedIn: {page}, account, stack, newDevice}) => {
    await renameCharacter(page, "Recoverable Hero");
    await saveAction(page, () => page.locator("#strInput").fill("40"));
    const committed = await profiles(stack, account.id);
    // A real MariaDB error exercises rollback and the actual GraphQL error path.
    // Scoped to this account, with cleanup even if an assertion fails.
    await stack.query(`CREATE TRIGGER E2ERejectSave BEFORE UPDATE ON BuilderProfiles FOR EACH ROW
        BEGIN IF NEW.MemberId = ${account.id} THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Deliberate functional test write failure';
        END IF; END`);
    try {
        await page.locator("#strInput").fill("55");
        await expect(page.getByRole("status").filter({hasText: "Sync problem."})).toBeVisible();
        await expect(page.getByText("Saved to account", {exact: true})).toHaveCount(0);
        await expect(page.locator("#strInput")).toHaveValue("55");
        expect(await profiles(stack, account.id)).toEqual(committed);
        const fresh = await freshLogin(newDevice, account);
        await expect(fresh.page.locator("#strInput")).toHaveValue("40");
        expect(await exportLists(page)).not.toBe(committed[0].Payload);
    }
    finally {
        await stack.query("DROP TRIGGER IF EXISTS E2ERejectSave");
    }
    await saveAction(page, () => page.locator("#strInput").fill("56"));
    const fresh = await freshLogin(newDevice, account);
    await expect(fresh.page.locator("#strInput")).toHaveValue("56");
    expect((await profiles(stack, account.id))[0].Revision).toBeGreaterThan(committed[0].Revision);
});

test("conflicting edits from two real sessions keep both versions instead of overwriting either", async ({signedIn: {page}, account, stack, newDevice}) => {
    await renameCharacter(page, "Shared Hero");
    await saveAction(page, () => page.locator("#strInput").fill("40"));
    const stale = await freshLogin(newDevice, account);
    await expect(stale.page.locator("#strInput")).toHaveValue("40");
    await saveAction(page, () => page.locator("#strInput").fill("50"));
    await stale.page.locator("#strInput").fill("60");
    await expect(stale.page.getByRole("alert").filter({hasText: "conflict copy"})).toBeVisible();
    const rows = await profiles(stack, account.id);
    expect(rows).toHaveLength(2);
    const conflict = rows.find(row => row.Name !== "Shared Hero");
    expect(conflict.Name).toMatch(/conflict/i);
    const fresh = await freshLogin(newDevice, account);
    await fresh.page.getByLabel("Character", {exact: true}).selectOption({label: "Shared Hero"});
    await expect(fresh.page.locator("#strInput")).toHaveValue("50");
    await fresh.page.getByLabel("Character", {exact: true}).selectOption({label: conflict.Name});
    await expect(fresh.page.locator("#strInput")).toHaveValue("60");
});
