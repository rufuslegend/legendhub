import {useEffect, useReducer, useRef} from "react";
import CategorySelect from "../../components/CategorySelect.jsx";
import EntityChangelogFields from "../../components/EntityChangelogFields.jsx";
import {saveMob} from "./editor-api.js";
import {createInitialEditorState, editorReducer, isEditorDirty} from "./editor-reducer.js";

function initialMob(mob) {
    return {
        name: "",
        areaId: "",
        xp: 0,
        gold: 0,
        aggro: false,
        notes: "",
        ...mob
    };
}

export default function MobEditor({areas, mob}) {
    const [state, dispatch] = useReducer(editorReducer, mob, value =>
        createInitialEditorState(initialMob(value)));
    const statusRef = useRef(null);
    const errorRef = useRef(null);
    const saving = state.status === "saving";
    const valid = state.draft.name !== "" && state.draft.areaId !== "" &&
        state.draft.areaId != null && state.draft.xp !== "" && Number(state.draft.xp) >= 0 &&
        state.draft.gold !== "";
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
            const result = await saveMob(state.draft);
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
                    <h1>{state.mode === "edit" ? "Edit Mob" : "Add Mob"}</h1>
                </div>
                <div className="form-row">
                    <div className="form-group col-12 col-lg-5">
                        <div className="input-group">
                            <div className="input-group-prepend">
                                <label className="input-group-text" htmlFor="mob-name">Name</label>
                            </div>
                            <input
                                autoFocus
                                className="form-control"
                                id="mob-name"
                                name="name"
                                required
                                type="text"
                                value={state.draft.name}
                                onChange={event => change("name", event.target.value)}
                            />
                        </div>
                    </div>
                </div>
                <CategorySelect
                    id="mob-area"
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
                <div className="form-row">
                    <div className="form-group col-4 col-lg-2">
                        <div className="input-group">
                            <div className="input-group-prepend">
                                <label className="input-group-text" htmlFor="mob-xp">Xp</label>
                            </div>
                            <input
                                className="form-control"
                                id="mob-xp"
                                min="0"
                                name="xp"
                                required
                                type="number"
                                value={state.draft.xp}
                                onChange={event => change("xp", event.target.value)}
                            />
                        </div>
                    </div>
                    <div className="form-group col-4 col-lg-2">
                        <div className="input-group">
                            <div className="input-group-prepend">
                                <label className="input-group-text" htmlFor="mob-gold">Gold</label>
                            </div>
                            <input
                                className="form-control"
                                id="mob-gold"
                                name="gold"
                                required
                                type="number"
                                value={state.draft.gold}
                                onChange={event => change("gold", event.target.value)}
                            />
                        </div>
                    </div>
                    <div className="form-group col-4 col-lg-2">
                        <div className="input-group">
                            <div className="input-group-prepend">
                                <label className="input-group-text" htmlFor="mob-aggro">Aggro</label>
                            </div>
                            <div className="input-group-append">
                                <div className="input-group-text">
                                    <input
                                        checked={state.draft.aggro}
                                        id="mob-aggro"
                                        type="checkbox"
                                        onChange={event => change("aggro", event.target.checked)}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <EntityChangelogFields
                    id="mob-notes"
                    label="Notes"
                    rows="5"
                    value={state.draft.notes}
                    onChange={event => change("notes", event.target.value)}
                />
                {saving && (
                    <p ref={statusRef} role="status" aria-label="Saving mob" tabIndex="-1" className="text-info">
                        Saving mob…
                    </p>
                )}
                {state.error && (
                    <p ref={errorRef} role="alert" aria-live="assertive" tabIndex="-1" className="text-danger">
                        Mob could not be saved. Try again.
                    </p>
                )}
                <div className="row">
                    <button
                        className="btn btn-primary btn-block col-12 offset-md-8 col-md-4 offset-lg-10 col-lg-2"
                        type="submit"
                        disabled={!canSubmit}
                        aria-label={saving ? "Saving mob" : "Save"}
                    >
                        {saving ? "Saving…" : "Save"}
                    </button>
                </div>
                <br /><br />
            </form>
        </div>
    );
}
