"use strict";

const fs = require("node:fs");
const path = require("node:path");
const MarkdownIt = require("markdown-it");

const renderer = new MarkdownIt({html: false, linkify: true, typographer: false});

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
    return {source, html: renderer.render(source)};
}

exports.loadChangelog = loadChangelog;
