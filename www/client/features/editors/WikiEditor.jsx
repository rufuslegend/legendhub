import {useEffect, useReducer, useRef} from "react";
import CategorySelect from "../../components/CategorySelect.jsx";
import EntityChangelogFields from "../../components/EntityChangelogFields.jsx";
import {saveWikiPage} from "./editor-api.js";
import {createInitialEditorState, editorReducer, isEditorDirty} from "./editor-reducer.js";

function initialWikiPage(wikiPage) {
    return {title: "", categoryId: "", subcategoryId: null, tags: "", content: "", ...wikiPage};
}

export default function WikiEditor({categories, subcategories, wikiPage}) {
    const [state, dispatch] = useReducer(editorReducer, wikiPage, value =>
        createInitialEditorState(initialWikiPage(value)));
    const statusRef = useRef(null);
    const errorRef = useRef(null);
    const saving = state.status === "saving";
    const currentSubcategories = subcategories[state.draft.categoryId] || [];
    const valid = state.draft.title !== "" && state.draft.categoryId !== "" &&
        state.draft.categoryId != null &&
        (currentSubcategories.length === 0 || state.draft.subcategoryId != null);
    const canSubmit = valid && (state.mode === "add" || isEditorDirty(state)) && !saving;

    useEffect(function() {
        if (saving)
            statusRef.current?.focus();
        else if (state.error)
            errorRef.current?.focus();
    }, [saving, state.error]);

    function change(field, value) {
        dispatch({type: "field/change", field, value});
    }

    async function submit(event) {
        event.preventDefault();
        if (!canSubmit)
            return;
        dispatch({type: "save/requested"});
        try {
            const result = await saveWikiPage(state.draft);
            window.location.assign(result.redirectUrl);
        }
        catch (_error) {
            dispatch({type: "save/failed", error: "request"});
        }
    }

    return (
        <div className="container">
            <form onSubmit={submit} aria-busy={saving}>
                <div className="form-row">
                    <h1>{state.mode === "edit" ? "Edit Wiki Page" : "Add Wiki Page"}</h1>
                </div>
                <div className="form-row">
                    <div className="form-group col-12 col-lg-5">
                        <div className="input-group">
                            <div className="input-group-prepend">
                                <label className="input-group-text" htmlFor="wiki-title">Title</label>
                            </div>
                            <input
                                autoFocus
                                className="form-control"
                                id="wiki-title"
                                name="title"
                                required
                                type="text"
                                value={state.draft.title}
                                onChange={event => change("title", event.target.value)}
                            />
                        </div>
                    </div>
                </div>
                <CategorySelect
                    id="wiki-category"
                    label="Category"
                    name="category"
                    options={categories}
                    required
                    value={state.draft.categoryId}
                    onChange={event => dispatch({
                        type: "category/change",
                        field: "categoryId",
                        dependentField: "subcategoryId",
                        value: event.target.value === "" ? "" : Number(event.target.value)
                    })}
                />
                {currentSubcategories.length > 0 && (
                    <CategorySelect
                        id="wiki-subcategory"
                        label="Subcategory"
                        name="subcategory"
                        options={currentSubcategories}
                        required
                        value={state.draft.subcategoryId}
                        onChange={event => change("subcategoryId", event.target.value === ""
                            ? null
                            : Number(event.target.value))}
                    />
                )}
                <p className="text-info">Use a semicolon to split multiple tags.</p>
                <div className="form-row">
                    <div className="form-group col-12 col-lg-5">
                        <div className="input-group">
                            <div className="input-group-prepend">
                                <label className="input-group-text" htmlFor="wiki-tags">Tags</label>
                            </div>
                            <input
                                className="form-control"
                                id="wiki-tags"
                                name="tags"
                                type="text"
                                value={state.draft.tags}
                                onChange={event => change("tags", event.target.value)}
                            />
                        </div>
                    </div>
                </div>
                <EntityChangelogFields
                    id="wiki-content"
                    label="Content"
                    rows="10"
                    value={state.draft.content}
                    onChange={event => change("content", event.target.value)}
                />
                {saving && (
                    <p ref={statusRef} role="status" aria-label="Saving wiki page" tabIndex="-1" className="text-info">
                        Saving wiki page…
                    </p>
                )}
                {state.error && (
                    <p ref={errorRef} role="alert" aria-live="assertive" tabIndex="-1" className="text-danger">
                        Wiki page could not be saved. Try again.
                    </p>
                )}
                <div className="row">
                    <button
                        className="btn btn-primary btn-block col-12 offset-md-8 col-md-4 offset-lg-10 col-lg-2"
                        type="submit"
                        disabled={!canSubmit}
                        aria-label={saving ? "Saving wiki page" : "Save"}
                    >
                        {saving ? "Saving…" : "Save"}
                    </button>
                </div>
                <br /><br />
            </form>
        </div>
    );
}
