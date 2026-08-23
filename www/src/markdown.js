"use strict";

const MarkdownIt = require("markdown-it");

const renderer = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: false
});

function renderMarkdown(source) {
    return renderer.render(source || "");
}

exports.renderMarkdown = renderMarkdown;
