let express = require("express");
let router = express.Router();
let apiUtils = require("./api/utils");
let auth = require("./api/auth");
let {pageParam} = require("./list-params");

router.get(["/", "/index.html"], async function(req, res, next) {
    if (!res.locals.user)
        return res.redirect(`/login.html?returnUrl=${encodeURIComponent(res.locals.url.path)}`);

    let page = pageParam(req.query.page);
    let rows = 20;
    let query = `
    query NotificationsPage($authToken: String!, $page: Int!, $rows: Int!) {
        getNotifications(
        authToken: $authToken
        page: $page
        rows: $rows) {
            moreResults
            results {
                actorName
                count
                createdOn
                link
                objectName
                objectType
                read
                verb
            }
        }
    }
    `;
    try {
        var data = await apiUtils.postAsync(query, undefined, {
            authToken: req.cookies.loginToken,
            page,
            rows
        });
    }
    catch (e) {
        return next(e);
    }

    let vm = {
        query: req.query,
        results: data.getNotifications.results,
        moreResults: data.getNotifications.moreResults,
        page: page,
        rows: rows,
        cookies: req.cookies
    };
    let title = "Notifications";
    res.render("notifications/index", {title, vm});
});

module.exports = router;
