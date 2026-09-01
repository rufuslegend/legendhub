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

function renderMarkdown(source) {
    return renderer.render(source || "");
}

exports.renderMarkdown = renderMarkdown;
