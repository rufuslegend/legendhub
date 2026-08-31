const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

function loadAppForBodyLimitTest(options = {}) {
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === "sync-rpc")
            return () => () => [];
        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        return require("../src/create-app")({
            ...options,
            logging: false
        });
    }
    finally {
        Module._load = originalLoad;
    }
}

async function listenForTest(t, app) {
    const server = await new Promise(function(resolve) {
        const listeningServer = app.listen(0, "127.0.0.1", function() {
            resolve(listeningServer);
        });
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    t.after(function() {
        return new Promise(function(resolve, reject) {
            server.close(function(error) {
                if (error)
                    reject(error);
                else
                    resolve();
            });
        });
    });
    return baseUrl;
}

async function renderHome(cookies = {}) {
    const ejs = require("ejs");
    const {normalizeTheme} = require("../src/view-helpers");
    return ejs.renderFile(path.join(__dirname, "../src/views/index.ejs"), {
        cookies,
        normalizeTheme,
        showDiscordWidget: false,
        title: "Home",
        url: {path: "/"},
        user: null,
        version: "test"
    });
}

async function renderAuthenticatedPage(user, cookies = {}) {
    const ejs = require("ejs");
    const {normalizeTheme} = require("../src/view-helpers");
    const body = await ejs.renderFile(path.join(__dirname, "../src/views/index.ejs"), {
        cookies,
        normalizeTheme,
        showDiscordWidget: false,
        title: "Home",
        url: {path: "/"},
        user: {
            notifications: [],
            moreNotifications: false,
            ...user
        },
        version: "test"
    });
    return {body};
}

async function renderLogin(vm) {
    const ejs = require("ejs");
    const {normalizeTheme} = require("../src/view-helpers");
    return ejs.renderFile(path.join(__dirname, "../src/views/login.ejs"), {
        cookies: {},
        normalizeTheme,
        title: "Login",
        url: {path: "/login.html", query: {returnUrl: "/"}},
        user: null,
        version: "test",
        vm
    });
}

async function renderBuilder(vm) {
    const ejs = require("ejs");
    const {normalizeTheme, serializeJsonForHtml} = require("../src/view-helpers");
    return ejs.renderFile(path.join(__dirname, "../src/views/builder/index.ejs"), {
        cookies: {},
        normalizeTheme,
        serializeJsonForHtml,
        showDiscordWidget: false,
        title: "Builder",
        url: {path: "/builder/"},
        user: null,
        version: "test",
        vm
    });
}

test("PHP-compatible password hashes can be created and verified", function() {
    const passwords = require("../src/routes/api/php-password");
    const hash = passwords.hash("correct horse battery staple");

    assert.match(hash, /^\$2y\$/);
    assert.equal(passwords.verify("correct horse battery staple", hash), true);
    assert.equal(passwords.verify("wrong password", hash), false);
});

test("EJS renders the home page and its shared includes", async function() {
    const html = await renderHome();

    assert.match(html, /Welcome to LegendHUB!/);
    assert.match(html, /Builder/);
    assert.match(html, /Cookie Policy/);
});

// Catches Builder props inheriting the authenticated user object or route
// details, which would expose an address or session credential in page source.
test("Builder markup embeds only the eligible account context and no identity data", async function() {
    const html = await renderBuilder({
        itemStatCategories: [], selectedColumns: [],
        accountContext: {
            authenticated: true,
            emailVerified: true,
            canUseAccountStorage: true,
            storageNamespace: "00112233445566778899aabbccddeeff",
            email: "nested-private@example.test",
            loginToken: "nested-private-login-token",
            payload: "nested-private-builder-payload"
        },
        email: "private@example.test",
        loginToken: "private-login-token",
        payload: "private-builder-payload"
    });

    const props = JSON.parse(html.match(/data-react-props="builder">([^<]+)<\/script>/)[1]);
    assert.deepEqual(props.accountContext, {
        authenticated: true,
        emailVerified: true,
        canUseAccountStorage: true,
        storageNamespace: "00112233445566778899aabbccddeeff"
    });
    for (const privateValue of [
        "private@example.test", "private-login-token", "private-builder-payload",
        "nested-private@example.test", "nested-private-login-token", "nested-private-builder-payload"
    ])
        assert.equal(html.includes(privateValue), false);
});

// Catches a route trusting a stale storage eligibility flag for anonymous or
// unverified sessions instead of deriving a safe public context from auth locals.
test("Builder route exposes account storage only for verified authenticated users", function() {
    const builderRoute = require("../src/routes/builder");

    assert.deepEqual(builderRoute.createAccountContext(null), {
        authenticated: false, emailVerified: false,
        canUseAccountStorage: false, storageNamespace: null
    });
    assert.deepEqual(builderRoute.createAccountContext({
        emailVerified: false, canUseAccountStorage: true,
        storageNamespace: "unverified-namespace"
    }), {
        authenticated: true, emailVerified: false,
        canUseAccountStorage: false, storageNamespace: null
    });
    assert.deepEqual(builderRoute.createAccountContext({
        emailVerified: true, canUseAccountStorage: true,
        storageNamespace: "00112233445566778899aabbccddeeff",
        email: "private@example.test"
    }), {
        authenticated: true, emailVerified: true,
        canUseAccountStorage: true,
        storageNamespace: "00112233445566778899aabbccddeeff"
    });
});

// Catches the login-time verification invitation disappearing for legacy
// members or losing its account destination and session dismissal action.
test("grandfathered member sees a dismissible prompt after each login", async function() {
    const response = await renderAuthenticatedPage({
        username: "LegacyMember",
        emailVerified: false,
        canUseAccountStorage: false
    });

    assert.match(response.body, /Enter and verify your email address now/);
    assert.match(response.body, /href="\/account\/#email-heading"/);
    assert.match(response.body, /action="\/dismiss-email-prompt"/);
    assert.match(response.body, /Existing LegendHUB features remain available/);
});

// Catches either verified members being nagged or a dismissal leaking beyond
// the current login-page render contract.
test("verified and session-dismissed members never see the prompt", async function() {
    const verified = await renderAuthenticatedPage({
        username: "VerifiedMember",
        email: "verified@example.test",
        emailVerified: true,
        canUseAccountStorage: true
    });
    assert.doesNotMatch(verified.body, /dismiss-email-prompt/);

    const dismissed = await renderAuthenticatedPage({
        username: "LegacyMember",
        emailVerified: false,
        canUseAccountStorage: false
    }, {emailPromptDismissed: "true"});
    assert.doesNotMatch(dismissed.body, /dismiss-email-prompt/);
});

// Catches regressions to username-only copy, optional email registration, or
// unescaped reflected form values after a validation failure.
test("login page requires email registration and safely preserves entered identities", async function() {
    const username = "Player<img src=x onerror=alert(1)>";
    const email = "player@example.com\" autofocus onfocus=alert(1)";
    const html = await renderLogin({
        body: {
            login_username: "",
            register_username: username,
            register_email: email
        },
        register_error: "Please correct the form."
    });

    assert.match(html, />Username or email<\/label>/);
    assert.match(html,
        /id="register_email"[^>]+name="register_email"[^>]+type="email"[^>]+autocomplete="email"[^>]+required/);
    assert.match(html, /Player&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(html, /player@example\.com&#34; autofocus onfocus=alert\(1\)/);
    assert.equal(html.includes(username), false);
    assert.equal(html.includes(`value="${email}"`), false);
});

test("Dark is the default while saved themes remain unchanged", async function() {
    const defaultHtml = await renderHome();
    assert.match(defaultHtml,
        /href="\/css\/bootstrap-dark\.min\.css\?v=test"/);
    assert.match(defaultHtml,
        /<meta property="theme-color" content="#343a40" \/>/);

    for (const theme of [
        "light", "dark", "solarized-dark", "high-contrast",
        "glass-blue", "glass-emerald", "glass-ruby", "glass-amethyst", "glass-amber"
    ]) {
        const html = await renderHome({theme});
        assert.match(html, new RegExp(
            `href="/css/bootstrap-${theme}\\.min\\.css\\?v=test"`));
    }
});

test("theme chooser exposes the Glass family and preserves standard choices", async function() {
    const html = await renderHome();

    for (const theme of [
        "glass-blue", "glass-emerald", "glass-ruby", "glass-amethyst", "glass-amber",
        "light", "dark", "solarized-dark", "high-contrast"
    ]) {
        assert.match(html, new RegExp(`data-theme="${theme}"`));
    }
});

test("installable app metadata uses the Dark browser colors", function() {
    const manifest = JSON.parse(fs.readFileSync(path.join(
        __dirname, "../src/public/site.webmanifest"), "utf8"));
    assert.equal(manifest.theme_color, "#343a40");
    assert.equal(manifest.background_color, "#212529");
});

test("fatal error page renders without request locals", async function() {
    const ejs = require("ejs");
    const html = await ejs.renderFile(path.join(__dirname, "../src/views/error/fatal.ejs"));

    assert.match(html, /<title>Fatal Error \| LegendHUB<\/title>/);
    assert.match(html, /A fatal error has occurred/);
});

test("authorized content pages render named delete buttons with valid closing tags", async function() {
    const ejs = require("ejs");
    const {normalizeTheme} = require("../src/view-helpers");
    const shared = {
        cookies: {},
        displayDateTime: function() { return ""; },
        normalizeTheme,
        permissions: {hasPermission: function() { return true; }},
        title: "Details",
        url: {path: "/details.html"},
        user: null,
        version: "test"
    };
    const fixtures = [
        ["items", "item", {
            item: {
                id: 7, name: "Test item", slot: 0, slots: [0], rent: 0, ac: 0,
                strength: 0, mind: 0, dexterity: 0, constitution: 0,
                perception: 0, spirit: 0, getHistories: [], getMob: null,
                getQuest: null, modifiedBy: "Tester", notes: ""
            },
            itemNotesHtml: "", statCategories: [],
            constants: {selectOptions: {
                alignRestriction: ["No Align Restriction"],
                slot: ["Light"]
            }}
        }],
        ["mobs", "mob", {
            mob: {
                id: 7, name: "Test mob", getItems: [], getHistories: [],
                modifiedBy: "Tester", notes: ""
            },
            mobNotesHtml: "", constants: {selectOptions: {slot: ["Light"]}}
        }],
        ["quests", "quest", {
            quest: {
                id: 7, title: "Test quest", getItems: [], getHistories: [],
                modifiedBy: "Tester", content: ""
            },
            questContentHtml: "", constants: {selectOptions: {slot: ["Light"]}}
        }],
        ["wiki", "wiki page", {
            wikiPage: {
                id: 7, title: "Test page", getHistories: [],
                modifiedBy: "Tester", content: ""
            },
            wikiContentHtml: ""
        }]
    ];

    for (const [directory, resourceName, vm] of fixtures) {
        const html = await ejs.renderFile(path.join(
            __dirname, `../src/views/${directory}/display.ejs`), {
            ...shared,
            locals: shared,
            vm
        });
        assert.match(html, new RegExp(
            `<button[^>]+data-target="#deleteModal"[^>]+aria-label="Delete ${resourceName}"[^>]*>` +
            `<i[^>]+aria-hidden="true"[^>]*><\\/i><\\/button>`));
    }
});

// Catches item details and audited history rendering only the compatible
// primary slot instead of the complete eligibility list supplied by GraphQL.
test("item details and history display every slot capability", async function() {
    const ejs = require("ejs");
    const {normalizeTheme} = require("../src/view-helpers");
    const slots = Array(16).fill("");
    slots[14] = "Wield";
    slots[15] = "Hold";
    const item = {
        id: 7, name: "Dual capability blade", slot: 14, slots: [14, 15], rent: 0, ac: 0,
        strength: 0, mind: 0, dexterity: 0, constitution: 0, perception: 0, spirit: 0,
        getHistories: [], getMob: null, getQuest: null, modifiedBy: "Tester", notes: ""
    };
    const shared = {
        cookies: {}, displayDateTime: function() { return ""; }, normalizeTheme,
        permissions: {hasPermission: function() { return false; }}, title: "Details",
        url: {path: "/items/details.html"}, user: null, version: "test"
    };

    for (const historyId of [null, 70]) {
        const html = await ejs.renderFile(path.join(__dirname, "../src/views/items/display.ejs"), {
            ...shared,
            locals: shared,
            vm: {
                historyId, item, itemNotesHtml: "", statCategories: [],
                constants: {selectOptions: {alignRestriction: ["No restriction"], slot: slots}}
            }
        });
        assert.match(html, /Slot:\s*Wield, Hold/);
        assert.match(html, /<dt class="col-8">Slot<\/dt>\s*<dd class="col-4">Wield, Hold<\/dd>/);
    }
});

// Catches weapon details following the legacy primary slot, which hides a Hold
// item's accuracy whenever its compatible scalar key is another capability.
test("item details use slot membership for Hold weapon fields", async function() {
    const ejs = require("ejs");
    const {normalizeTheme} = require("../src/view-helpers");
    const slots = Array(16).fill("");
    slots[2] = "Neck";
    slots[15] = "Hold";
    const item = {
        ac: 0, accuracy: 4, alignRestriction: 0, constitution: 0, dexterity: 0,
        getHistories: [], getMob: null, getQuest: null, id: 8, mind: 0,
        modifiedBy: "Tester", name: "Held focus", notes: "", perception: 0,
        rent: 0, slot: 2, slots: [15], spirit: 0, strength: 0, weaponType: 0
    };
    const shared = {
        cookies: {}, displayDateTime: function() { return ""; }, normalizeTheme,
        permissions: {hasPermission: function() { return false; }}, title: "Details",
        url: {path: "/items/details.html"}, user: null, version: "test"
    };
    const html = await ejs.renderFile(path.join(__dirname, "../src/views/items/display.ejs"), {
        ...shared,
        locals: shared,
        vm: {
            item, itemNotesHtml: "", historyId: null,
            statCategories: [{name: "Weapon", getItemStatInfo: [
                {display: "Accuracy", type: "int", var: "accuracy"},
                {display: "Weapon Type", type: "select", var: "weaponType"}
            ]}],
            constants: {selectOptions: {
                alignRestriction: ["No restriction"], slot: slots, weaponType: ["Sword"]
            }}
        }
    });

    assert.match(html, />Accuracy<\/dt>\s*<dd[^>]*>4<\/dd>/);
    assert.doesNotMatch(html, />Weapon Type<\/dt>/);
});

test("API error types retain their public status codes", function() {
    const {
        NotFoundError,
        TooManyRequestsError,
        UnauthorizedError
    } = require("../src/routes/api/utils");

    assert.equal(new NotFoundError().extensions.code, 404);
    assert.equal(new TooManyRequestsError().extensions.code, 429);
    assert.equal(new UnauthorizedError().extensions.code, 401);
});

// Catches widening the global parsers instead of only the GraphQL route, or
// allowing body-parser diagnostics/submitted Builder data into a 413 response.
test("Builder API accepts a canonical quota-sized profile while larger API and ordinary form bodies stay limited", async function(t) {
    const loggedErrors = [];
    const baseUrl = await listenForTest(t, loadAppForBodyLimitTest({
        logError: error => loggedErrors.push(error)
    }));
    const query = `mutation Store($authToken: String!, $name: String!, $payload: String!, $storageGeneration: Int!) {
        createBuilderProfile(authToken: $authToken, name: $name, payload: $payload, storageGeneration: $storageGeneration) {
            status
        }
    }`;

    const compactFields = "0U0U0U0U0U0U000000___00000000000000000" + "_".repeat(35);
    function canonicalProfileWithBytes(byteLength) {
        const prefix = "6*Hero~";
        const suffix = `~${compactFields}*`;
        const variantBytes = byteLength - Buffer.byteLength(prefix + suffix, "utf8");
        assert.ok(variantBytes > 0);
        const payload = prefix + "A".repeat(variantBytes) + suffix;
        assert.equal(Buffer.byteLength(payload, "utf8"), byteLength);
        return payload;
    }

    const quotaBytes = 10 * 1024 * 1024;
    const acceptedPayload = canonicalProfileWithBytes(quotaBytes);
    const {validateBuilderProfile} = require("../src/routes/api/builder-payload");
    const validated = await validateBuilderProfile({name: "Hero", payload: acceptedPayload});
    assert.equal(validated.payload, acceptedPayload);
    assert.equal(validated.byteLength, quotaBytes);
    const acceptedEnvelope = JSON.stringify({
        query,
        variables: {
            authToken: "invalid",
            name: "Hero",
            payload: acceptedPayload,
            storageGeneration: 1
        }
    });
    assert.ok(Buffer.byteLength(acceptedEnvelope, "utf8") < 11 * 1024 * 1024);

    const accepted = await fetch(`${baseUrl}/api`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: acceptedEnvelope
    });
    const acceptedBody = await accepted.json();
    assert.equal(accepted.status, 200);
    assert.equal(acceptedBody.errors[0].code, 401);

    const privateMarker = "PrivateOversizedBuilderPayload";
    const oversizedPayload = canonicalProfileWithBytes(12 * 1024 * 1024)
        .replace("6*Hero~", `6*Hero~${privateMarker}`);
    const oversizedEnvelope = JSON.stringify({
        query,
        variables: {
            authToken: "invalid",
            name: "Hero",
            payload: oversizedPayload,
            storageGeneration: 1
        }
    });
    assert.ok(Buffer.byteLength(oversizedEnvelope, "utf8") > 11 * 1024 * 1024);
    const oversized = await fetch(`${baseUrl}/api`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: oversizedEnvelope
    });
    const oversizedText = await oversized.text();
    assert.equal(oversized.status, 413);
    assert.match(oversized.headers.get("content-type"), /^application\/json/);
    assert.deepEqual(JSON.parse(oversizedText), {
        errors: [{message: "Request body is too large.", code: 413}]
    });
    assert.equal(oversizedText.includes(privateMarker), false);

    const form = await fetch(`${baseUrl}/login.html`, {
        method: "POST",
        headers: {"Content-Type": "application/x-www-form-urlencoded"},
        body: `value=${"x".repeat(110 * 1024)}`
    });
    assert.equal(form.status, 413);
    assert.match(form.headers.get("content-type"), /^text\/html/);
    assert.match(await form.text(), /Request body is too large/);
    assert.deepEqual(loggedErrors, []);
});
