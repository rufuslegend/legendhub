"use strict";

const express = require("express");
const {requireSameOrigin} = require("./request-security");

module.exports = function createAccountActionsRouter(options = {}) {
    const router = express.Router();
    const accountEmailService = options.accountEmailService ||
        require("./api/account").accountEmailService;

    router.get("/verify-email.html", function(req, res) {
        const token = typeof req.query?.token === "string" ? req.query.token : "";
        return res.render("account-actions/verify-email", {
            title: "Verify Email",
            vm: {token}
        });
    });

    router.post("/verify-email.html", requireSameOrigin, async function(req, res, next) {
        try {
            const result = await accountEmailService.verifyEmailToken(req.body?.token);
            return res.render("account-actions/action-result", {
                title: result.success ? "Email Verified" : "Verification Unavailable",
                vm: result
            });
        }
        catch (error) {
            return next(error);
        }
    });

    return router;
};
