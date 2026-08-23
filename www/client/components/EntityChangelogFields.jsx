import MarkdownPreview from "./MarkdownPreview.jsx";

export default function EntityChangelogFields({id, label, onChange, rows, value}) {
    return (
        <>
            <p>
                This field supports{" "}
                <a
                    href="https://github.com/showdownjs/showdown/wiki/Showdown's-Markdown-syntax"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    markdown
                </a>.
            </p>
            <div className="form-row">
                <div className="form-group col-12">
                    <div className="input-group">
                        <div className="input-group-prepend">
                            <label className="input-group-text" htmlFor={id}>{label}</label>
                        </div>
                        <textarea
                            className="form-control"
                            id={id}
                            name={label.toLowerCase()}
                            rows={rows}
                            value={value ?? ""}
                            onChange={onChange}
                        />
                    </div>
                </div>
            </div>
            <div className="form-row">
                <div className="form-group col-12">
                    <MarkdownPreview id={`${id}-preview`} label={label} value={value} />
                </div>
            </div>
        </>
    );
}
