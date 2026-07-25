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

module.exports = function createErrorHandlers(options = {}) {
    const logError = options.logError || console.error;

    return {
        notFound: function(req, res, next) {
            const error = new Error();
            error.status = 404;
            next(error);
        },

        handleError: function(err, req, res, next) {
            if (res.headersSent)
                return next(err);

            const status = getErrorStatus(err);
            const message = getPublicErrorMessage(err, status);
            if (status >= 500)
                logError(err);

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
        },

        handleFatalError: function(err, req, res, next) {
            if (res.headersSent)
                return next(err);

            logError(err);
            res.status(500);
            res.render("error/fatal");
        }
    };
};
