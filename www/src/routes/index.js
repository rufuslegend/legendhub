let router = require("express").Router();
let auth = require("./api/auth");
let apiUtils = require("./api/utils");
let mysql = require("./api/mysql-connection");

router.get(["/", "/index.html"], function(req, res) {
    return res.render("index", {
        title: "Home",
        showDiscordWidget: false
    });
});

router.get(["/login.html"], function(req, res) {
    return res.render("login", {title: "Login", vm: {body: {}}});
});

router.post(["/login.html"], async function(req, res) {
    const body = req.body || {};
    let vm = {body};

    if (body.login_username) {
        let query = `
        mutation {
            authLogin(username:"${body.login_username}",
                password:"${body.login_password}",
                stayLoggedIn:${!!body.login_stayLoggedIn}) {
                token
                expires
            }
        }
        `;

        let data;
        try {
            data = await apiUtils.postAsync(query, req.ip);
        }
        catch (e) {
            vm.login_error = e.message;
            return res.render("login", {title: "Login", vm});
        }

        let cookieOptions = {
            path: "/",
            expires: new Date(data.authLogin.expires),
            secure: true,
            sameSite: true
        };

        if (data.authLogin.expires != null) {
            cookieOptions.expires = new Date(data.authLogin.expires);
        }
        else {
            cookieOptions.expires = 0;
        }

        res.cookie(
            "loginToken",
            data.authLogin.token,
            cookieOptions
        );
        return res.redirect(body.returnUrl || "/");
    }
    else if (body.register_username) {
        let recaptcha = body["g-recaptcha-response"];
        if (!recaptcha) {
            vm.register_error = "Error: Please fill out reCAPTCHA.";
            return res.render("login", {title: "Login", vm});
        }

        if (body.register_password !== body.register_confirmPassword) {
            vm.register_error = "Error: Passwords must match.";
            return res.render("login", {title: "Login", vm});
        }

        let data;
        try {
            let query = `
            mutation {
                register(username:"${body.register_username}",
                    password:"${body.register_password}",
                    recaptcha:"${recaptcha}")
            }
            `;
            data = await apiUtils.postAsync(query);
        }
        catch (e) {
            vm.register_error = e.message;
            return res.render("login", {title: "Login", vm});
        }

        if (data.register)
            vm.login_message = "Successfuly registered.";
        else
            vm.register_error = "Error: Register failed.";
        return res.render("login", {title: "Login", vm});
    }
    else {
        return res.render("login", {title: "Login", vm});
    }
});

router.get(["/logout.html"], function(req, res, next) {
    if (req.cookies.loginToken) {
        auth.utils.logout(req.cookies.loginToken);
        delete res.clearCookie("loginToken", { path: "/" });
    }

    res.redirect("/");
});

router.get(["/cookies.html"], function(req, res, next) {
    res.render("cookies", {title: "Cookie Policy"});
});

//router.all(["/play.html"], function(req, res, next) {
    //res.render("play", {title: "Play LegendMUD"});
//});

let getSitemapQuery = function(table) {
    return new Promise(function(resolve, reject) {
        mysql.query(`SELECT Id, ModifiedOn FROM ${table}`,
            [],
            function(error, results, fields) {
                if (error)
                    return reject(new Error(error.sqlMessage));

                resolve(results);
            });
    });
};

router.get(["/sitemap.xml"], async function(req, res, next) {
    res.type("application/xml");

    let sitemapMainText = [];
    sitemapMainText.push(`<url><loc>https://www.legendhub.org/index.html</loc></url>`);
    sitemapMainText.push(`<url><loc>https://www.legendhub.org/login.html</loc></url>`);
    sitemapMainText.push(`<url><loc>https://www.legendhub.org/cookies.html</loc></url>`);

    try {
        var sitemapItems = await getSitemapQuery("Items");
        var sitemapMobs = await getSitemapQuery("Mobs");
        var sitemapQuests = await getSitemapQuery("Quests");
        var sitemapWikiPages = await getSitemapQuery("WikiPages");
    }
    catch (e) {
        return next(e);
    }

    let sitemapItemsText = [];
    for (let i = 0; i < sitemapItems.length; ++i) {
        sitemapItemsText.push(`<url><loc>https://www.legendhub.org/items/details.html?id=${sitemapItems[i].Id}</loc><lastmod>${sitemapItems[i].ModifiedOn.toISOString()}</lastmod></url>`);
    }

    let sitemapMobsText = [];
    for (let i = 0; i < sitemapMobs.length; ++i) {
        sitemapMobsText.push(`<url><loc>https://www.legendhub.org/mobs/details.html?id=${sitemapMobs[i].Id}</loc><lastmod>${sitemapMobs[i].ModifiedOn.toISOString()}</lastmod></url>`);
    }

    let sitemapQuestsText = [];
    for (let i = 0; i < sitemapQuests.length; ++i) {
        sitemapQuestsText.push(`<url><loc>https://www.legendhub.org/quests/details.html?id=${sitemapQuests[i].Id}</loc><lastmod>${sitemapQuests[i].ModifiedOn.toISOString()}</lastmod></url>`);
    }

    let sitemapWikiPagesText = [];
    for (let i = 0; i < sitemapWikiPages.length; ++i) {
        sitemapWikiPagesText.push(`<url><loc>https://www.legendhub.org/wiki/details.html?id=${sitemapWikiPages[i].Id}</loc><lastmod>${sitemapWikiPages[i].ModifiedOn.toISOString()}</lastmod></url>`);
    }

    let sitemapText = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="https://www.sitemaps.org/schemas/sitemap/0.9">${sitemapMainText.join("")}${sitemapItemsText.join("")}${sitemapMobsText.join("")}${sitemapQuestsText.join("")}${sitemapWikiPagesText.join("")}</urlset>`;

    res.send(sitemapText);
});

module.exports = router;
