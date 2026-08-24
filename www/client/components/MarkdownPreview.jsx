import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";
import {full as emoji} from "markdown-it-emoji";

const markdown = new MarkdownIt({
    breaks: true,
    html: true,
    linkify: true,
    typographer: false
}).use(emoji, {shortcuts: {}});
const uriWhitespace = /[\u0000-\u0020\u00A0\u1680\u180E\u2000-\u2029\u205F\u3000]/g;

function rejectDataUri(_node, hookEvent) {
    const name = hookEvent.attrName.toLowerCase();
    const value = hookEvent.attrValue.replace(uriWhitespace, "");
    if ((name === "href" || name === "src") && value.toLowerCase().startsWith("data:"))
        hookEvent.keepAttr = false;
}

export const MARKDOWN_SANITIZE_POLICY = Object.freeze({
    ALLOWED_TAGS: [
        "a", "blockquote", "br", "code", "del", "em", "h1", "h2", "h3",
        "h4", "h5", "h6", "hr", "img", "li", "ol", "p", "pre", "strong",
        "table", "tbody", "td", "th", "thead", "tr", "ul"
    ],
    ALLOWED_ATTR: ["alt", "href", "src", "title"],
    ALLOW_ARIA_ATTR: false,
    ALLOW_DATA_ATTR: false,
    FORBID_ATTR: ["style"],
    FORBID_TAGS: [
        "button", "embed", "form", "iframe", "input", "math", "object", "script",
        "style", "svg"
    ],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|\/(?!\/)|#|\.{1,2}\/|[a-z0-9][a-z0-9/_?&=#.%~-]*$)/i
});

export default function MarkdownPreview({id, label, value}) {
    DOMPurify.addHook("uponSanitizeAttribute", rejectDataUri);
    let html;
    try {
        html = DOMPurify.sanitize(markdown.render(value || ""), MARKDOWN_SANITIZE_POLICY);
    }
    finally {
        DOMPurify.removeHook("uponSanitizeAttribute", rejectDataUri);
    }
    return (
        <div className="card" role="region" aria-label={`${label} Markdown preview`}>
            <div className="card-header">Preview</div>
            <div className="card-body" dangerouslySetInnerHTML={{__html: html}} />
        </div>
    );
}
