const compression = require("compression");
const cookieParser = require("cookie-parser");
const express = require("express");
const helmet = require("helmet");
const logger = require("morgan");
const path = require("path");

const authRouter = require("./routes/auth");

const indexRouter = require("./routes/index");
const apiRouter = require("./routes/api");
const itemsRouter = require("./routes/items");
const mobsRouter = require("./routes/mobs");
const questsRouter = require("./routes/quests");
const wikiRouter = require("./routes/wiki");
const builderRouter = require("./routes/builder");
const changelogRouter = require("./routes/changelog");
const notificationsRouter = require("./routes/notifications");
const accountRouter = require("./routes/account");

function getErrorStatus(error) {
    const candidates = error ? [error.status, error.statusCode] : [];
    for (const candidate of candidates) {
        const status = Number(candidate);
        if (Number.isInteger(status) && status >= 400 && status <= 599)
            return status;
    }

    return 500;
}

function getPublicErrorMessage(error, status) {
    if (status >= 500)
        return "An unexpected server error occurred.";
    if (error && error.type === "entity.parse.failed")
        return "Invalid request body.";
    if (error && error.type === "entity.too.large")
        return "Request body is too large.";
    if (error && error.expose !== false && error.message)
        return error.message;

    return "The request could not be completed.";
}

function isApiRequest(req) {
    const requestPath = req.path.toLowerCase();
    return requestPath === "/api" || requestPath.startsWith("/api/");
}

module.exports = function createApp(options = {}) {
    const app = express();
    const environment = options.environment || process.env.NODE_ENV;

    app.set("views", path.join(__dirname, "views"));
    app.set("view engine", "ejs");
    app.set("trust proxy", true);
    app.disable("x-powered-by");

    app.use(helmet({
        // Existing views use inline and third-party scripts. Add CSP after those
        // scripts have been inventoried and migrated to a nonce-based policy.
        contentSecurityPolicy: false,
        strictTransportSecurity: environment === "production"
    }));
    app.use(compression());
    if (options.logging !== false)
        app.use(logger("dev"));
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));

    app.use(function(req, res, next) {
        if (environment === "production" && req.path.toLowerCase().endsWith(".map"))
            return res.sendStatus(404);

        return next();
    });

    app.use(express.static(path.join(__dirname, "public")));

    app.use("/api", apiRouter);

    app.use(cookieParser());
    app.use(authRouter);

    app.use("/", indexRouter);
    app.use("/items", itemsRouter);
    app.use("/mobs", mobsRouter);
    app.use("/quests", questsRouter);
    app.use("/wiki", wikiRouter);
    app.use("/builder", builderRouter);
    app.use("/changelog", changelogRouter);
    app.use("/notifications", notificationsRouter);
    app.use("/account", accountRouter);

    app.use(function(req, res, next) {
        const error = new Error();
        error.status = 404;
        next(error);
    });

    app.use(function(err, req, res, next) {
        if (res.headersSent)
            return next(err);

        const status = getErrorStatus(err);
        const message = getPublicErrorMessage(err, status);
        if (status >= 500)
            console.error(err);

        if (isApiRequest(req)) {
            return res.status(status).json({
                errors: [{
                    message,
                    code: status
                }]
            });
        }

        const errorView = [401, 404, 500].includes(status)
            ? `error/${status}`
            : "error/generic";
        return res.status(status).render(errorView, {
            error: err,
            message,
            status
        });
    });

    app.use(function(err, req, res, next) {
        if (res.headersSent)
            return next(err);

        console.error(err);
        res.status(500);
        res.render("error/fatal");
    });

    return app;
};
