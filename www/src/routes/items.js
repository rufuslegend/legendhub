let router = require("express").Router();
let itemApi = require("./api/items");
let apiUtils = require("./api/utils");
let {renderMarkdown} = require("../markdown");
let {booleanParam, buildListUrl, integerParam, pageParam, stringParam} = require("./list-params");
let {requireSameOrigin} = require("./request-security");

router.get(["/", "/index.html"], async function(req, res, next) {
    let page = pageParam(req.query.page);
    let rows = 20;
    const searchString = stringParam(req.query.search);
    const filterString = stringParam(req.query.filters);
    const sortBy = stringParam(req.query.sortBy);
    const sortAsc = booleanParam(req.query.sortAsc);
    let getItemsQuery = `
    ${itemApi.fragment}

    query ItemPage($searchString: String, $filterString: String, $sortBy: String, $sortAsc: Boolean, $page: Int!, $rows: Int!) {
        getItems(
        searchString: $searchString,
        filterString: $filterString,
        sortBy: $sortBy,
        sortAsc: $sortAsc,
        page: $page,
        rows: $rows) {
            moreResults
            items {
                ... ItemAll
            }
        }
        getItemStatCategories {
            name
            getItemStatInfo {
                display
                short
                var
                type
                filterString
                showColumnDefault
            }
        }
        getItemStatInfo {
            display
            short
            var
            type
            filterString
            showColumnDefault
        }
    }
    `;

    try {
        var data = await apiUtils.postAsync(getItemsQuery, undefined, {
            searchString,
            filterString,
            sortBy,
            sortAsc,
            page,
            rows
        });
    }
    catch (e) {
        return next(e);
    }

    let items = data.getItems.items;
    let moreResults = data.getItems.moreResults;
    let statCategories = data.getItemStatCategories;
    let statInfo = data.getItemStatInfo;

    let selectedColumns = [];
    if (req.cookies.sc2) {
        selectedColumns = req.cookies.sc2.split('-');
    }
    else {
        for (let i = 0; i < statInfo.length; ++i) {
            if (statInfo[i].showColumnDefault) {
                selectedColumns.push(statInfo[i].short);
            }
        }
    }

    let selectedFilters = {};
    if (filterString) {
        let filterStrings = filterString.split(",");
        for (let i = 0; i < filterStrings.length; ++i) {
            let splitFilter = filterStrings[i].split("_");
            selectedFilters[splitFilter[0]] = splitFilter.slice(1);
        }
    }

    const path = "/items/index.html";
    const searchParams = {search: searchString, filters: filterString};
    const sortParams = {...searchParams, sortBy, sortAsc};
    let vm = {
        query: {search: searchString, filters: filterString, sortBy, sortAsc},
        noSearch: searchString == null && !filterString,
        searchString,
        results: items,
        moreResults: moreResults,
        page: page,
        rows: rows,
        selectedColumns: selectedColumns,
        selectedFilters: selectedFilters,
        itemStatCategories: statCategories,
        itemStatInfo: statInfo,
        constants: itemApi.constants,
        cookies: req.cookies,
        urls: {
            canonical: buildListUrl(path, {...sortParams, page})
        }
    };
    let title = vm.noSearch ? "Recent Items" : `${items.length}${moreResults?"+":""} item results for "${searchString || ""}"`;
    res.render("items/index", { title, vm });
});

router.get(["/details.html"], async function(req, res, next) {
    if (res.locals.user)
        res.locals.user.notifications = await apiUtils.handleNotifications(req.cookies.loginToken, res.locals.user.notifications, 'item', req.query.id);

    let getItemQuery = `${itemApi.fragment}

    query ItemDetails($id: Int!) {
        getItemById(id: $id) {
            ... ItemAll
            getMob {
                id
                name
                areaName
            }
            getQuest {
                id
                title
                areaName
            }
            getHistories {
                id
                item {
                    ... ItemAll
                }
            }
        }
        getItemStatCategories {
            name
            getItemStatInfo {
                display
                short
                var
                type
                filterString
                showColumnDefault
            }
        }
    }
    `;

    try {
        var data = await apiUtils.postAsync(getItemQuery, undefined, {
            id: integerParam(req.query.id)
        });
    }
    catch (e) {
        return next(e);
    }
    let item = data.getItemById;
    let statCategories = data.getItemStatCategories;

    let vm = {
        item,
        itemNotesHtml: renderMarkdown(item.notes),
        statCategories,
        constants: itemApi.constants,
    }
    let title = item.name;
    res.locals.breadcrumbs = [
        {
            "display": "Items",
            "href": "/items/",
        },
        {
            "display": item.name,
            "active": true
        }
    ];
    res.render("items/display", { title, vm });
});

router.get(["/history.html"], async function(req, res, next) {
    let getItemQuery = `${itemApi.fragment}

    query ItemHistory($id: Int!) {
        getItemHistoryById(id: $id) {
            item {
                ... ItemAll
                getMob {
                    id
                    name
                    areaName
                }
                getQuest {
                    id
                    title
                    areaName
                }
                getHistories {
                    id
                    item {
                        ... ItemAll
                    }
                }
            }
        }
        getItemStatCategories {
            name
            getItemStatInfo {
                display
                short
                var
                type
                filterString
                showColumnDefault
            }
        }
    }
    `;

    try {
        var data = await apiUtils.postAsync(getItemQuery, undefined, {
            id: integerParam(req.query.id)
        });
    }
    catch (e) {
        return next(e);
    }
    let item = data.getItemHistoryById.item;
    let statCategories = data.getItemStatCategories;

    let vm = {
        item,
        itemNotesHtml: renderMarkdown(item.notes),
        statCategories,
        constants: itemApi.constants,
        historyId: req.query.id
    }
    let title = `History for ${item.name}`;

    res.locals.breadcrumbs = [
        {
            display: "Items",
            href: "/items/",
        },
        {
            display: item.name,
            href: `/items/details.html?id=${item.id}`
        },
        {
            display: new Date(item.modifiedOn).toISOString().slice(0, 16).replace("T", " ") + " UTC",
            active: true
        }
    ];
    res.render("items/display", { title, vm });
});

router.post(["/revert.html"], requireSameOrigin, async function(req, res, next) {
    if (!res.locals.user)
        return res.redirect("/login.html");

    let revertQuery = `
    mutation($authToken: String!, $historyId: Int!) {
        revertItem(authToken: $authToken, historyId: $historyId) {
            id
            tokenRenewal {
                token
                expires
            }
        }
    }
    `;

    try {
        var data = await apiUtils.postAsync(revertQuery, req.ip, {
            authToken: req.cookies.loginToken,
            historyId: integerParam(req.body.id)
        });
    }
    catch (e) {
        return next(e);
    }

    data = data.revertItem;
    let cookieOptions = {
        path: "/",
        secure: true,
        sameSite: true
    };
    if (data.tokenRenewal.expires)
        cookieOptions.expires = new Date(data.tokenRenewal.expires);
    res.cookie(
        "loginToken",
        data.tokenRenewal.token,
        cookieOptions
    );
    res.redirect(`/items/details.html?id=${data.id}`);
});

router.get(["/add.html"], async function(req, res, next) {
    if (!res.locals.user)
        return res.redirect(`/login.html?returnUrl=${encodeURIComponent(res.locals.url.path)}`);

    let query = `
    {
        getItemStatCategories {
            name
            getItemStatInfo {
                display
                short
                var
                type
                editable
                defaultValue
            }
        }
    }
    `;

    try {
        var data = await apiUtils.postAsync(query);
    }
    catch (e) {
        return next(e);
    }

    let itemStatCategories = data.getItemStatCategories;
    let title = "Add Item";

    // setup defaults
    let item = {};
    for (let i = 0; i < itemStatCategories.length; ++i) {
        for (let j = 0; j < itemStatCategories[i].getItemStatInfo.length; ++j) {
            let stat = itemStatCategories[i].getItemStatInfo[j];
            if (!stat.editable) continue;

            if (!stat.defaultValue) {
                item[stat.var] = undefined;
            }
            else {
                if (stat.type === "int" || stat.type === "select") {
                    item[stat.var] = parseInt(stat.defaultValue);
                } else if (stat.type === "decimal") {
                    item[stat.var] = parseFloat(stat.defaultValue);
                } else if (stat.type === "bool") {
                    item[stat.var] = stat.defaultValue == "true";
                } else if (stat.type === "string") {
                    item[stat.var] = stat.defaultValue;
                }
            }
        }
    }

    let vm = {
        item,
        itemStatCategories,
        constants: itemApi.constants
    };
    res.locals.breadcrumbs = [
        {
            display: "Items",
            href: "/items/",
        },
        {
            display: "Add",
            active: true
        }
    ];
    res.render("items/modify", {title, vm})
});

router.get(["/edit.html"], async function(req, res, next) {
    if (!res.locals.user)
        return res.redirect(`/login.html?returnUrl=${encodeURIComponent(res.locals.url.path)}`);

    let query = `${itemApi.fragment}

    query ItemEdit($id: Int!) {
        getItemById(id: $id) {
            ... ItemAll

            getMob {name}
            getQuest {title}
        }
        getItemStatCategories {
            name
            getItemStatInfo {
                display
                short
                var
                type
                editable
            }
        }
    }
    `;

    try {
        var data = await apiUtils.postAsync(query, undefined, {
            id: integerParam(req.query.id)
        });
    }
    catch (e) {
        return next(e);
    }

    let item = data.getItemById;
    let itemStatCategories = data.getItemStatCategories;
    let title = `Edit ${item.name}`;
    let vm = {
        item,
        itemFragment: itemApi.fragment,
        itemStatCategories,
        constants: itemApi.constants
    };

    res.locals.breadcrumbs = [
        {
            display: "Items",
            href: "/items/",
        },
        {
            display: item.name,
            href: `/items/details.html?id=${item.id}`
        },
        {
            display: "Edit",
            active: true
        }
    ];
    res.render("items/modify", {title, vm});
});

router.post(["/delete.html"], requireSameOrigin, async function(req, res, next) {
    if (!res.locals.user)
        return res.redirect("/login.html");

    let deleteQuery = `
    mutation($authToken: String!, $id: Int!) {
        deleteItem(authToken: $authToken, id: $id) {
            token,
            expires
        }
    }
    `;

    try {
        var data = await apiUtils.postAsync(deleteQuery, req.ip, {
            authToken: req.cookies.loginToken,
            id: integerParam(req.body.id)
        });
    }
    catch (e) {
        return next(e);
    }

    res.cookie(
        "loginToken",
        data.deleteItem.token,
        {
            path: "/",
            expires: data.deleteItem.expires,
            secure: true,
            sameSite: true
        }
    );
    res.redirect(`/items/`);
});


module.exports = router;
