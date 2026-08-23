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

    const body = await response.json();

    if (!body || typeof body !== "object")
        throw new GraphQLRequestError("The server returned an invalid response.");
    if (Array.isArray(body.errors) && body.errors.length > 0) {
        const errors = body.errors.map(function(error) {
            return {message: error.message || "The request could not be completed."};
        });
        throw new GraphQLRequestError(errors[0].message, errors);
    }
    if (!Object.hasOwn(body, "data"))
        throw new GraphQLRequestError("The server returned an invalid response.");

    return body.data;
}
