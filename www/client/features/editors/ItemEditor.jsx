import {useEffect, useReducer, useRef} from "react";
import EntityChangelogFields from "../../components/EntityChangelogFields.jsx";
import EntityLookup from "../../components/EntityLookup.jsx";
import {saveItem, searchMobs, searchQuests} from "./editor-api.js";
import {createInitialEditorState, editorReducer, isEditorDirty} from "./editor-reducer.js";

function defaultValue(stat) {
    if (!stat.defaultValue)
        return undefined;
    if (stat.type === "int" || stat.type === "select")
        return Number.parseInt(stat.defaultValue, 10);
    if (stat.type === "decimal")
        return Number.parseFloat(stat.defaultValue);
    if (stat.type === "bool")
        return stat.defaultValue === "true";
    return stat.defaultValue;
}

function initialItem(item, itemStatCategories) {
    const initial = {notes: "", ...item};
    for (const category of itemStatCategories) {
        for (const stat of category.getItemStatInfo || []) {
            if (stat.editable && !Object.hasOwn(initial, stat.var))
                initial[stat.var] = defaultValue(stat);
        }
    }
    return initial;
}

function weaponVisible(item) {
    return Number(item.slot) === 14 || (Number(item.slot) === 15 && Number(item.accuracy) > 0);
}

function statVisible(stat, item) {
    if (["holdable", "weaponType", "weaponStat", "speedFactor", "quality"].includes(stat.var))
        return Number(item.slot) === 14;
    if (stat.var === "accuracy")
        return Number(item.slot) === 14 || Number(item.slot) === 15;
    return true;
}

function requiredStat(stat, category, item) {
    if (stat.var === "name")
        return true;
    if (stat.type === "int" || stat.type === "decimal")
        return statVisible(stat, item);
    return stat.type === "select" && category.name === "Weapon" && Number(item.slot) === 14;
}

function itemValid(item, itemStatCategories) {
    for (const category of itemStatCategories) {
        if (category.name === "Weapon" && !weaponVisible(item))
            continue;
        for (const stat of category.getItemStatInfo || []) {
            if (!stat.editable || !requiredStat(stat, category, item))
                continue;
            const value = item[stat.var];
            if (value == null || value === "")
                return false;
            if (stat.type === "decimal" && !/^[0-9]+(\.[0-9]{1,2})?$/.test(String(value)))
                return false;
        }
    }
    return true;
}

function ItemStatField({category, constants, item, onChange, stat}) {
    if (!stat.editable)
        return null;
    const visible = statVisible(stat, item);
    const id = `item-${stat.var}`;
    const required = requiredStat(stat, category, item);
    const value = item[stat.var];

    return (
        <div className={`form-group col-6 col-md-4 col-lg-${stat.type === "bool" ? "2" : "3"}`} hidden={!visible}>
            <div className="input-group">
                <div className="input-group-prepend">
                    <label className="input-group-text" htmlFor={id}>{stat.short}</label>
                </div>
                {stat.type === "int" && (
                    <input
                        autoFocus={stat.var === "name"}
                        className="form-control"
                        id={id}
                        name={stat.var}
                        required={required}
                        type="number"
                        value={value ?? ""}
                        onChange={event => onChange(stat.var, event.target.value === "" ? "" : Number(event.target.value))}
                    />
                )}
                {stat.type === "decimal" && (
                    <input
                        className="form-control"
                        id={id}
                        name={stat.var}
                        required={required}
                        step="0.01"
                        type="number"
                        value={value ?? ""}
                        onChange={event => onChange(stat.var, event.target.value === "" ? "" : Number(event.target.value))}
                    />
                )}
                {stat.type === "string" && (
                    <input
                        autoFocus={stat.var === "name"}
                        className="form-control"
                        id={id}
                        name={stat.var}
                        required={required}
                        type="text"
                        value={value ?? ""}
                        onChange={event => onChange(stat.var, event.target.value)}
                    />
                )}
                {stat.type === "bool" && (
                    <div className="input-group-append">
                        <div className="input-group-text">
                            <input
                                checked={Boolean(value)}
                                id={id}
                                name={stat.var}
                                type="checkbox"
                                onChange={event => onChange(stat.var, event.target.checked)}
                            />
                        </div>
                    </div>
                )}
                {stat.type === "select" && (
                    <select
                        className="form-control"
                        id={id}
                        name={stat.var}
                        required={required}
                        value={value ?? ""}
                        onChange={event => onChange(stat.var, event.target.value === "" ? "" : Number(event.target.value))}
                    >
                        <option value="">Choose a {stat.short}</option>
                        {(constants.selectOptions?.[stat.var] || []).map((option, index) => (
                            <option key={index} value={index}>{option}</option>
                        ))}
                    </select>
                )}
            </div>
        </div>
    );
}

export default function ItemEditor({constants = {selectOptions: {}}, item = {}, itemStatCategories = []}) {
    const [state, dispatch] = useReducer(editorReducer, {item, itemStatCategories}, value =>
        createInitialEditorState(initialItem(value.item, value.itemStatCategories)));
    const statusRef = useRef(null);
    const errorRef = useRef(null);
    const saving = state.status === "saving";
    const valid = itemValid(state.draft, itemStatCategories);
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
            const result = await saveItem(state.draft, itemStatCategories);
            window.location.assign(result.redirectUrl);
        }
        catch (_error) {
            dispatch({type: "save/failed", error: "request"});
        }
    }

    return (
        <div className="container">
            <form onSubmit={submit} aria-busy={saving}>
                <div className="form-row"><h1>{state.mode === "edit" ? "Edit Item" : "Add Item"}</h1></div>
                {itemStatCategories.map(category => {
                    const categoryVisible = category.name !== "Weapon" || weaponVisible(state.draft);
                    return (
                        <section key={category.name} hidden={!categoryVisible}>
                            <div className="form-row"><h2 className="h4">{category.name}</h2></div>
                            <div className="form-row">
                                {(category.getItemStatInfo || []).map(stat => (
                                    <ItemStatField
                                        key={stat.var}
                                        category={category}
                                        constants={constants}
                                        item={state.draft}
                                        stat={stat}
                                        onChange={change}
                                    />
                                ))}
                                {category.name === "Basic" && (
                                    <>
                                        <div className="form-group col-12 col-md-4 col-lg-3">
                                            <EntityLookup
                                                addHref="/mobs/add.html"
                                                addLabel="Add new mob"
                                                buttonLabel={state.draft.getMob?.name || "Choose a Mob"}
                                                description="Ensure the mob does not exist before adding a new one."
                                                getResultLabel={mob => mob.name}
                                                lookup={searchMobs}
                                                modalId="item-mob-lookup"
                                                searchLabel="Search for mob"
                                                searchPlaceholder="Search for mob..."
                                                title="Choose a Mob"
                                                onSelect={mob => {
                                                    change("mobId", mob.id);
                                                    change("getMob", {name: mob.name});
                                                }}
                                            />
                                        </div>
                                        <div className="form-group col-12 col-md-4 col-lg-3">
                                            <EntityLookup
                                                addHref="/quests/add.html"
                                                addLabel="Add new quest"
                                                buttonLabel={state.draft.getQuest?.title || "Choose a Quest"}
                                                description="Ensure the quest does not exist before adding a new one."
                                                getResultLabel={quest => quest.title}
                                                lookup={searchQuests}
                                                modalId="item-quest-lookup"
                                                searchLabel="Search for quest"
                                                searchPlaceholder="Search by title, whois, area, or content..."
                                                title="Choose a Quest"
                                                onSelect={quest => {
                                                    change("questId", quest.id);
                                                    change("getQuest", {title: quest.title});
                                                }}
                                            />
                                        </div>
                                    </>
                                )}
                            </div>
                        </section>
                    );
                })}
                <EntityChangelogFields
                    id="item-notes"
                    label="Notes"
                    rows="5"
                    value={state.draft.notes}
                    onChange={event => change("notes", event.target.value)}
                />
                {saving && (
                    <p ref={statusRef} role="status" aria-label="Saving item" tabIndex="-1" className="text-info">
                        Saving item…
                    </p>
                )}
                {state.error && (
                    <p ref={errorRef} role="alert" aria-live="assertive" tabIndex="-1" className="text-danger">
                        Item could not be saved. Try again.
                    </p>
                )}
                <div className="row">
                    <button
                        className="btn btn-primary btn-block col-12 offset-md-8 col-md-4 offset-lg-10 col-lg-2"
                        type="submit"
                        disabled={!canSubmit}
                        aria-label={saving ? "Saving item" : "Save"}
                    >
                        {saving ? "Saving…" : "Save"}
                    </button>
                </div>
                <br /><br />
            </form>
        </div>
    );
}
