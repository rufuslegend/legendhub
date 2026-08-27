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
    const serverBlocks = findDirectiveBlocks(source, "server");
    const forwardedFor = /proxy_set_header\s+X-Forwarded-For\s+([^;]+);/.exec(source);
    return {source, format, serverBlocks, forwardedFor};
}

function findDirectiveBlocks(source, directive) {
    const blocks = [];
    const opener = new RegExp(`\\b${directive}\\s*\\{`, "g");
    let match;
    while ((match = opener.exec(source))) {
        let depth = 1;
        let offset = opener.lastIndex;
        while (offset < source.length && depth > 0) {
            if (source[offset] === "{")
                depth += 1;
            else if (source[offset] === "}")
                depth -= 1;
            offset += 1;
        }
        assert.equal(depth, 0, `${directive} block is balanced`);
        blocks.push({
            start: match.index,
            end: offset,
            source: source.slice(match.index, offset)
        });
        opener.lastIndex = offset;
    }
    return blocks;
}

function readAccessLogs(source) {
    return [...source.matchAll(/\baccess_log\s+([^;\s]+)(?:\s+([^;\s]+))?[^;]*;/g)]
        .map(match => ({path: match[1], format: match[2] || null}));
}

// Catches either tracked ingress returning to Nginx's combined log (which
// records query-bearing $request and $http_referer) or appending a forged XFF.
test("tracked Nginx ingresses omit query strings and referrers and overwrite XFF", function() {
    for (const relativePath of ["nginx/local.conf", "nginx/parity.conf"]) {
        const {source, format, serverBlocks, forwardedFor} = readDirectives(relativePath);
        assert.ok(format, `${relativePath} declares an explicit safe log format`);
        assert.equal(serverBlocks.length, 1, `${relativePath} has one tracked server`);

        const serverLogs = readAccessLogs(serverBlocks[0].source);
        assert.deepEqual(serverLogs, [{
            path: "/var/log/nginx/access.log",
            format: format[1]
        }], `${relativePath} overrides inherited logging with one safe server-scoped log`);

        const enclosingSource = source.slice(0, serverBlocks[0].start) +
            source.slice(serverBlocks[0].end);
        assert.deepEqual(readAccessLogs(enclosingSource), [],
            `${relativePath} does not append a second http-scoped access log`);
        assert.match(format[2], /\$uri\b/, `${relativePath} logs the path only`);
        assert.doesNotMatch(format[2], /\$(?:request|request_uri|args|http_referer)\b/,
            `${relativePath} excludes queries and referrers`);
        assert.equal(forwardedFor?.[1].trim(), "$remote_addr",
            `${relativePath} replaces caller-supplied forwarding data`);
    }
});
