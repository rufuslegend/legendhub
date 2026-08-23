"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const wwwRoot = path.join(__dirname, "..");
const publicRoot = path.join(wwwRoot, "src", "public");
const buildRoot = path.join(publicRoot, "build");

function snapshotFiles(directory, relativeDirectory = "", excluded = () => false) {
    const snapshot = new Map();
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
        const relativePath = path.join(relativeDirectory, entry.name);
        if (excluded(relativePath))
            continue;
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            for (const [childPath, digest] of snapshotFiles(file, relativePath, excluded))
                snapshot.set(childPath, digest);
        }
        else if (entry.isFile()) {
            snapshot.set(relativePath, crypto.createHash("sha256")
                .update(fs.readFileSync(file)).digest("hex"));
        }
    }
    return snapshot;
}

test("clean client build emits stable React and shared-shell bundles without changing public assets", (t) => {
    fs.rmSync(buildRoot, {recursive: true, force: true});
    t.after(() => fs.rmSync(buildRoot, {recursive: true, force: true}));
    fs.mkdirSync(buildRoot, {recursive: true});
    fs.writeFileSync(path.join(buildRoot, "foundation.js"), "stale foundation bundle\n");
    const before = snapshotFiles(wwwRoot, "", (relativePath) =>
        relativePath === "node_modules" ||
        relativePath === path.join("src", "public", "build"));
    const cssBefore = snapshotFiles(path.join(publicRoot, "css"));
    const legacyJsBefore = snapshotFiles(path.join(publicRoot, "js"));

    childProcess.execFileSync("npm", ["run", "build:client"], {
        cwd: wwwRoot,
        stdio: "pipe"
    });

    const bundle = path.join(buildRoot, "account.js");
    assert.ok(fs.existsSync(bundle), "client build must create the account bundle");
    assert.ok(fs.existsSync(path.join(buildRoot, "shell.js")),
        "client build must create the shared shell bundle");
    for (const editor of ["mob-editor", "quest-editor", "wiki-editor"]) {
        assert.ok(fs.existsSync(path.join(buildRoot, `${editor}.js`)),
            `client build must create the ${editor} bundle`);
    }
    assert.equal(fs.existsSync(path.join(buildRoot, "foundation.js")), false,
        "client build must not retain the obsolete foundation bundle");
    assert.deepEqual(snapshotFiles(wwwRoot, "", (relativePath) =>
        relativePath === "node_modules" ||
        relativePath === path.join("src", "public", "build")), before,
        "client build must not write outside src/public/build");
    assert.deepEqual(snapshotFiles(path.join(publicRoot, "css")), cssBefore,
        "client build must preserve public CSS");
    assert.deepEqual(snapshotFiles(path.join(publicRoot, "js")), legacyJsBefore,
        "client build must preserve legacy JavaScript");
});
