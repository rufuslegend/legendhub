const pair = function(reference, candidate) {
    return {reference, candidate};
};

const page = function(name, route, ready, structuralTargets, extra = {}) {
    return {name, route, ready, capture: {kind: "page"}, structuralTargets, ...extra};
};

const target = function(name, selector, checkNames = []) {
    return {
        name,
        selector,
        checks: Object.fromEntries(checkNames.map(function(checkName) {
            return [checkName, true];
        }))
    };
};

const builderRoot = pair(
    "body[ng-controller='builder'] .container-fluid",
    "[data-react-root='builder'] main.container-fluid"
);
const itemsRoot = pair(
    "body[ng-controller='items'] .container-fluid",
    "[data-react-root='items'] main.container-fluid"
);
const accountRoot = pair(
    "body[ng-controller='account'] .container",
    "[data-react-root='account-settings'] main.container"
);
const editorRoot = function(legacyController, reactRoot) {
    return pair(
        `body[ng-controller='${legacyController}'] .container`,
        `[data-react-root='${reactRoot}'] .container`
    );
};

const notificationButton = "[data-notification-popover]";
const standardContainer = ".container";
const standardResults = ".container-fluid";
const builderColumns = pair(
    "button[data-target='#columnsModal']",
    "button:has-text('Hide/Show Columns')"
);

const SCENARIOS = [
    page("home-shell", "/", ".container-fluid.px-5", [target("home content", ".container-fluid.px-5", ["text"])]),
    page("login", "/login.html", "#loginCollapse", [target("login card", "form[name='login']", ["text", "childOrder"])]),
    page("registration-panel", "/login.html", "#registerCollapse", [
        target("registration card", "form[name='register']", ["text", "childOrder"]),
        target("captcha", ".g-recaptcha")
    ], {
        actions: [{type: "click", target: "#registerHeading button"}],
        masks: [{kind: "captcha", selector: ".g-recaptcha"}]
    }),
    page("notifications-popover", "/", notificationButton, [target("notification popover", "#notification-window", ["text", "icons", "childOrder"])], {
        authenticated: true,
        actions: [{type: "click", target: notificationButton}]
    }),
    page("notifications-list", "/notifications/", standardContainer, [target("notification list", standardContainer, ["text", "childOrder"])], {
        authenticated: true
    }),
    page("account-settings", "/account/", accountRoot, [target("account settings", accountRoot, ["text", "childOrder"])], {
        authenticated: true
    }),
    page("changelog", "/changelog/", "main.container", [target("changelog", "main.container", ["text", "childOrder"])]),
    page("builder-populated", "/builder/", builderRoot, [target("equipment table", pair(
        ".row[ng-show='statInfo != null'] .table-responsive > table.table-bordered",
        ".builder-equipment-table"
    ), ["text", "icons", "childOrder", "wrapping"])], {
        seed: {builderState: {cln: "Parity", scl: "Parity"}},
        actions: [{type: "set-builder-state", target: builderRoot, state: {cln: "Parity", scl: "Parity"}}]
    }),
    page("builder-columns", "/builder/", builderRoot, [target("columns dialog", "#columnsModal", ["text", "childOrder", "wrapping"])], {
        seed: {builderState: {cln: "Parity", scl: "Parity"}},
        actions: [{type: "click", target: builderColumns}]
    }),
    page("builder-item-picker", "/builder/", builderRoot, [target("item picker", "#itemChoiceModal", ["text", "icons", "childOrder", "wrapping"])], {
        seed: {builderState: {cln: "Parity", scl: "Parity"}},
        actions: [{type: "click", target: pair(
            ".table-bordered tbody tr:nth-child(2) th[ng-click]",
            ".builder-equipment-table button[aria-label^='Choose']"
        )}]
    }),
    page("builder-warning", "/builder/", builderRoot, [target("builder warning", pair(
        ".table-bordered tbody tr:nth-child(2) td[data-toggle='tooltip']",
        ".builder-warning-cell"
    ), ["text", "wrapping"])], {
        seed: {builderState: {cln: "Parity", scl: "Parity", fixture: "limited"}},
        actions: [
            {type: "set-builder-state", target: builderRoot, state: {cln: "Parity", scl: "Parity", fixture: "limited"}},
            {type: "hover", target: pair(
                ".table-bordered tbody tr:nth-child(2) td[data-toggle='tooltip']",
                ".builder-warning-cell"
            )}
        ]
    }),
    page("items-results", "/items/?search=Parity", itemsRoot, [target("item results", itemsRoot, ["text", "childOrder"])]),
    page("items-columns", "/items/?search=Parity", itemsRoot, [target("columns dialog", "#columnsModal", ["text", "childOrder", "wrapping"])], {
        actions: [{type: "click", target: pair("button[data-target='#columnsModal']", "button:has-text('Columns')")}]
    }),
    page("items-filters", "/items/?search=Parity", itemsRoot, [target("filters dialog", "#filtersModal", ["text", "childOrder", "wrapping"])], {
        actions: [{type: "click", target: pair("button[data-target='#filtersModal']", "button:has-text('Filters')")}]
    }),
    page("item-details", "/items/details.html?id=900001", standardContainer, [target("item details", standardContainer, ["text", "childOrder"])]),
    page("item-history", "/items/history.html?id=900001", standardContainer, [target("item history", standardContainer, ["text", "childOrder"])]),
    page("item-editor", "/items/edit.html?id=900001", editorRoot("ModifyItemsController as modifyItems", "item-editor"), [
        target("item editor", editorRoot("ModifyItemsController as modifyItems", "item-editor"), ["text", "childOrder"])
    ], {authenticated: true}),
    page("mobs-results", "/mobs/?search=Parity", standardResults, [target("mob results", standardResults, ["text", "childOrder"])]),
    page("mob-details", "/mobs/details.html?id=900001", standardContainer, [target("mob details", standardContainer, ["text", "childOrder"])]),
    page("mob-history", "/mobs/history.html?id=900001", standardContainer, [target("mob history", standardContainer, ["text", "childOrder"])]),
    page("mob-editor", "/mobs/edit.html?id=900001", editorRoot("ModifyMobsController as modifyMobs", "mob-editor"), [
        target("mob editor", editorRoot("ModifyMobsController as modifyMobs", "mob-editor"), ["text", "childOrder"])
    ], {authenticated: true}),
    page("quests-results", "/quests/?search=Parity", standardResults, [target("quest results", standardResults, ["text", "childOrder"])]),
    page("quest-details", "/quests/details.html?id=900001", standardContainer, [target("quest details", standardContainer, ["text", "childOrder"])]),
    page("quest-history", "/quests/history.html?id=900001", standardContainer, [target("quest history", standardContainer, ["text", "childOrder"])]),
    page("quest-editor", "/quests/edit.html?id=900001", editorRoot("ModifyQuestsController as modifyQuests", "quest-editor"), [
        target("quest editor", editorRoot("ModifyQuestsController as modifyQuests", "quest-editor"), ["text", "childOrder"])
    ], {authenticated: true}),
    page("wiki-results", "/wiki/?search=Parity", standardResults, [target("wiki results", standardResults, ["text", "childOrder"])]),
    page("wiki-details", "/wiki/details.html?id=900001", standardContainer, [target("wiki details", standardContainer, ["text", "childOrder"])]),
    page("wiki-history", "/wiki/history.html?id=900001", standardContainer, [target("wiki history", standardContainer, ["text", "childOrder"])]),
    page("wiki-editor", "/wiki/edit.html?id=900001", editorRoot("ModifyWikiController as modifyWiki", "wiki-editor"), [
        target("wiki editor", editorRoot("ModifyWikiController as modifyWiki", "wiki-editor"), ["text", "childOrder"])
    ], {authenticated: true}),
    page("wiki-smithing-format", "/wiki/details.html?id=900002", standardContainer, [target("wiki content", standardContainer, ["text", "childOrder", "wrapping"])]),
    page("responsive-navigation", "/", "header", [target("navigation menu", "#navbarSupportedContent", ["text", "icons", "childOrder", "wrapping"])], {
        actions: [{type: "click", target: "button.navbar-toggler"}]
    })
];

module.exports = {SCENARIOS};
