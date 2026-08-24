"use strict";

const MarkdownIt = require("markdown-it");
const {full: emoji} = require("markdown-it-emoji");

const renderer = new MarkdownIt({
    breaks: true,
    html: false,
    linkify: true,
    typographer: false
}).use(emoji, {shortcuts: {}});

function renderMarkdown(source) {
    return renderer.render(source || "");
}

exports.renderMarkdown = renderMarkdown;
