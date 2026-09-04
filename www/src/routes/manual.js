"use strict";

const express = require("express");
const {loadManual} = require("../manual-document");

module.exports = function createManualRouter(options = {}) {
    const router = express.Router();
    const document = loadManual(options.manualPath);

    router.get(["/", "/index.html"], function(req, res) {
        res.render("manual/index", {
            title: "User Manual",
            vm: document
        });
    });

    return router;
};
