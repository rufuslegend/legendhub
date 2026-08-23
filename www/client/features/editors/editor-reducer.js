export function createInitialEditorState(entity) {
    const initial = {...entity};
    return {
        mode: entity.id == null ? "add" : "edit",
        initial,
        draft: {...initial},
        status: "editing",
        error: null
    };
}

export function isEditorDirty(state) {
    return JSON.stringify(state.draft) !== JSON.stringify(state.initial);
}

export function editorReducer(state, action) {
    switch (action.type) {
        case "field/change":
            return {
                ...state,
                draft: {...state.draft, [action.field]: action.value},
                status: "editing",
                error: null
            };
        case "category/change":
            return {
                ...state,
                draft: {
                    ...state.draft,
                    [action.field]: action.value,
                    [action.dependentField]: null
                },
                status: "editing",
                error: null
            };
        case "save/requested":
            if (state.status === "saving")
                return state;
            return {...state, status: "saving", error: null};
        case "save/failed":
            return {...state, status: "editing", error: action.error};
        default:
            return state;
    }
}
