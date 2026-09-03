"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {renderMarkdownDocument} = require("./markdown");

function defaultManualPath() {
    return process.env.USER_MANUAL_PATH ||
        path.resolve(__dirname, "../../docs/user-manual.md");
}

function buildTableOfContents(headings) {
    const toc = [];
    let section = null;
    for (const heading of headings) {
        if (heading.level === 2) {
            section = {
                id: heading.id,
                title: heading.title,
                children: []
            };
            toc.push(section);
            continue;
        }
        if (!section) {
            throw new Error(
                `User manual heading "${heading.title}" appears before a level-two section`
            );
        }
        section.children.push({id: heading.id, title: heading.title});
    }
    return toc;
}

function loadManual(filePath = defaultManualPath()) {
    let source;
    try {
        source = fs.readFileSync(filePath, "utf8");
    }
    catch (error) {
        throw new Error(
            `Unable to read user manual at ${filePath}: ${error.message}`,
            {cause: error}
        );
    }
    if (!source.trim())
        throw new Error(`User manual at ${filePath} is empty`);

    const titleMatch = source.match(/^# ([^\r\n]+)(?:\r?\n|$)/);
    const levelOneHeadings = source.match(/^# [^\r\n]+/gm) || [];
    if (!titleMatch || levelOneHeadings.length !== 1) {
        throw new Error(
            `User manual at ${filePath} must begin with exactly one level-one heading`
        );
    }

    const title = titleMatch[1].trim();
    const body = source.slice(titleMatch[0].length).replace(/^\s+/, "");
    const rendered = renderMarkdownDocument(body, {
        headingLevels: [2, 3]
    });
    return {
        source,
        title,
        html: rendered.html,
        toc: buildTableOfContents(rendered.headings)
    };
}

exports.loadManual = loadManual;
