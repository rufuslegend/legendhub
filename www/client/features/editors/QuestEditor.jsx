import {useEffect, useReducer, useRef} from "react";
import CategorySelect from "../../components/CategorySelect.jsx";
import EntityChangelogFields from "../../components/EntityChangelogFields.jsx";
import {saveQuest} from "./editor-api.js";
import {createInitialEditorState, editorReducer, isEditorDirty} from "./editor-reducer.js";

function initialQuest(quest) {
    return {title: "", areaId: "", whoises: "", stat: false, content: "", ...quest};
}

export default function QuestEditor({areas, quest}) {
    const [state, dispatch] = useReducer(editorReducer, quest, value =>
        createInitialEditorState(initialQuest(value)));
    const statusRef = useRef(null);
    const errorRef = useRef(null);
    const saving = state.status === "saving";
    const valid = state.draft.title !== "" && state.draft.areaId !== "" &&
        state.draft.areaId != null;
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
            const result = await saveQuest(state.draft);
            window.location.assign(result.redirectUrl);
        }
        catch (_error) {
            dispatch({type: "save/failed", error: "request"});
        }
    }

    return (
        <div className="container">
            <form onSubmit={submit} aria-busy={saving}>
                <div className="form-row"><h1>{state.mode === "edit" ? "Edit Quest" : "Add Quest"}</h1></div>
                <p className="text-info">You can assign this quest to an item on the item edit page.</p>
                <div className="form-row">
                    <div className="form-group col-12 col-lg-5">
                        <div className="input-group">
                            <div className="input-group-prepend">
                                <label className="input-group-text" htmlFor="quest-title">Title</label>
                            </div>
                            <input
                                autoFocus
                                className="form-control"
                                id="quest-title"
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
                    id="quest-area"
                    label="Area"
                    name="area"
                    options={areas}
                    required
                    value={state.draft.areaId}
                    formatOption={area => area.eraName ? `${area.name} (${area.eraName})` : area.name}
                    onChange={event => change("areaId", event.target.value === ""
                        ? ""
                        : Number(event.target.value))}
                />
                <p className="text-info">Use a semicolon to split multiple whoises.</p>
                <div className="form-row">
                    <div className="form-group col-12 col-lg-5">
                        <div className="input-group">
                            <div className="input-group-prepend">
                                <label className="input-group-text" htmlFor="quest-whoises">Whoises</label>
                            </div>
                            <input
                                className="form-control"
                                id="quest-whoises"
                                name="whoises"
                                type="text"
                                value={state.draft.whoises}
                                onChange={event => change("whoises", event.target.value)}
                            />
                        </div>
                    </div>
                </div>
                <div className="form-row">
                    <div className="form-group col-12 col-lg-5">
                        <div className="input-group">
                            <div className="input-group-prepend">
                                <label className="input-group-text" htmlFor="quest-stat">Stat Quest</label>
                            </div>
                            <div className="input-group-append">
                                <div className="input-group-text">
                                    <input
                                        checked={Boolean(state.draft.stat)}
                                        id="quest-stat"
                                        type="checkbox"
                                        onChange={event => change("stat", event.target.checked)}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <EntityChangelogFields
                    id="quest-content"
                    label="Content"
                    rows="10"
                    value={state.draft.content}
                    onChange={event => change("content", event.target.value)}
                />
                {saving && (
                    <p ref={statusRef} role="status" aria-label="Saving quest" tabIndex="-1" className="text-info">
                        Saving quest…
                    </p>
                )}
                {state.error && (
                    <p ref={errorRef} role="alert" aria-live="assertive" tabIndex="-1" className="text-danger">
                        Quest could not be saved. Try again.
                    </p>
                )}
                <div className="row">
                    <button
                        className="btn btn-primary btn-block col-12 offset-md-8 col-md-4 offset-lg-10 col-lg-2"
                        type="submit"
                        disabled={!canSubmit}
                        aria-label={saving ? "Saving quest" : "Save"}
                    >
                        {saving ? "Saving…" : "Save"}
                    </button>
                </div>
                <br /><br />
            </form>
        </div>
    );
}
