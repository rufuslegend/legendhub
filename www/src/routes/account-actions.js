"use strict";

const express = require("express");
const {normalizeReturnUrl, requireSameOrigin} = require("./request-security");

const EMAIL_PROMPT_COOKIE_OPTIONS = Object.freeze({
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "lax"
});

function suppressActionTokenReferrers(res) {
    res.set("Referrer-Policy", "no-referrer");
}

function renderPostTransitionAuthentication(req, res, {clearSession = false} = {}) {
    if (clearSession)
        res.clearCookie("loginToken", {path: "/"});

    delete res.locals.user;
    delete res.locals.permissions;
    if (res.locals.cookies)
        delete res.locals.cookies.loginToken;
    if (req.cookies && req.cookies !== res.locals.cookies)
        delete req.cookies.loginToken;
}

module.exports = function createAccountActionsRouter(options = {}) {
    const router = express.Router();
    const accountEmailService = options.accountEmailService ||
        require("./api/account").accountEmailService;
    const authApi = options.passwordRecoveryService && options.getIPFromRequest
        ? null
        : require("./api/auth");
    const passwordRecoveryService = options.passwordRecoveryService ||
        authApi.passwordRecoveryService;
    const getIPFromRequest = options.getIPFromRequest || authApi.utils.getIPFromRequest;

    router.post("/dismiss-email-prompt", requireSameOrigin, function(req, res) {
        if (res.locals.user && !res.locals.user.emailVerified) {
            res.cookie("emailPromptDismissed", "true", EMAIL_PROMPT_COOKIE_OPTIONS);
        }
        return res.redirect(normalizeReturnUrl(req.body?.returnUrl));
    });

    router.get("/verify-email.html", function(req, res) {
        suppressActionTokenReferrers(res);
        const token = typeof req.query?.token === "string" ? req.query.token : "";
        return res.render("account-actions/verify-email", {
            title: "Verify Email",
            vm: {token}
        });
    });

    router.post("/verify-email.html", requireSameOrigin, async function(req, res, next) {
        suppressActionTokenReferrers(res);
        try {
            const result = await accountEmailService.verifyEmailToken(req.body?.token);
            if (result.success)
                renderPostTransitionAuthentication(req, res);
            return res.render("account-actions/action-result", {
                title: result.success ? "Email Verified" : "Verification Unavailable",
                vm: result
            });
        }
        catch (error) {
            return next(error);
        }
    });

    router.get("/forgot-password.html", function(req, res) {
        return res.render("account-actions/forgot-password", {
            title: "Forgot Password",
            vm: {message: null}
        });
    });

    router.post("/forgot-password.html", requireSameOrigin, async function(req, res, next) {
        try {
            await passwordRecoveryService.requestRecovery({
                identity: req.body?.identity,
                ipHash: getIPFromRequest(req)
            });
            return res.render("account-actions/forgot-password", {
                title: "Forgot Password",
                vm: {
                    message: "If that account has a verified email address, password reset instructions have been sent."
                }
            });
        }
        catch (error) {
            return next(error);
        }
    });

    router.get("/reset-password.html", function(req, res) {
        suppressActionTokenReferrers(res);
        const token = typeof req.query?.token === "string" ? req.query.token : "";
        return res.render("account-actions/reset-password", {
            title: "Reset Password",
            vm: {token, message: null, success: false}
        });
    });

    router.post("/reset-password.html", requireSameOrigin, async function(req, res) {
        suppressActionTokenReferrers(res);
        const token = typeof req.body?.token === "string" ? req.body.token : "";
        const newPassword = typeof req.body?.newPassword === "string"
            ? req.body.newPassword
            : "";
        const confirmPassword = typeof req.body?.confirmPassword === "string"
            ? req.body.confirmPassword
            : "";
        if (newPassword !== confirmPassword) {
            return res.render("account-actions/reset-password", {
                title: "Reset Password",
                vm: {token, message: "Passwords must match.", success: false}
            });
        }

        try {
            await passwordRecoveryService.resetPassword({token, newPassword});
            renderPostTransitionAuthentication(req, res, {clearSession: true});
            return res.render("account-actions/reset-password", {
                title: "Password Changed",
                vm: {
                    token: "",
                    success: true,
                    message: "Your password has been changed. Sign in again to continue."
                }
            });
        }
        catch (error) {
            return res.render("account-actions/reset-password", {
                title: "Reset Password",
                vm: {token, message: error.message, success: false}
            });
        }
    });

    return router;
};
