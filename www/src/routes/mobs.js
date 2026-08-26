let router = require("express").Router();
let itemApi = require("./api/items");
let apiUtils = require("./api/utils");
let {renderMarkdown} = require("../markdown");
let {booleanParam, buildListUrl, integerParam, pageParam, sortParam, stringParam} = require("./list-params");
let {requireSameOrigin} = require("./request-security");

const MOB_SORT_FIELDS = ["modifiedOn", "name", "areaName", "xp", "gold", "aggro"];

router.get(["/", "/index.html"], async function(req, res, next) {
    let page = pageParam(req.query.page);
    let rows = 20;
    const searchString = stringParam(req.query.search);
    const eraId = integerParam(req.query.eraId);
    const areaId = integerParam(req.query.areaId);
    const sortBy = sortParam(req.query.sortBy, MOB_SORT_FIELDS);
    const sortAsc = booleanParam(req.query.sortAsc);
    let getMobsQuery = `
    query MobList(
        $searchString: String
        $eraId: Int
        $areaId: Int
        $sortBy: String
        $sortAsc: Boolean
        $page: Int!
        $rows: Int!
    ) {
        getMobs(
        searchString: $searchString
        eraId: $eraId
        areaId: $areaId
        sortBy: $sortBy
        sortAsc: $sortAsc
        page: $page
        rows: $rows) {
            moreResults
            mobs {
                id
                name
                eraName
                areaName
                xp
                gold
                aggro
            }
        }
        getEras {
            id
            name
            getAreas {
                id
                name
            }
        }
    }
    `;

    try {
        var data = await apiUtils.postAsync(getMobsQuery, undefined, {
            searchString,
            eraId,
            areaId,
            sortBy,
            sortAsc,
            page,
            rows
        });
    }
    catch (e) {
        return next(e);
    }

    let mobs = data.getMobs.mobs;
    let moreResults = data.getMobs.moreResults;
    let categories = data.getEras;
    let activeCategory = "";
    for (let i = 0; i < categories.length; ++i) {
        categories[i].subcategories = categories[i].getAreas;

        if (categories[i].id == eraId) {
            if (areaId) {
                for (let j = 0; j < categories[i].subcategories.length; ++j) {
                    if (categories[i].subcategories[j].id == areaId)
                        activeCategory = categories[i].subcategories[j].name;
                }
            }
            else {
                activeCategory = categories[i].name;
            }
        }
    }

    const path = "/mobs/index.html";
    const searchParams = {search: searchString};
    const categoryParams = {...searchParams, eraId, areaId};
    const sortParams = {...categoryParams, sortBy, sortAsc};
    let vm = {
        query: {search: searchString, eraId, areaId, sortBy, sortAsc},
        noSearch: searchString == null && !eraId && !areaId,
        searchString,
        results: mobs,
        moreResults: moreResults,
        page: page,
        rows: rows,
        categories: categories,
        categoryId: eraId,
        subcategoryId: areaId,
        activeCategory: activeCategory,
        urls: {
            form: path,
            search: buildListUrl(path, searchParams),
            category: (nextEraId, nextAreaId) => buildListUrl(path, {...searchParams, eraId: nextEraId, areaId: nextAreaId}),
            sort: (nextSortBy, nextSortAsc) => buildListUrl(path, {...categoryParams, sortBy: nextSortBy, sortAsc: nextSortAsc}),
            page: nextPage => buildListUrl(path, nextPage === 1 ? sortParams : {...sortParams, page: nextPage}),
            canonical: buildListUrl(path, {...sortParams, page})
        },
        cookies: req.cookies
    };
    let title = vm.noSearch ? "Recent Mobs" : `${mobs.length}${moreResults?"+":""} mob results for "${searchString || ""}"`;
    res.render("mobs/index", {title, vm});
});

router.get(["/details.html"], async function(req, res, next) {
    const id = integerParam(req.query.id);
    if (res.locals.user)
        res.locals.user.notifications = await apiUtils.handleNotifications(req.cookies.loginToken, res.locals.user.notifications, 'mob', id);

    let getMobQuery = `
    query MobDetails($id: Int!) {
        getMobById(id: $id) {
            id
            name
            xp
            areaId
            areaName
            eraId
            eraName
            gold
            modifiedOn
            modifiedBy
            modifiedByIP
            notes
            aggro

            getItems {
                id
                name
                slot
            }

            getHistories {
                id
                mob {
                    modifiedBy
                    modifiedOn
                }
            }
        }
    }
    `;

    try {
        var data = await apiUtils.postAsync(getMobQuery, undefined, {
            id
        });
    }
    catch (e) {
        return next(e);
    }

    let mob = data.getMobById;
    let vm = {
        mob,
        mobNotesHtml: renderMarkdown(mob.notes),
        constants: itemApi.constants
    }
    let title = mob.name;
    res.locals.breadcrumbs = [
        {
            "display": "Mobs",
            "href": "/mobs/",
        }
    ];
    if (mob.eraId) {
        res.locals.breadcrumbs.push(
            {
                "display": mob.eraName,
                "href": `/mobs/index.html?eraId=${mob.eraId}`
            }
        );
    }
    if (mob.areaId) {
        res.locals.breadcrumbs.push(
            {
                "display": mob.areaName,
                "href": `/mobs/index.html?eraId=${mob.eraId}&areaId=${mob.areaId}`
            }
        );
    }
    res.locals.breadcrumbs.push(
        {
            "display": mob.name,
            "active": true
        }
    );
    res.render("mobs/display", {title, vm});
});

router.get(["/history.html"], async function(req, res, next) {
    let getMobQuery = `
    query MobHistory($id: Int!) {
        getMobHistoryById(id: $id) {
            mob {
                id
                name
                xp
                areaId
                areaName
                eraId
                eraName
                gold
                modifiedOn
                modifiedBy
                modifiedByIP
                notes
                aggro

                getItems {
                    id
                    name
                    slot
                }

                getHistories {
                    id
                    mob {
                        name
                        modifiedBy
                        modifiedOn
                    }
                }
            }
        }
    }
    `;

    try {
        var data = await apiUtils.postAsync(getMobQuery, undefined, {
            id: integerParam(req.query.id)
        });
    }
    catch (e) {
        return next(e);
    }

    let mob = data.getMobHistoryById.mob;
    let vm = {
        mob,
        mobNotesHtml: renderMarkdown(mob.notes),
        constants: itemApi.constants,
        historyId: req.query.id
    };
    let title = `History for ${mob.name}`;
    res.locals.breadcrumbs = [
        {
            display: "Mobs",
            href: "/mobs/",
        }
    ];
    if (mob.eraId) {
        res.locals.breadcrumbs.push(
            {
                "display": mob.eraName,
                "href": `/mobs/index.html?eraId=${mob.eraId}`
            }
        );
    }
    if (mob.areaId) {
        res.locals.breadcrumbs.push(
            {
                "display": mob.areaName,
                "href": `/mobs/index.html?eraId=${mob.eraId}&areaId=${mob.areaId}`
            }
        );
    }
    res.locals.breadcrumbs.push(
        {
            display: mob.name,
            href: `/mobs/details.html?id=${mob.id}`
        },
        {
            display: new Date(mob.modifiedOn).toISOString().slice(0, 16).replace("T", " ") + " UTC",
            active: true
        }
    );
    res.render("mobs/display", {title, vm});
});

router.get(["/edit.html"], async function(req, res, next) {
    if (!res.locals.user)
        return res.redirect(`/login.html?returnUrl=${encodeURIComponent(res.locals.url.path)}`);

    let getMobQuery = `
    query MobEdit($id: Int!) {
        getMobById(id: $id) {
            id
            name
            xp
            areaId
            areaName
            eraId
            eraName
            gold
            notes
            aggro
        }
        getAreas {
            id
            name
            eraName
        }
    }
    `;

    try {
        var data = await apiUtils.postAsync(getMobQuery, undefined, {
            id: integerParam(req.query.id)
        });
    }
    catch (e) {
        return next(e);
    }

    let mob = data.getMobById;
    let vm = {
        mob,
        areas: data.getAreas
    }
    let title = "Edit Mob";
    res.locals.breadcrumbs = [
        {
            display: "Mobs",
            href: "/mobs/",
        }
    ];
    if (mob.eraId) {
        res.locals.breadcrumbs.push(
            {
                "display": mob.eraName,
                "href": `/mobs/index.html?eraId=${mob.eraId}`
            }
        );
    }
    if (mob.areaId) {
        res.locals.breadcrumbs.push(
            {
                "display": mob.areaName,
                "href": `/mobs/index.html?eraId=${mob.eraId}&areaId=${mob.areaId}`
            }
        );
    }
    res.locals.breadcrumbs.push(
        {
            display: mob.name,
            href: `/mobs/details.html?id=${mob.id}`
        },
        {
            display: "Edit",
            active: true
        }
    );
    res.render("mobs/modify", {title, vm});
});

router.get(["/add.html"], async function(req, res, next) {
    if (!res.locals.user)
        return res.redirect(`/login.html?returnUrl=${encodeURIComponent(res.locals.url.path)}`);

    let getMobQuery = `
    {
        getAreas {
            id
            name
            eraName
        }
    }
    `;

    try {
        var data = await apiUtils.postAsync(getMobQuery);
    }
    catch (e) {
        return next(e);
    }

    let vm = {
        mob: {
            xp: 0,
            gold: 0,
            aggro: false
        },
        areas: data.getAreas
    };
    let title = "Add Mob";
    res.locals.breadcrumbs = [
        {
            display: "Mobs",
            href: "/mobs/",
        },
        {
            display: "Add",
            active: true
        }
    ];
    res.render("mobs/modify", {title, vm});
});

router.post(["/revert.html"], requireSameOrigin, async function(req, res, next) {
    if (!res.locals.user)
        return res.redirect("/login.html");

    let revertQuery = `
    mutation($authToken: String!, $historyId: Int!) {
        revertMob(authToken: $authToken, historyId: $historyId) {
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

    data = data.revertMob;
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
    res.redirect(`/mobs/details.html?id=${data.id}`);
});

router.post(["/delete.html"], requireSameOrigin, async function(req, res, next) {
    if (!res.locals.user)
        return res.redirect("/login.html");

    let deleteQuery = `
    mutation($authToken: String!, $id: Int!) {
        deleteMob(authToken: $authToken, id: $id) {
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
        data.deleteMob.token,
        {
            path: "/",
            expires: data.deleteMob.expires,
            secure: true,
            sameSite: true
        }
    );
    res.redirect(`/mobs/`);
});

module.exports = router;
