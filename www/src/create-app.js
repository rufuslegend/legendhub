const compression = require("compression");
const cookieParser = require("cookie-parser");
const express = require("express");
const helmet = require("helmet");
const logger = require("morgan");
const path = require("path");

const createErrorHandlers = require("./error-handlers");
const authRouter = require("./routes/auth");
const createFeedbackRouter = require("./routes/feedback");

const indexRouter = require("./routes/index");
const apiRouter = require("./routes/api");
const itemsRouter = require("./routes/items");
const mobsRouter = require("./routes/mobs");
const questsRouter = require("./routes/quests");
const wikiRouter = require("./routes/wiki");
const builderRouter = require("./routes/builder");
const createChangelogRouter = require("./routes/changelog");
const notificationsRouter = require("./routes/notifications");
const accountRouter = require("./routes/account");

module.exports = function createApp(options = {}) {
    const app = express();
    const environment = options.environment || process.env.NODE_ENV;
    const errorHandlers = createErrorHandlers({
        logError: options.logError
    });

    app.set("views", path.join(__dirname, "views"));
    app.set("view engine", "ejs");
    app.set("trust proxy", true);
    app.disable("x-powered-by");

    app.use(helmet({
        contentSecurityPolicy: {
            // Existing views use inline and third-party scripts, so limit this
            // policy to the framing restriction until those are inventoried.
            useDefaults: false,
            directives: {
                defaultSrc:
                    helmet.contentSecurityPolicy.dangerouslyDisableDefaultSrc,
                frameAncestors: [
                    "'self'",
                    "https://play.legendmud.org",
                    "https://legend.dunwichmass.com:8000",
                    "http://localhost:5173"
                ]
            }
        },
        frameguard: false,
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
    app.use(authRouter.initializeLocals);
    app.use("/changelog", createChangelogRouter({
        changelogPath: options.changelogPath
    }));
    app.use(authRouter);

    app.use("/", createFeedbackRouter({
        fetchImpl: options.fetchImpl,
        createFeedbackIssue: options.createFeedbackIssue
    }));
    app.use("/", indexRouter);
    app.use("/items", itemsRouter);
    app.use("/mobs", mobsRouter);
    app.use("/quests", questsRouter);
    app.use("/wiki", wikiRouter);
    app.use("/builder", builderRouter);
    app.use("/notifications", notificationsRouter);
    app.use("/account", accountRouter);

    app.use(errorHandlers.notFound);
    app.use(errorHandlers.handleError);
    app.use(errorHandlers.handleFatalError);

    return app;
};
