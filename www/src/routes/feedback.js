"use strict";

const express = require("express");
const githubIssues = require("../github-issues-client");

const MAX_TITLE_LENGTH = 256;
const MAX_BODY_LENGTH = 60000;

function renderError(res, message, values) {
    return res.render("feedback", {
        title: "Feedback Error",
        vm: {type: "error", message, values}
    });
}

module.exports = function createFeedbackRouter(options = {}) {
    const router = express.Router();
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    const createFeedbackIssue = options.createFeedbackIssue ||
        githubIssues.createFeedbackIssue;

    router.get("/feedback.html", function(req, res) {
        return res.render("feedback", {
            title: "Send Feedback",
            vm: {type: "normal", values: {title: "", body: ""}}
        });
    });

    router.post("/feedback.html", async function(req, res, next) {
        const submitted = req.body || {};
        const title = typeof submitted.feedbackTitle === "string" ?
            submitted.feedbackTitle.trim() : "";
        const body = typeof submitted.feedbackBody === "string" ?
            submitted.feedbackBody : "";
        const values = {title, body};

        if (title.length === 0 || title.length > MAX_TITLE_LENGTH) {
            return renderError(res,
                "Title must be between 1 and 256 characters.", values);
        }
        if (body.length > MAX_BODY_LENGTH) {
            return renderError(res,
                "Description must be 60,000 characters or fewer.", values);
        }

        const recaptcha = submitted["g-recaptcha-response"];
        if (typeof recaptcha !== "string" || recaptcha.length === 0) {
            return renderError(res, "The reCAPTCHA must be filled out.", values);
        }

        try {
            const response = await fetchImpl(
                "https://www.google.com/recaptcha/api/siteverify", {
                    method: "POST",
                    body: new URLSearchParams({
                        secret: process.env.RECAPTCHA_SECRET,
                        response: recaptcha
                    })
                });
            if (!response.ok) {
                throw new Error(
                    `reCAPTCHA verification failed with status ${response.status}`);
            }
            const result = await response.json();
            if (!result.success)
                return renderError(res, "Invalid reCAPTCHA.", values);

            const issueUrl = await createFeedbackIssue({title, body});
            return res.render("feedback", {
                title: "Feedback Sent",
                vm: {type: "success", url: issueUrl}
            });
        }
        catch (error) {
            return next(error);
        }
    });

    return router;
};
