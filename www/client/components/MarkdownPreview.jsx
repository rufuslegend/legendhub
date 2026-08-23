import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: false
});

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
    const html = DOMPurify.sanitize(markdown.render(value || ""), MARKDOWN_SANITIZE_POLICY);
    const headingId = `${id}-heading`;

    return (
        <div className="card" role="region" aria-labelledby={headingId}>
            <div className="card-header" id={headingId}>{label} Markdown preview</div>
            <div className="card-body" dangerouslySetInnerHTML={{__html: html}} />
        </div>
    );
}
