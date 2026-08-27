"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");

function readDirectives(relativePath) {
    const source = fs.readFileSync(path.join(root, relativePath), "utf8")
        .replace(/#[^\n]*/g, "");
    const format = /log_format\s+(\w+)\s+([\s\S]*?);/.exec(source);
    const accessLog = /access_log\s+\S+\s+(\w+)\s*;/.exec(source);
    const forwardedFor = /proxy_set_header\s+X-Forwarded-For\s+([^;]+);/.exec(source);
    return {source, format, accessLog, forwardedFor};
}

// Catches either tracked ingress returning to Nginx's combined log (which
// records query-bearing $request and $http_referer) or appending a forged XFF.
test("tracked Nginx ingresses omit query strings and referrers and overwrite XFF", function() {
    for (const relativePath of ["nginx/local.conf", "nginx/parity.conf"]) {
        const {format, accessLog, forwardedFor} = readDirectives(relativePath);
        assert.ok(format, `${relativePath} declares an explicit safe log format`);
        assert.ok(accessLog, `${relativePath} activates the safe log format`);
        assert.equal(accessLog[1], format[1], `${relativePath} activates its declared format`);
        assert.match(format[2], /\$uri\b/, `${relativePath} logs the path only`);
        assert.doesNotMatch(format[2], /\$(?:request|request_uri|args|http_referer)\b/,
            `${relativePath} excludes queries and referrers`);
        assert.equal(forwardedFor?.[1].trim(), "$remote_addr",
            `${relativePath} replaces caller-supplied forwarding data`);
    }
});
