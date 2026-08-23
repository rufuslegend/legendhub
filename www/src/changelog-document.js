"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {renderMarkdown} = require("./markdown");

function defaultChangelogPath() {
    return process.env.CHANGELOG_PATH || path.resolve(__dirname, "../../CHANGELOG.md");
}

function loadChangelog(filePath = defaultChangelogPath()) {
    let source;
    try {
        source = fs.readFileSync(filePath, "utf8");
    }
    catch (error) {
        throw new Error(`Unable to read changelog at ${filePath}: ${error.message}`, {cause: error});
    }
    if (!source.trim())
        throw new Error(`Changelog at ${filePath} is empty`);
    return {source, html: renderMarkdown(source)};
}

exports.loadChangelog = loadChangelog;
