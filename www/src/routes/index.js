let router = require("express").Router();
let auth = require("./api/auth");
let apiUtils = require("./api/utils");
let mysql = require("./api/mysql-connection");
let {normalizeReturnUrl, requireSameOrigin} = require("./request-security");

const EMAIL_PROMPT_COOKIE_OPTIONS = Object.freeze({
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "lax"
});

router.get(["/", "/index.html"], function(req, res) {
    return res.render("index", {
        title: "Home",
        showDiscordWidget: false
    });
});

router.get(["/login.html"], function(req, res) {
    return res.render("login", {title: "Login", vm: {body: {}}});
});

router.post(["/login.html"], requireSameOrigin, async function(req, res) {
    const body = req.body || {};
    const stringBody = name => typeof body[name] === "string" ? body[name] : "";
    let vm = {body: {
        login_username: stringBody("login_username"),
        register_username: stringBody("register_username"),
        register_email: stringBody("register_email")
    }};

    if (vm.body.login_username) {
        let query = `
        mutation AuthLogin($identity: String, $password: String, $stayLoggedIn: Boolean) {
            authLogin(identity: $identity, password: $password, stayLoggedIn: $stayLoggedIn) {
                token
                expires
            }
        }
        `;

        let data;
        try {
            data = await apiUtils.postAsync(query, req.ip, {
                identity: vm.body.login_username,
                password: stringBody("login_password"),
                stayLoggedIn: body.login_stayLoggedIn === "on" || body.login_stayLoggedIn === "true"
            });
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
        res.clearCookie("emailPromptDismissed", EMAIL_PROMPT_COOKIE_OPTIONS);
        return res.redirect(normalizeReturnUrl(body.returnUrl));
    }
    else if (vm.body.register_username) {
        if (!vm.body.register_email) {
            vm.register_error = "Error: Please enter an email address.";
            return res.render("login", {title: "Login", vm});
        }

        let recaptcha = stringBody("g-recaptcha-response");
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
            mutation Register($username: String, $email: String!, $password: String, $recaptcha: String) {
                register(username: $username, email: $email, password: $password, recaptcha: $recaptcha)
            }
            `;
            data = await apiUtils.postAsync(query, undefined, {
                username: vm.body.register_username,
                email: vm.body.register_email,
                password: stringBody("register_password"),
                recaptcha
            });
        }
        catch (e) {
            vm.register_error = e.message;
            return res.render("login", {title: "Login", vm});
        }

        if (data.register)
            vm.login_message = "Successfully registered. Check your email to verify your account. If it does not arrive, use resend verification.";
        else
            vm.register_error = "Error: Register failed.";
        return res.render("login", {title: "Login", vm});
    }
    else {
        return res.render("login", {title: "Login", vm});
    }
});

router.post(["/logout.html"], requireSameOrigin, function(req, res) {
    if (req.cookies.loginToken) {
        auth.utils.logout(req.cookies.loginToken);
        res.clearCookie("loginToken", {path: "/"});
    }

    res.clearCookie("emailPromptDismissed", EMAIL_PROMPT_COOKIE_OPTIONS);

    res.redirect("/");
});

router.get(["/cookies.html"], function(req, res, next) {
    res.render("cookies", {title: "Cookie Policy"});
});

router.get(["/privacy.html"], function(req, res, next) {
    res.render("privacy", {title: "Privacy Policy"});
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
    sitemapMainText.push(`<url><loc>https://www.legendhub.org/privacy.html</loc></url>`);

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
