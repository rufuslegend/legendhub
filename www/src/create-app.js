const compression = require("compression");
const cookieParser = require("cookie-parser");
const express = require("express");
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

module.exports = function createApp(options = {}) {
    const app = express();

    app.set("views", path.join(__dirname, "views"));
    app.set("view engine", "ejs");
    app.set("trust proxy", true);

    app.use(compression());
    if (options.logging !== false)
        app.use(logger("dev"));
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    app.use(express.static(path.join(__dirname, "public")));

    app.use(function(req, res, next) {
        if (process.env.NODE_ENV === "production") {
            const url = require("url").parse(req.url);
            if (url.pathname.endsWith(".map"))
                return res.sendStatus(404);
        }

        return next();
    });

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
        if (err && (!err.status || err.status != 404))
            console.log(err);
        if (res.headersSent)
            return next(err);

        res.status(err.status || 500);
        res.render(`error/${err.status || 500}`, {error: err});
    });

    app.use(function(err, req, res, next) {
        if (res.headersSent)
            return next(err);

        res.status(500);
        res.render("error/fatal");
    });

    return app;
};
