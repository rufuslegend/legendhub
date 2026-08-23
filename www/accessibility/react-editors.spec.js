"use strict";

const Module = require("node:module");
const AxeBuilder = require("@axe-core/playwright").default;
const {expect, test} = require("@playwright/test");
const {Kind, parse, valueFromASTUntyped} = require("graphql");
const fulfillLocalBrowserScript = require("./support/local-browser-scripts");

const areas = [
    {id: 11, name: "Thebes", eraName: "Ancient"},
    {id: 12, name: "London", eraName: "Industrial"}
];
const categories = [
    {
        id: 4,
        name: "Guides",
        getSubcategories: [
            {id: 41, name: "Getting Started"},
            {id: 42, name: "Advanced"}
        ]
    },
    {
        id: 5,
        name: "Lore",
        getSubcategories: [{id: 51, name: "People"}]
    },
    {id: 6, name: "News", getSubcategories: []}
];
const editFixtures = {
    mob: {
        aggro: true,
        areaId: 11,
        areaName: "Thebes",
        eraId: 1,
        eraName: "Ancient",
        gold: 37,
        id: 201,
        name: "Test sentry",
        notes: "**Watchful** guard",
        xp: 450
    },
    quest: {
        areaId: 12,
        areaName: "London",
        content: "# Briefing\n\nMeet the **captain**.",
        eraId: 2,
        eraName: "Industrial",
        id: 301,
        stat: true,
        title: "A representative quest",
        whoises: "Captain;Quartermaster"
    },
    wiki: {
        categoryId: 4,
        categoryName: "Guides",
        content: "# Guide\n\nFollow the **trail**.",
        id: 401,
        subcategoryId: 42,
        subcategoryName: "Advanced",
        tags: "guide;trail",
        title: "A representative wiki page"
    }
};
const revertRequests = [];
let failingRevertField = null;

let baseUrl;
let restoreDependencies;
let server;

function editorPageData(query, ip, variables) {
    const timestamp = "2026-08-22T12:00:00.000Z";
    for (const revert of [
        {field: "revertMob", id: 201, token: "mob-revert-token"},
        {field: "revertQuest", id: 301, token: "quest-revert-token"},
        {field: "revertWikiPage", id: 401, token: "wiki-revert-token"}
    ]) {
        if (!query.includes(revert.field))
            continue;
        revertRequests.push({query, ip, variables});
        if (failingRevertField === revert.field) {
            const error = new Error(`${revert.field} rejected.`);
            error.status = 422;
            throw error;
        }
        return {
            [revert.field]: {
                id: revert.id,
                tokenRenewal: {
                    token: revert.token,
                    expires: "2030-01-01T00:00:00.000Z"
                }
            }
        };
    }
    if (query.includes("getNotifications(")) {
        return {
            getNotifications: {moreResults: false, results: []}
        };
    }
    if (query.includes("getMobHistoryById")) {
        return {
            getMobHistoryById: {
                mob: {
                    ...editFixtures.mob,
                    getHistories: [{
                        id: 1201,
                        mob: {modifiedBy: "Archivist", modifiedOn: timestamp}
                    }],
                    getItems: [],
                    modifiedBy: "Archivist",
                    modifiedOn: timestamp
                }
            }
        };
    }
    if (query.includes("getQuestHistoryById")) {
        return {
            getQuestHistoryById: {
                quest: {
                    ...editFixtures.quest,
                    getHistories: [{
                        id: 1301,
                        quest: {modifiedBy: "Archivist", modifiedOn: timestamp}
                    }],
                    getItems: [],
                    modifiedBy: "Archivist",
                    modifiedOn: timestamp
                }
            }
        };
    }
    if (query.includes("getWikiPageHistoryById")) {
        return {
            getWikiPageHistoryById: {
                wikiPage: {
                    ...editFixtures.wiki,
                    getHistories: [{
                        id: 1401,
                        wikiPage: {modifiedBy: "Archivist", modifiedOn: timestamp}
                    }],
                    modifiedBy: "Archivist",
                    modifiedOn: timestamp
                }
            }
        };
    }
    if (query.includes("getMobById"))
        return {getMobById: editFixtures.mob, getAreas: areas};
    if (query.includes("getQuestById"))
        return {getQuestById: editFixtures.quest, getAreas: areas};
    if (query.includes("getWikiPageById"))
        return {getWikiPageById: editFixtures.wiki, getCategories: categories};
    if (query.includes("getAreas"))
        return {getAreas: areas};
    if (query.includes("getCategories"))
        return {getCategories: categories};
    throw new Error("No editor fixture matches the GraphQL query.");
}

function loadAppWithEditorFixtures() {
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === "sync-rpc")
            return () => () => [];
        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        const authApi = require("../src/routes/api/auth");
        const apiUtils = require("../src/routes/api/utils");
        const originalAuthToken = authApi.utils.authToken;
        const originalGetPermissions = authApi.utils.getPermissions;
        const originalPostAsync = apiUtils.postAsync;

        authApi.utils.authToken = async function() {
            return {memberId: 7, username: "Editor Tester"};
        };
        authApi.utils.getPermissions = async function() {
            return {hasPermission: function() { return false; }};
        };
        apiUtils.postAsync = editorPageData;
        restoreDependencies = function() {
            authApi.utils.authToken = originalAuthToken;
            authApi.utils.getPermissions = originalGetPermissions;
            apiUtils.postAsync = originalPostAsync;
        };

        return require("../src/create-app")({logging: false});
    }
    finally {
        Module._load = originalLoad;
    }
}

test.beforeAll(async function() {
    const app = loadAppWithEditorFixtures();
    server = await new Promise(function(resolve) {
        const listeningServer = app.listen(0, "127.0.0.1", function() {
            resolve(listeningServer);
        });
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async function() {
    if (restoreDependencies)
        restoreDependencies();
    if (!server)
        return;
    await new Promise(function(resolve, reject) {
        server.close(function(error) {
            if (error)
                reject(error);
            else
                resolve();
        });
    });
});

test.beforeEach(async function({context}) {
    failingRevertField = null;
    revertRequests.length = 0;
    await context.addCookies([
        {name: "loginToken", value: "editor-token", url: baseUrl},
        {name: "cookie-consent", value: "true", url: baseUrl},
        {name: "theme", value: "high-contrast", url: baseUrl}
    ]);
    await context.route(/^https?:\/\//, function(route) {
        if (route.request().url().startsWith(baseUrl))
            return route.continue();
        return fulfillLocalBrowserScript(route);
    });
});

function mutationRequest(body) {
    const document = parse(body.query);
    expect(document.definitions).toHaveLength(1);
    const operation = document.definitions[0];
    expect(operation.kind).toBe(Kind.OPERATION_DEFINITION);
    expect(operation.operation).toBe("mutation");
    expect(operation.selectionSet.selections).toHaveLength(1);
    const mutation = operation.selectionSet.selections[0];
    return {
        field: mutation.name.value,
        args: Object.fromEntries(mutation.arguments.map(function(argument) {
            return [
                argument.name.value,
                valueFromASTUntyped(argument.value, body.variables || {})
            ];
        }))
    };
}

async function fulfillMutation(route, response) {
    await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({data: response})
    });
}

async function openEditor(page, path, heading) {
    const response = await page.goto(`${baseUrl}${path}`);
    expect(response).not.toBeNull();
    expect(response.status()).toBe(200);
    await expect(page.getByRole("heading", {name: heading, exact: true})).toBeVisible();
}

test("legacy characterization: anonymous add, edit, and revert routes require login", async function({context, page}) {
    await context.clearCookies();
    for (const path of [
        "/mobs/add.html", "/mobs/edit.html?id=201", "/mobs/revert.html?id=1201",
        "/quests/add.html", "/quests/edit.html?id=301", "/quests/revert.html?id=1301",
        "/wiki/add.html", "/wiki/edit.html?id=401", "/wiki/revert.html?id=1401"
    ]) {
        const response = await page.goto(`${baseUrl}${path}`);
        expect(response).not.toBeNull();
        expect(response.status()).toBe(200);
        expect(new URL(page.url()).pathname).toBe("/login.html");
        expect(new URL(page.url()).searchParams.get("returnUrl")).toBe(path);
    }
});

test("legacy characterization: authenticated history pages retain their revert entry points", async function({page}) {
    for (const history of [
        {path: "/mobs/history.html?id=1201", revert: "/mobs/revert.html?id=1201"},
        {path: "/quests/history.html?id=1301", revert: "/quests/revert.html?id=1301"},
        {path: "/wiki/history.html?id=1401", revert: "/wiki/revert.html?id=1401"}
    ]) {
        const response = await page.goto(`${baseUrl}${history.path}`);
        expect(response).not.toBeNull();
        expect(response.status()).toBe(200);
        const revert = page.getByRole("button", {name: "Use this version", exact: true});
        await expect(revert).toHaveAttribute("href", history.revert);
        await revert.focus();
        await expect(revert).toBeFocused();
    }
});

test("revert routes preserve authenticated variables, renewed cookies, and exact redirects", async function({context, page}) {
    const cases = [
        {
            field: "revertMob",
            historyId: 1201,
            path: "/mobs/revert.html?id=1201",
            redirect: "/mobs/details.html?id=201",
            token: "mob-revert-token"
        },
        {
            field: "revertQuest",
            historyId: 1301,
            path: "/quests/revert.html?id=1301",
            redirect: "/quests/details.html?id=301",
            token: "quest-revert-token"
        },
        {
            field: "revertWikiPage",
            historyId: 1401,
            path: "/wiki/revert.html?id=1401",
            redirect: "/wiki/details.html?id=401",
            token: "wiki-revert-token"
        }
    ];

    for (const revert of cases) {
        await context.addCookies([{name: "loginToken", value: "editor-token", url: baseUrl}]);
        const response = await page.request.get(`${baseUrl}${revert.path}`, {maxRedirects: 0});
        expect(response.status()).toBe(302);
        expect(response.headers().location).toBe(revert.redirect);
        expect(response.headers()["set-cookie"]).toBe(
            `loginToken=${revert.token}; Path=/; Expires=Tue, 01 Jan 2030 00:00:00 GMT; Secure; SameSite=Strict`
        );
    }

    expect(revertRequests).toHaveLength(3);
    for (const [index, revert] of cases.entries()) {
        const call = revertRequests[index];
        expect(call.variables).toEqual({authToken: "editor-token", historyId: revert.historyId});
        expect(call.query).not.toContain("editor-token");
        expect(call.query).not.toContain(String(revert.historyId));
        expect(mutationRequest(call)).toEqual({
            field: revert.field,
            args: {authToken: "editor-token", historyId: revert.historyId}
        });
    }
});

test("revert routes preserve GraphQL failures without cookies or redirects", async function({context, page}) {
    const cases = [
        {field: "revertMob", historyId: 1201, path: "/mobs/revert.html?id=1201"},
        {field: "revertQuest", historyId: 1301, path: "/quests/revert.html?id=1301"},
        {field: "revertWikiPage", historyId: 1401, path: "/wiki/revert.html?id=1401"}
    ];

    for (const revert of cases) {
        failingRevertField = revert.field;
        await context.addCookies([{name: "loginToken", value: "editor-token", url: baseUrl}]);
        const response = await page.request.get(`${baseUrl}${revert.path}`, {maxRedirects: 0});
        expect(response.status()).toBe(422);
        expect(response.headers().location).toBeUndefined();
        expect(response.headers()["set-cookie"]).toBeUndefined();
        expect(await response.text()).toContain(`${revert.field} rejected.`);

        const call = revertRequests.at(-1);
        expect(call.variables).toEqual({authToken: "editor-token", historyId: revert.historyId});
    }
});

test("legacy characterization: mob add and edit preserve initialization, validation, payloads, and redirects", async function({page}) {
    const requests = [];
    await page.route(`${baseUrl}/api`, async function(route) {
        const body = route.request().postDataJSON();
        const request = mutationRequest(body);
        requests.push(request);
        if (request.field === "insertMob") {
            await fulfillMutation(route, {
                insertMob: {
                    id: 202,
                    tokenRenewal: {token: "mob-add-token", expires: "2030-01-01T00:00:00.000Z"}
                }
            });
            return;
        }
        await fulfillMutation(route, {
            updateMob: {token: "mob-edit-token", expires: "2030-01-02T00:00:00.000Z"}
        });
    });
    await page.route(`${baseUrl}/mobs/details.html?id=*`, route => route.fulfill({body: "<title>Mob</title>"}));

    await openEditor(page, "/mobs/add.html", "Add Mob");
    await expect(page.locator('input[name="xp"]')).toHaveValue("0");
    await expect(page.locator('input[name="gold"]')).toHaveValue("0");
    await expect(page.locator('input[type="checkbox"]')).not.toBeChecked();
    await expect(page.getByRole("button", {name: "Save", exact: true})).toBeDisabled();
    await page.locator('input[name="name"]').fill("Archive guardian");
    await page.locator('select[name="area"]').selectOption({label: "London (Industrial)"});
    await page.locator('input[name="xp"]').fill("725");
    await page.locator('input[name="gold"]').fill("19");
    await page.locator('input[type="checkbox"]').check();
    await page.locator("textarea").fill("**Amber** patrol");
    await page.getByRole("button", {name: "Save", exact: true}).focus();
    await Promise.all([
        page.waitForURL(`${baseUrl}/mobs/details.html?id=202`),
        page.keyboard.press("Enter")
    ]);

    expect(requests[0]).toEqual({
        field: "insertMob",
        args: {
            authToken: "editor-token",
            name: "Archive guardian",
            xp: 725,
            areaId: 12,
            gold: 19,
            notes: "**Amber** patrol",
            aggro: true
        }
    });

    await openEditor(page, "/mobs/edit.html?id=201", "Edit Mob");
    await expect(page.locator('input[name="name"]')).toHaveValue("Test sentry");
    await expect(page.locator('select[name="area"] option:checked')).toHaveText("Thebes (Ancient)");
    await expect(page.locator('input[name="xp"]')).toHaveValue("450");
    await expect(page.locator('input[name="gold"]')).toHaveValue("37");
    await expect(page.locator('input[type="checkbox"]')).toBeChecked();
    await expect(page.locator("textarea")).toHaveValue("**Watchful** guard");
    await expect(page.getByRole("button", {name: "Save", exact: true})).toBeDisabled();
    await page.locator('input[name="gold"]').fill("38");
    await Promise.all([
        page.waitForURL(`${baseUrl}/mobs/details.html?id=201`),
        page.getByRole("button", {name: "Save", exact: true}).click()
    ]);
    expect(requests[1]).toEqual({
        field: "updateMob",
        args: {
            id: 201,
            authToken: "mob-add-token",
            name: "Test sentry",
            xp: 450,
            areaId: 11,
            gold: 38,
            notes: "**Watchful** guard",
            aggro: true
        }
    });
});

test("legacy characterization: quest add and edit preserve initialization, validation, payloads, and redirects", async function({page}) {
    const requests = [];
    await page.route(`${baseUrl}/api`, async function(route) {
        const request = mutationRequest(route.request().postDataJSON());
        requests.push(request);
        if (request.field === "insertQuest") {
            await fulfillMutation(route, {
                insertQuest: {
                    id: 302,
                    tokenRenewal: {token: "quest-add-token", expires: null}
                }
            });
            return;
        }
        await fulfillMutation(route, {
            updateQuest: {token: "quest-edit-token", expires: null}
        });
    });
    await page.route(`${baseUrl}/quests/details.html?id=*`, route => route.fulfill({body: "<title>Quest</title>"}));

    await openEditor(page, "/quests/add.html", "Add Quest");
    await expect(page.locator('input[name="whoises"]')).toHaveValue("");
    await expect(page.locator('input[type="checkbox"]')).not.toBeChecked();
    await expect(page.locator("textarea")).toHaveValue("");
    await expect(page.getByRole("button", {name: "Save", exact: true})).toBeDisabled();
    await page.locator('input[name="title"]').fill("An archival errand");
    await page.locator('select[name="area"]').selectOption({label: "Thebes (Ancient)"});
    await page.locator('input[name="whoises"]').fill("Archivist;Scribe");
    await page.locator('input[type="checkbox"]').check();
    await page.locator("textarea").fill("Return the **folio**.");
    await Promise.all([
        page.waitForURL(`${baseUrl}/quests/details.html?id=302`),
        page.getByRole("button", {name: "Save", exact: true}).click()
    ]);
    expect(requests[0]).toEqual({
        field: "insertQuest",
        args: {
            authToken: "editor-token",
            title: "An archival errand",
            areaId: 11,
            whoises: "Archivist;Scribe",
            stat: true,
            content: "Return the **folio**."
        }
    });

    await openEditor(page, "/quests/edit.html?id=301", "Edit Quest");
    await expect(page.locator('input[name="title"]')).toHaveValue("A representative quest");
    await expect(page.locator('select[name="area"] option:checked')).toHaveText("London (Industrial)");
    await expect(page.locator('input[name="whoises"]')).toHaveValue("Captain;Quartermaster");
    await expect(page.locator('input[type="checkbox"]')).toBeChecked();
    await expect(page.locator("textarea")).toHaveValue("# Briefing\n\nMeet the **captain**.");
    await expect(page.getByRole("button", {name: "Save", exact: true})).toBeDisabled();
    await page.locator('input[name="whoises"]').fill("Captain;Quartermaster;Scribe");
    await Promise.all([
        page.waitForURL(`${baseUrl}/quests/details.html?id=301`),
        page.getByRole("button", {name: "Save", exact: true}).click()
    ]);
    expect(requests[1]).toEqual({
        field: "updateQuest",
        args: {
            id: 301,
            authToken: "quest-add-token",
            title: "A representative quest",
            areaId: 12,
            whoises: "Captain;Quartermaster;Scribe",
            stat: true,
            content: "# Briefing\n\nMeet the **captain**."
        }
    });
});

test("legacy characterization: wiki add and edit preserve category filtering, payloads, and redirects", async function({page}) {
    const requests = [];
    await page.route(`${baseUrl}/api`, async function(route) {
        const request = mutationRequest(route.request().postDataJSON());
        requests.push(request);
        if (request.field === "insertWikiPage") {
            await fulfillMutation(route, {
                insertWikiPage: {
                    id: 402,
                    tokenRenewal: {token: "wiki-add-token", expires: null}
                }
            });
            return;
        }
        await fulfillMutation(route, {
            updateWikiPage: {token: "wiki-edit-token", expires: null}
        });
    });
    await page.route(`${baseUrl}/wiki/details.html?id=*`, route => route.fulfill({body: "<title>Wiki</title>"}));

    await openEditor(page, "/wiki/add.html", "Add Wiki Page");
    await expect(page.locator('input[name="tags"]')).toHaveValue("");
    await expect(page.locator("textarea")).toHaveValue("");
    await expect(page.getByRole("button", {name: "Save", exact: true})).toBeDisabled();
    await page.locator('input[name="title"]').fill("Archive guide");
    await page.locator('select[name="category"]').selectOption({label: "Guides"});
    await expect(page.locator('select[name="subcategory"] option')).toHaveText([
        "", "Getting Started", "Advanced"
    ]);
    await page.locator('select[name="subcategory"]').selectOption({label: "Advanced"});
    await page.locator('select[name="category"]').selectOption({label: "Lore"});
    await expect(page.locator('select[name="subcategory"] option:checked')).toHaveText("");
    await expect(page.locator('select[name="subcategory"] option')).toHaveText(["", "People"]);
    await page.locator('select[name="subcategory"]').selectOption({label: "People"});
    await page.locator('input[name="tags"]').fill("archive;guide");
    await page.locator("textarea").fill("Read the **records**.");
    await Promise.all([
        page.waitForURL(`${baseUrl}/wiki/details.html?id=402`),
        page.getByRole("button", {name: "Save", exact: true}).click()
    ]);
    expect(requests[0]).toEqual({
        field: "insertWikiPage",
        args: {
            authToken: "editor-token",
            title: "Archive guide",
            categoryId: 5,
            subcategoryId: 51,
            tags: "archive;guide",
            content: "Read the **records**."
        }
    });

    await openEditor(page, "/wiki/edit.html?id=401", "Edit Wiki Page");
    await expect(page.locator('input[name="title"]')).toHaveValue("A representative wiki page");
    await expect(page.locator('select[name="category"] option:checked')).toHaveText("Guides");
    await expect(page.locator('select[name="subcategory"] option:checked')).toHaveText("Advanced");
    await expect(page.locator('input[name="tags"]')).toHaveValue("guide;trail");
    await expect(page.locator("textarea")).toHaveValue("# Guide\n\nFollow the **trail**.");
    await expect(page.getByRole("button", {name: "Save", exact: true})).toBeDisabled();
    await page.locator('input[name="tags"]').fill("guide;trail;updated");
    await Promise.all([
        page.waitForURL(`${baseUrl}/wiki/details.html?id=401`),
        page.getByRole("button", {name: "Save", exact: true}).click()
    ]);
    expect(requests[1]).toEqual({
        field: "updateWikiPage",
        args: {
            id: 401,
            authToken: "wiki-add-token",
            title: "A representative wiki page",
            categoryId: 4,
            subcategoryId: 42,
            tags: "guide;trail;updated",
            content: "# Guide\n\nFollow the **trail**."
        }
    });
});

test("React migration: editor pages mount one named root from inert route props", async function({page}) {
    for (const editor of [
        {
            path: "/mobs/edit.html?id=201",
            root: "mob-editor",
            entityName: "mob",
            entity: editFixtures.mob
        },
        {
            path: "/quests/edit.html?id=301",
            root: "quest-editor",
            entityName: "quest",
            entity: editFixtures.quest
        },
        {
            path: "/wiki/edit.html?id=401",
            root: "wiki-editor",
            entityName: "wikiPage",
            entity: editFixtures.wiki
        }
    ]) {
        const response = await page.goto(`${baseUrl}${editor.path}`);
        expect(response).not.toBeNull();
        expect(response.status()).toBe(200);
        const root = page.locator(`[data-react-root="${editor.root}"]`);
        await expect(root).toHaveCount(1);
        const props = page.locator(`[data-react-props="${editor.root}"]`);
        await expect(props).toHaveCount(1);
        expect(await props.evaluate(
            (element, entityName) => JSON.parse(element.textContent)[entityName],
            editor.entityName
        ))
            .toEqual(editor.entity);
        await expect(page.locator("body")).not.toHaveAttribute("ng-app");
        expect(await root.evaluate(function(element) {
            return Array.from(element.querySelectorAll("*")).some(function(child) {
                return Array.from(child.attributes).some(attribute => attribute.name.startsWith("ng-"));
            });
        })).toBe(false);
    }
});

test("React migration: Markdown preview keeps ordinary formatting and removes malicious HTML and URLs", async function({page}) {
    await openEditor(page, "/wiki/edit.html?id=401", "Edit Wiki Page");
    const content = [
        "## Safe heading",
        "",
        "Keep **strong words**, a [safe link](https://example.test/guide), and ![map](https://example.test/map.png \"Map\").",
        "",
        "<script>window.previewScriptRan = true</script>",
        "<img src=\"https://example.test/pixel.png\" onerror=\"window.previewEventRan = true\">",
        "<a href=\"https://example.test/raw\" onclick=\"window.previewClickRan = true\">raw safe link</a>",
        "<iframe src=\"https://example.test/frame\"></iframe>",
        "<form action=\"https://example.test/steal\"><input name=\"secret\"></form>",
        "[script URL](javascript:window.previewUrlRan=true)",
        "![data URL](data:image/svg+xml,<svg onload=alert(1)></svg>)"
    ].join("\n");
    await page.locator("textarea").fill(content);

    const preview = page.getByRole("region", {name: "Content Markdown preview"});
    await expect(preview.getByRole("heading", {name: "Safe heading"})).toBeVisible();
    await expect(preview.locator("strong")).toHaveText("strong words");
    await expect(preview.getByRole("link", {name: "safe link", exact: true}))
        .toHaveAttribute("href", "https://example.test/guide");
    await expect(preview.getByRole("img", {name: "map"}))
        .toHaveAttribute("src", "https://example.test/map.png");
    await expect(preview.getByRole("link", {name: "raw safe link", exact: true}))
        .toHaveAttribute("href", "https://example.test/raw");
    await expect(preview.locator("script, iframe, form, input")).toHaveCount(0);
    await expect(preview.locator("[onerror], [onclick], [onload]")).toHaveCount(0);
    await expect(preview.locator('[href^="javascript:"], [href^="data:"], [src^="data:"]'))
        .toHaveCount(0);
    expect(await page.evaluate(function() {
        return {
            click: window.previewClickRan,
            event: window.previewEventRan,
            script: window.previewScriptRan,
            url: window.previewUrlRan
        };
    })).toEqual({click: undefined, event: undefined, script: undefined, url: undefined});
});

test("React migration: Markdown preview preserves every allowed tag, attribute, and URI branch", async function({page}) {
    await openEditor(page, "/wiki/edit.html?id=401", "Edit Wiki Page");
    const allowedUris = [
        {label: "HTTPS branch", href: "https://example.test/secure"},
        {label: "HTTP branch", href: "http://example.test/plain"},
        {label: "Mail branch", href: "mailto:archivist@example.test"},
        {label: "Root branch", href: "/wiki/details.html?id=401"},
        {label: "Hash branch", href: "#chapter"},
        {label: "Dot branch", href: "./nearby.html"},
        {label: "Parent branch", href: "../history.html"},
        {label: "Bare branch", href: "wiki/details.html?id=401#notes"}
    ];
    const content = [
        "# Heading one",
        "## Heading two",
        "### Heading three",
        "#### Heading four",
        "##### Heading five",
        "###### Heading six",
        "",
        "> Quoted guidance",
        "",
        "Paragraph with **strong**, *emphasis*, <del>deleted</del>, and `inline code`.<br>",
        "",
        "---",
        "",
        "```",
        "preformatted code",
        "```",
        "",
        "1. Ordered entry",
        "",
        "- Unordered entry",
        "",
        "<table><thead><tr><th>Column</th></tr></thead><tbody><tr><td>Cell</td></tr></tbody></table>",
        "",
        '<a href="https://example.test/titled" title="Allowed link title">Titled link</a>',
        '<img src="https://example.test/map.png" alt="Allowed map" title="Allowed image title">',
        ...allowedUris.map(uri => `<a href="${uri.href}">${uri.label}</a>`),
        "",
        "Linkified https://example.test/automatic"
    ].join("\n");
    await page.locator("textarea").fill(content);

    const preview = page.getByRole("region", {name: "Content Markdown preview"});
    for (const tag of [
        "a", "blockquote", "br", "code", "del", "em", "h1", "h2", "h3",
        "h4", "h5", "h6", "hr", "img", "li", "ol", "p", "pre", "strong",
        "table", "tbody", "td", "th", "thead", "tr", "ul"
    ])
        expect(await preview.locator(tag).count(), `allowed <${tag}>`).toBeGreaterThan(0);

    await expect(preview.getByRole("link", {name: "Titled link"}))
        .toHaveAttribute("title", "Allowed link title");
    await expect(preview.getByRole("img", {name: "Allowed map"}))
        .toHaveAttribute("src", "https://example.test/map.png");
    await expect(preview.getByRole("img", {name: "Allowed map"}))
        .toHaveAttribute("title", "Allowed image title");
    for (const uri of allowedUris)
        await expect(preview.getByText(uri.label, {exact: true})).toHaveAttribute("href", uri.href);
    await expect(preview.getByRole("link", {name: "https://example.test/automatic"}))
        .toHaveAttribute("href", "https://example.test/automatic");
});

test("React migration: Markdown preview rejects every forbidden tag, attribute, and URI edge", async function({page}) {
    await openEditor(page, "/wiki/edit.html?id=401", "Edit Wiki Page");
    const unsafeUris = [
        {label: "JavaScript scheme", attribute: "href", value: "javascript:alert(1)", tag: "a"},
        {label: "Mixed script scheme", attribute: "href", value: "JaVaScRiPt:alert(2)", tag: "a"},
        {label: "Entity script scheme", attribute: "href", value: "java&#x73;cript:alert(3)", tag: "a"},
        {label: "Whitespace script scheme", attribute: "href", value: "java&#10;script:alert(4)", tag: "a"},
        {label: "Unicode-space script scheme", attribute: "href", value: "java\u2000script:alert(5)", tag: "a"},
        {label: "VBScript scheme", attribute: "href", value: "vbscript:msgbox(1)", tag: "a"},
        {label: "Data link", attribute: "href", value: "data:text/html;base64,PHNjcmlwdD4=", tag: "a"},
        {label: "Protocol relative", attribute: "href", value: "//evil.example.test/path", tag: "a"},
        {label: "Spaced protocol relative", attribute: "href", value: " / /evil.example.test/path", tag: "a"},
        {label: "Data image", attribute: "src", value: "data:image/png;base64,iVBORw0KGgo=", tag: "img"}
    ];
    const content = [
        '<p style="color:red" data-secret="value" aria-label="unsafe" onclick="window.badClick=1">Attribute carrier</p>',
        '<img src="https://example.test/event.png" alt="Event image" onerror="window.badEvent=1" srcset="https://example.test/2x.png 2x">',
        "<button>Forbidden button</button>",
        '<embed src="https://example.test/plugin">',
        '<form action="https://example.test/submit"><input name="secret"></form>',
        '<iframe src="https://example.test/frame"></iframe>',
        "<math><mi>unsafe math</mi></math>",
        '<object data="https://example.test/object"></object>',
        "<script>window.badScript=1</script>",
        "<style>body { display: none; }</style>",
        "<svg><circle onload=\"window.badSvg=1\"></circle></svg>",
        ...unsafeUris.map(uri => uri.tag === "img"
            ? `<img ${uri.attribute}="${uri.value}" alt="${uri.label}">`
            : `<a ${uri.attribute}="${uri.value}">${uri.label}</a>`)
    ].join("\n");
    await page.locator("textarea").fill(content);

    const preview = page.getByRole("region", {name: "Content Markdown preview"});
    await expect(preview.locator("button, embed, form, iframe, input, math, object, script, style, svg"))
        .toHaveCount(0);
    const carrier = preview.getByText("Attribute carrier", {exact: true});
    await expect(carrier).not.toHaveAttribute("style");
    await expect(carrier).not.toHaveAttribute("data-secret");
    await expect(carrier).not.toHaveAttribute("aria-label");
    await expect(carrier).not.toHaveAttribute("onclick");
    const eventImage = preview.getByRole("img", {name: "Event image"});
    await expect(eventImage).not.toHaveAttribute("onerror");
    await expect(eventImage).not.toHaveAttribute("srcset");
    for (const uri of unsafeUris) {
        const element = uri.tag === "img"
            ? preview.getByRole("img", {name: uri.label})
            : preview.getByText(uri.label, {exact: true});
        await expect(element, uri.label).not.toHaveAttribute(uri.attribute);
    }
    expect(await page.evaluate(function() {
        return {
            click: window.badClick,
            event: window.badEvent,
            script: window.badScript,
            svg: window.badSvg
        };
    })).toEqual({click: undefined, event: undefined, script: undefined, svg: undefined});
});

test("React migration: restoring mob numeric fields restores pristine edit state", async function({page}) {
    await openEditor(page, "/mobs/edit.html?id=201", "Edit Mob");
    const save = page.getByRole("button", {name: "Save", exact: true});
    const xp = page.locator('input[name="xp"]');
    const gold = page.locator('input[name="gold"]');

    await expect(save).toBeDisabled();
    await xp.fill("451");
    await expect(save).toBeEnabled();
    await xp.fill("450");
    await expect(save).toBeDisabled();

    await gold.fill("38");
    await expect(save).toBeEnabled();
    await gold.fill("37");
    await expect(save).toBeDisabled();
});

test("React migration: a missing editor token redirects before GraphQL validation", async function({context, page}) {
    await openEditor(page, "/mobs/edit.html?id=201", "Edit Mob");
    await context.clearCookies();
    let apiRequests = 0;
    await page.route(`${baseUrl}/api`, async function(route) {
        apiRequests += 1;
        await route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({
                data: null,
                errors: [{message: "Variable $authToken of required type String! was not provided."}]
            })
        });
    });
    await page.locator('input[name="name"]').fill("Expired token edit");

    await Promise.all([
        page.waitForURL(`${baseUrl}/error/401.html`),
        page.getByRole("button", {name: "Save", exact: true}).click()
    ]);
    expect(apiRequests).toBe(0);
});

for (const editor of [
    {
        entity: "Mob",
        path: "/mobs/edit.html?id=201",
        field: 'input[name="name"]',
        value: "Failed sentry save"
    },
    {
        entity: "Quest",
        path: "/quests/edit.html?id=301",
        field: 'input[name="title"]',
        value: "Failed quest save"
    },
    {
        entity: "Wiki page",
        path: "/wiki/edit.html?id=401",
        field: 'input[name="title"]',
        value: "Failed wiki save"
    }
]) {
    test(`React migration: ${editor.entity} save is single-flight and announces request failure`, async function({page}) {
        let releaseRequest;
        let requestCount = 0;
        await page.route(`${baseUrl}/api`, async function(route) {
            requestCount += 1;
            await new Promise(resolve => { releaseRequest = resolve; });
            await route.fulfill({
                contentType: "application/json",
                body: JSON.stringify({
                    data: null,
                    errors: [{message: `${editor.entity} validation failed.`}]
                })
            });
        });
        await page.goto(`${baseUrl}${editor.path}`);
        await page.locator(editor.field).fill(editor.value);
        const save = page.getByRole("button", {name: "Save", exact: true});
        await save.focus();
        await page.keyboard.press("Enter");
        await expect.poll(() => requestCount).toBe(1);
        const saving = page.getByRole("status", {name: `Saving ${editor.entity.toLowerCase()}`});
        await expect(saving).toBeVisible();
        await expect(saving).toBeFocused();
        await expect(page.getByRole("button", {name: `Saving ${editor.entity.toLowerCase()}`}))
            .toBeDisabled();
        await page.locator("form").evaluate(form => form.requestSubmit());
        expect(requestCount).toBe(1);
        releaseRequest();

        const alert = page.getByRole("alert");
        await expect(alert).toHaveText(`${editor.entity} could not be saved. Try again.`);
        await expect(alert).toBeFocused();
        await expect(page.getByRole("button", {name: "Save", exact: true})).toBeEnabled();
    });
}

test("React migration: mounted editors have no detectable WCAG A or AA violations in High Contrast", async function({page}) {
    for (const editor of [
        {path: "/mobs/edit.html?id=201", root: "mob-editor"},
        {path: "/quests/edit.html?id=301", root: "quest-editor"},
        {path: "/wiki/edit.html?id=401", root: "wiki-editor"}
    ]) {
        await page.goto(`${baseUrl}${editor.path}`);
        await expect(page.locator("link#theme")).toHaveAttribute(
            "href",
            /\/css\/bootstrap-high-contrast\.min\.css/
        );
        const results = await new AxeBuilder({page})
            .include(`[data-react-root="${editor.root}"]`)
            .withTags([
                "wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"
            ])
            .analyze();
        expect(results.violations, editor.path).toEqual([]);
    }
});
