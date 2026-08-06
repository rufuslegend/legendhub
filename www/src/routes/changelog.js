"use strict";

const express = require("express");
const {loadChangelog} = require("../changelog-document");

module.exports = function createChangelogRouter(options = {}) {
    const router = express.Router();
    const document = loadChangelog(options.changelogPath);

    router.get(["/", "/index.html"], function(req, res) {
        res.render("changelog/index", {
            title: "Changelog",
            vm: {html: document.html}
        });
    });

    router.get("/details.html", function(req, res) {
        res.redirect(301, "/changelog");
    });

    return router;
};
