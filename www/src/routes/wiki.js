let router = require("express").Router();
let apiUtils = require("./api/utils");
let {renderMarkdown} = require("../markdown");
let {booleanParam, buildListUrl, integerParam, pageParam, sortParam, stringParam} = require("./list-params");
let {requireSameOrigin} = require("./request-security");

const WIKI_SORT_FIELDS = ["modifiedOn", "title", "categoryName", "subcategoryName"];

router.get(["/", "/index.html"], async function(req, res, next) {
    let page = pageParam(req.query.page);
    let rows = 20;
    const searchString = stringParam(req.query.search);
    const categoryId = integerParam(req.query.categoryId);
    const subcategoryId = integerParam(req.query.subcategoryId);
    const sortBy = sortParam(req.query.sortBy, WIKI_SORT_FIELDS);
    const sortAsc = booleanParam(req.query.sortAsc);
    let getWikiPagesQuery = `
    query WikiList(
        $searchString: String
        $categoryId: Int
        $subcategoryId: Int
        $sortBy: String
        $sortAsc: Boolean
        $page: Int!
        $rows: Int!
    ) {
        getWikiPages(
        searchString: $searchString
        categoryId: $categoryId
        subcategoryId: $subcategoryId
        sortBy: $sortBy
        sortAsc: $sortAsc
        page: $page
        rows: $rows) {
            moreResults
            wikiPages {
                id
                title
                categoryName
                subcategoryName
                pinnedRecent
                pinnedSearch
                locked
            }
        }
        getCategories {
            id
            name
            getSubcategories {
                id
                name
            }
        }
    }
    `;

    try {
        var data = await apiUtils.postAsync(getWikiPagesQuery, undefined, {
            searchString,
            categoryId,
            subcategoryId,
            sortBy,
            sortAsc,
            page,
            rows
        });
    }
    catch (e) {
        return next(e);
    }

    let categories = data.getCategories;
    let activeCategory = "";
    for (let i = 0; i < categories.length; ++i) {
        categories[i].subcategories = categories[i].getSubcategories;

        if (categories[i].id == categoryId) {
            if (subcategoryId) {
                for (let j = 0; j < categories[i].subcategories.length; ++j) {
                    if (categories[i].subcategories[j].id == subcategoryId)
                        activeCategory = categories[i].subcategories[j].name;
                }
            }
            else {
                activeCategory = categories[i].name;
            }
        }
    }

    const path = "/wiki/index.html";
    const searchParams = {search: searchString};
    const categoryParams = {...searchParams, categoryId, subcategoryId};
    const sortParams = {...categoryParams, sortBy, sortAsc};
    let vm = {
        query: {search: searchString, categoryId, subcategoryId, sortBy, sortAsc},
        noSearch: searchString == null && !categoryId && !subcategoryId,
        results: data.getWikiPages.wikiPages,
        moreResults: data.getWikiPages.moreResults,
        page: page,
        rows: rows,
        categories: categories,
        categoryId,
        subcategoryId,
        activeCategory: activeCategory,
        urls: {
            form: path,
            search: buildListUrl(path, searchParams),
            category: (nextCategoryId, nextSubcategoryId) => buildListUrl(path, {...searchParams, categoryId: nextCategoryId, subcategoryId: nextSubcategoryId}),
            sort: (nextSortBy, nextSortAsc) => buildListUrl(path, {...categoryParams, sortBy: nextSortBy, sortAsc: nextSortAsc}),
            page: nextPage => buildListUrl(path, nextPage === 1 ? sortParams : {...sortParams, page: nextPage}),
            canonical: buildListUrl(path, {...sortParams, page})
        },
        cookies: req.cookies
    };
    let title = vm.noSearch ? "Recent Wiki Pages" : `${data.getWikiPages.wikiPages.length}${data.getWikiPages.moreResults?"+":""} wiki results for "${searchString || ""}"`;
    res.render("wiki/index", {title, vm});
});

router.get(["/details.html"], async function(req, res, next) {
    if (res.locals.user)
        res.locals.user.notifications = await apiUtils.handleNotifications(req.cookies.loginToken, res.locals.user.notifications, 'wiki page', req.query.id);

    let query = `
    query WikiDetails($id: Int!) {
        getWikiPageById(id: $id) {
            id
            title
            categoryId
            categoryName
            subcategoryId
            subcategoryName
            content
            modifiedOn
            modifiedBy

            getHistories {
                id
                wikiPage {
                    modifiedBy
                    modifiedOn
                }
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

    let wikiPage = data.getWikiPageById;
    let vm = {
        wikiPage,
        wikiContentHtml: renderMarkdown(wikiPage.content)
    };
    let title = wikiPage.title;
    res.locals.breadcrumbs = [
        {
            display: "Wiki",
            href: "/wiki/"
        }
    ];
    if (wikiPage.categoryName) {
        res.locals.breadcrumbs.push(
            {
                display: wikiPage.categoryName,
                href: `/wiki/index.html?categoryId=${wikiPage.categoryId}`
            }
        )
    }
    if (wikiPage.subcategoryName) {
        res.locals.breadcrumbs.push(
            {
                display: wikiPage.subcategoryName,
                href: `/wiki/index.html?categoryId=${wikiPage.categoryId}&subcategoryId=${wikiPage.subcategoryId}`
            }
        )
    }
    res.locals.breadcrumbs.push(
        {
            display: wikiPage.title,
            active: true
        }
    );
    res.render("wiki/display", {title, vm});
});

router.get(["/history.html"], async function(req, res, next) {
    let query = `
    query WikiHistory($id: Int!) {
        getWikiPageHistoryById(id: $id) {
            wikiPage {
                id
                title
                categoryId
                categoryName
                subcategoryId
                subcategoryName
                content
                modifiedOn
                modifiedBy

                getHistories {
                    id
                    wikiPage {
                        modifiedBy
                        modifiedOn
                    }
                }
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

    let wikiPage = data.getWikiPageHistoryById.wikiPage;
    let vm = {
        wikiPage,
        wikiContentHtml: renderMarkdown(wikiPage.content),
        historyId: req.query.id
    };
    let title = `History for ${wikiPage.title}`;
    res.locals.breadcrumbs = [
        {
            display: "Wiki",
            href: "/wiki/"
        }
    ];
    if (wikiPage.categoryName) {
        res.locals.breadcrumbs.push(
            {
                display: wikiPage.categoryName,
                href: `/wiki/index.html?categoryId=${wikiPage.categoryId}`
            }
        )
    }
    if (wikiPage.subcategoryName) {
        res.locals.breadcrumbs.push(
            {
                display: wikiPage.subcategoryName,
                href: `/wiki/index.html?categoryId=${wikiPage.categoryId}&subcategoryId=${wikiPage.subcategoryId}`
            }
        )
    }
    res.locals.breadcrumbs.push(
        {
            display: wikiPage.title,
            href: `/wiki/details.html?id=${wikiPage.id}`
        },
        {
            display: new Date(wikiPage.modifiedOn).toISOString().slice(0, 16).replace("T", " ") + " UTC",
            active: true
        }
    );
    res.render("wiki/display", {title, vm});
});

router.get(["/edit.html"], async function(req, res, next) {
    if (!res.locals.user)
        return res.redirect(`/login.html?returnUrl=${encodeURIComponent(res.locals.url.path)}`);

    let query = `
    query WikiEdit($id: Int!) {
        getWikiPageById(id: $id) {
            id
            title
            categoryId
            categoryName
            subcategoryId
            subcategoryName
            tags
            content
        }
        getCategories {
            id
            name
            getSubcategories {
                id
                name
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


    let subcategories = {};
    for (let i = 0; i < data.getCategories.length; ++i) {
        subcategories[data.getCategories[i].id] = data.getCategories[i].getSubcategories;
    }

    let wikiPage = data.getWikiPageById;
    let vm = {
        wikiPage,
        categories: data.getCategories,
        subcategories: subcategories
    };
    let title = "Edit Wiki Page";
    res.locals.breadcrumbs = [
        {
            display: "Wiki",
            href: "/wiki/",
        }
    ];
    if (wikiPage.categoryId) {
        res.locals.breadcrumbs.push(
            {
                display: wikiPage.categoryName,
                href: `/wiki/index.html?categoryId=${wikiPage.categoryId}`
            }
        )
    }
    if (wikiPage.subcategoryId) {
        res.locals.breadcrumbs.push(
            {
                display: wikiPage.subcategoryName,
                href: `/wiki/index.html?categoryId=${wikiPage.categoryId}&subcategoryId=${wikiPage.subcategoryId}`
            }
        )
    }
    res.locals.breadcrumbs.push(
        {
            display: wikiPage.title,
            href: `/wiki/details.html?id=${wikiPage.id}`
        },
        {
            display: "Edit",
            active: true
        }
    );
    res.render("wiki/modify", {title, vm});
});

router.get(["/add.html"], async function(req, res, next) {
    if (!res.locals.user)
        return res.redirect(`/login.html?returnUrl=${encodeURIComponent(res.locals.url.path)}`);

    let query = `
    {
        getCategories {
            id
            name
            getSubcategories {
                id
                name
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

    let subcategories = {};
    for (let i = 0; i < data.getCategories.length; ++i) {
        subcategories[data.getCategories[i].id] = data.getCategories[i].getSubcategories;
    }

    let vm = {
        wikiPage: {
            tage: "",
            content: ""
        },
        categories: data.getCategories,
        subcategories: subcategories
    };
    let title = "Add Wiki Page";
    res.locals.breadcrumbs = [
        {
            display: "Wiki",
            href: "/wiki/",
        },
        {
            display: "Add",
            active: true
        }
    ];
    res.render("wiki/modify", {title, vm});
});

router.post(["/revert.html"], requireSameOrigin, async function(req, res, next) {
    if (!res.locals.user)
        return res.redirect("/login.html");

    let query = `
    mutation($authToken: String!, $historyId: Int!) {
        revertWikiPage(authToken: $authToken, historyId: $historyId) {
            id
            tokenRenewal {
                token
                expires
            }
        }
    }
    `;

    try {
        var data = await apiUtils.postAsync(query, req.ip, {
            authToken: req.cookies.loginToken,
            historyId: integerParam(req.body.id)
        });
    }
    catch (e) {
        return next(e);
    }

    data = data.revertWikiPage;
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
    res.redirect(`/wiki/details.html?id=${data.id}`);
});

router.post(["/delete.html"], requireSameOrigin, async function(req, res, next) {
    if (!res.locals.user)
        return res.redirect("/login.html");

    let deleteQuery = `
    mutation($authToken: String!, $id: Int!) {
        deleteWikiPage(authToken: $authToken, id: $id) {
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
        data.deleteWikiPage.token,
        {
            path: "/",
            expires: data.deleteWikiPage.expires,
            secure: true,
            sameSite: true
        }
    );
    res.redirect(`/wiki/`);
});

module.exports = router;
