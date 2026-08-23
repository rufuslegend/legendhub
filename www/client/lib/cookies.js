export function parseCookieHeader(header) {
    if (typeof header !== "string")
        return {};

    return header.split(";").reduce(function(cookies, segment) {
        const separator = segment.indexOf("=");

        if (separator < 1)
            return cookies;

        const name = segment.slice(0, separator).trim();
        const value = segment.slice(separator + 1).trim();

        try {
            cookies[name] = decodeURIComponent(value);
        }
        catch (_error) {
            cookies[name] = value;
        }

        return cookies;
    }, {});
}

export function formatCookie(name, value, options = {}) {
    const settings = {
        path: "/",
        sameSite: "Lax",
        secure: true,
        ...options
    };
    const parts = [`${name}=${encodeURIComponent(value)}`];

    if (settings.path)
        parts.push(`Path=${settings.path}`);
    if (settings.sameSite)
        parts.push(`SameSite=${settings.sameSite}`);
    if (settings.secure)
        parts.push("Secure");
    if (settings.expires)
        parts.push(`Expires=${settings.expires.toUTCString()}`);

    return parts.join("; ");
}
