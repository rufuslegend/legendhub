const emptyPasswordEditor = {
    status: "viewing",
    oldPassword: "",
    newPassword: "",
    confirmPassword: "",
    error: null
};

export function createInitialAccountState(notificationSettings) {
    return {
        notificationEditor: {
            status: "viewing",
            saved: {...notificationSettings},
            draft: {...notificationSettings},
            error: null
        },
        passwordEditor: {...emptyPasswordEditor}
    };
}

export function accountReducer(state, action) {
    switch (action.type) {
        case "notification/edit":
            return {
                ...state,
                notificationEditor: {
                    ...state.notificationEditor,
                    status: "editing",
                    draft: {...state.notificationEditor.saved},
                    error: null
                }
            };
        case "notification/change":
            return {
                ...state,
                notificationEditor: {
                    ...state.notificationEditor,
                    draft: {
                        ...state.notificationEditor.draft,
                        [action.field]: action.value
                    },
                    error: null
                }
            };
        case "notification/cancel":
            return {
                ...state,
                notificationEditor: {
                    ...state.notificationEditor,
                    status: "viewing",
                    draft: {...state.notificationEditor.saved},
                    error: null
                }
            };
        case "notification/save-requested":
            if (state.notificationEditor.status === "saving")
                return state;
            return {
                ...state,
                notificationEditor: {
                    ...state.notificationEditor,
                    status: "saving",
                    error: null
                }
            };
        case "notification/save-succeeded":
            return {
                ...state,
                notificationEditor: {
                    status: "viewing",
                    saved: {...state.notificationEditor.draft},
                    draft: {...state.notificationEditor.draft},
                    error: null
                }
            };
        case "notification/save-failed":
            return {
                ...state,
                notificationEditor: {
                    ...state.notificationEditor,
                    status: "editing",
                    error: "network"
                }
            };
        case "password/edit":
            return {
                ...state,
                passwordEditor: {...emptyPasswordEditor, status: "editing"}
            };
        case "password/change":
            return {
                ...state,
                passwordEditor: {
                    ...state.passwordEditor,
                    [action.field]: action.value,
                    error: null
                }
            };
        case "password/cancel":
        case "password/save-succeeded":
            return {...state, passwordEditor: {...emptyPasswordEditor}};
        case "password/save-requested":
            if (state.passwordEditor.status === "saving")
                return state;
            if (state.passwordEditor.newPassword !== state.passwordEditor.confirmPassword) {
                return {
                    ...state,
                    passwordEditor: {
                        ...state.passwordEditor,
                        status: "editing",
                        error: "mismatch"
                    }
                };
            }
            return {
                ...state,
                passwordEditor: {
                    ...state.passwordEditor,
                    status: "saving",
                    error: null
                }
            };
        case "password/invalid-current-password":
            return {
                ...state,
                passwordEditor: {
                    ...state.passwordEditor,
                    status: "editing",
                    error: "invalid-current-password"
                }
            };
        case "password/save-failed":
            return {
                ...state,
                passwordEditor: {
                    ...state.passwordEditor,
                    status: "editing",
                    error: "network"
                }
            };
        default:
            return state;
    }
}
