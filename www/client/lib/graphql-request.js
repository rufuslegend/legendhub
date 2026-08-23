export class GraphQLRequestError extends Error {
    constructor(message, errors = []) {
        super(message);
        this.name = "GraphQLRequestError";
        this.errors = errors;
    }
}

function redirectToUnauthorizedPage() {
    if (typeof window !== "undefined")
        window.location.assign("/error/401.html");
}

function normalizeGraphQLError(error) {
    return {
        message: typeof error?.message === "string" && error.message
            ? error.message
            : "The request could not be completed."
    };
}

export async function graphqlRequest({query, variables, signal}) {
    const response = await fetch("/api", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        credentials: "same-origin",
        signal,
        body: JSON.stringify({query, variables})
    });

    if (response.status === 401 || response.status === 403) {
        redirectToUnauthorizedPage();
        throw new GraphQLRequestError("Authorization required.");
    }
    if (response.status < 200 || response.status >= 300)
        throw new GraphQLRequestError("The request could not be completed.");

    let body;
    try {
        body = await response.json();
    }
    catch (error) {
        if (error?.name === "AbortError")
            throw error;
        throw new GraphQLRequestError("The server returned an invalid response.");
    }

    if (!body || typeof body !== "object")
        throw new GraphQLRequestError("The server returned an invalid response.");
    if (Array.isArray(body.errors) && body.errors.length > 0) {
        if (body.errors.some(function(error) {
            return error?.code === 401 || error?.code === 403;
        })) {
            redirectToUnauthorizedPage();
            throw new GraphQLRequestError("Authorization required.");
        }
        const errors = body.errors.map(normalizeGraphQLError);
        throw new GraphQLRequestError(errors[0].message, errors);
    }
    if (!Object.hasOwn(body, "data"))
        throw new GraphQLRequestError("The server returned an invalid response.");

    return body.data;
}
