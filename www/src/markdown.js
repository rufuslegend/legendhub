"use strict";

const MarkdownIt = require("markdown-it");
const {full: emoji} = require("markdown-it-emoji");

const renderer = new MarkdownIt({
    breaks: true,
    html: true,
    linkify: true,
    typographer: false
}).use(emoji, {shortcuts: {}});
renderer.block.ruler.disable("html_block");

const legacyInlineTag = /^<\s*(\/?)\s*(b|strong|i|em|u|br)\b(?:\s[^<>]*?)?\s*\/?>$/i;

function renderLegacyInlineHtml(tokens, index) {
    const raw = tokens[index].content;
    const match = raw.match(legacyInlineTag);
    if (!match)
        return renderer.utils.escapeHtml(raw);

    const closing = match[1] === "/";
    const tag = match[2].toLowerCase();
    if (tag === "br")
        return "<br>";
    return closing ? `</${tag}>` : `<${tag}>`;
}

renderer.renderer.rules.html_inline = renderLegacyInlineHtml;
renderer.renderer.rules.html_block = function(tokens, index) {
    return renderer.utils.escapeHtml(tokens[index].content);
};

function plainHeadingText(inlineToken) {
    return (inlineToken.children || []).filter(function(token) {
        return token.type === "text" || token.type === "code_inline" ||
            token.type === "emoji";
    }).map(function(token) {
        return token.content;
    }).join("");
}

function slugHeading(title) {
    return title.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
        .toLowerCase().replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "section";
}

renderer.core.ruler.after("emoji", "legendhub_headings", function(state) {
    const collector = state.env && state.env.legendhubHeadings;
    if (!collector)
        return;

    for (let index = 0; index < state.tokens.length; index++) {
        const token = state.tokens[index];
        if (token.type !== "heading_open")
            continue;

        const level = Number(token.tag.slice(1));
        if (!collector.headingLevels.has(level))
            continue;

        const inlineToken = state.tokens[index + 1];
        const title = plainHeadingText(inlineToken);
        const base = slugHeading(title);
        let suffix = collector.slugCounts.get(base) || 2;
        let id = base;
        while (collector.usedIds.has(id)) {
            id = `${base}-${suffix++}`;
        }
        collector.slugCounts.set(base, suffix);
        collector.usedIds.add(id);
        token.attrSet("id", id);
        collector.headings.push({level, id, title});
    }
});

renderer.renderer.rules.table_open = function(tokens, index, options, env, self) {
    if (!env || !env.legendhubDocument)
        return self.renderToken(tokens, index, options);

    const token = tokens[index];
    const classes = token.attrGet("class");
    token.attrSet("class", classes ? `${classes} table table-sm table-bordered` :
        "table table-sm table-bordered");
    return '<div class="table-responsive">' +
        self.renderToken(tokens, index, options);
};

renderer.renderer.rules.table_close = function(tokens, index, options, env, self) {
    if (!env || !env.legendhubDocument)
        return self.renderToken(tokens, index, options);
    return self.renderToken(tokens, index, options) + "</div>\n";
};

function renderMarkdown(source) {
    return renderer.render(source || "");
}

function renderMarkdownDocument(source, options = {}) {
    const headingLevels = Array.isArray(options.headingLevels) ?
        options.headingLevels : [2, 3];
    const collector = {
        headingLevels: new Set(headingLevels),
        headings: [],
        slugCounts: new Map(),
        usedIds: new Set()
    };
    const html = renderer.render(source || "", {
        legendhubDocument: true,
        legendhubHeadings: collector
    });
    return {html, headings: collector.headings};
}

exports.renderMarkdown = renderMarkdown;
exports.renderMarkdownDocument = renderMarkdownDocument;
