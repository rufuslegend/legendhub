const emptyPasswordEditor = {
    status: "viewing",
    oldPassword: "",
    newPassword: "",
    confirmPassword: "",
    error: null
};

const emptyEmailStatus = {
    email: null,
    verified: false,
    pendingEmail: null,
    canUseAccountStorage: false
};

export function createInitialAccountState(notificationSettings, suppliedEmailStatus) {
    const emailStatus = {...emptyEmailStatus, ...suppliedEmailStatus};
    return {
        notificationEditor: {
            status: "viewing",
            saved: {...notificationSettings},
            draft: {...notificationSettings},
            error: null
        },
        passwordEditor: {...emptyPasswordEditor},
        emailEditor: {
            status: "viewing",
            email: emailStatus.email,
            draftEmail: emailStatus.pendingEmail || emailStatus.email || "",
            verified: Boolean(emailStatus.verified),
            pendingEmail: emailStatus.pendingEmail,
            canUseAccountStorage: Boolean(emailStatus.canUseAccountStorage),
            password: "",
            error: null,
            announcement: null,
            resendCooldownSeconds: 0
        }
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
        case "email/edit":
            return {
                ...state,
                emailEditor: {
                    ...state.emailEditor,
                    status: "editing",
                    draftEmail: state.emailEditor.pendingEmail ||
                        state.emailEditor.email || "",
                    password: "",
                    error: null,
                    announcement: null
                }
            };
        case "email/change":
            return {
                ...state,
                emailEditor: {
                    ...state.emailEditor,
                    [action.field === "email" ? "draftEmail" : action.field]: action.value,
                    error: null,
                    announcement: null
                }
            };
        case "email/cancel":
            return {
                ...state,
                emailEditor: {
                    ...state.emailEditor,
                    status: "viewing",
                    draftEmail: state.emailEditor.pendingEmail ||
                        state.emailEditor.email || "",
                    password: "",
                    error: null,
                    announcement: null
                }
            };
        case "email/save-requested":
            if (state.emailEditor.status === "saving")
                return state;
            return {
                ...state,
                emailEditor: {
                    ...state.emailEditor,
                    status: "saving",
                    error: null,
                    announcement: null
                }
            };
        case "email/save-succeeded":
            return {
                ...state,
                emailEditor: {
                    ...state.emailEditor,
                    status: "viewing",
                    draftEmail: action.pendingEmail,
                    pendingEmail: action.pendingEmail,
                    password: "",
                    error: null,
                    announcement: "verification-sent"
                }
            };
        case "email/invalid-current-password":
            return {
                ...state,
                emailEditor: {
                    ...state.emailEditor,
                    status: "editing",
                    password: "",
                    error: "invalid-current-password",
                    announcement: null
                }
            };
        case "email/save-failed":
            return {
                ...state,
                emailEditor: {
                    ...state.emailEditor,
                    status: "editing",
                    password: "",
                    error: "network",
                    announcement: null
                }
            };
        case "email/resend-requested":
            if (state.emailEditor.status === "resending" ||
                state.emailEditor.resendCooldownSeconds > 0) {
                return state;
            }
            return {
                ...state,
                emailEditor: {
                    ...state.emailEditor,
                    status: "resending",
                    password: "",
                    error: null,
                    announcement: null
                }
            };
        case "email/resend-succeeded":
            return {
                ...state,
                emailEditor: {
                    ...state.emailEditor,
                    status: "viewing",
                    password: "",
                    error: null,
                    announcement: "verification-sent",
                    resendCooldownSeconds: 60
                }
            };
        case "email/resend-rate-limited":
            return {
                ...state,
                emailEditor: {
                    ...state.emailEditor,
                    status: "viewing",
                    password: "",
                    error: null,
                    announcement: "resend-rate-limited",
                    resendCooldownSeconds: 60
                }
            };
        case "email/resend-cooldown-tick":
            if (state.emailEditor.resendCooldownSeconds <= 0)
                return state;
            return {
                ...state,
                emailEditor: {
                    ...state.emailEditor,
                    resendCooldownSeconds: Math.max(
                        0,
                        state.emailEditor.resendCooldownSeconds - 1
                    )
                }
            };
        case "email/resend-failed":
            return {
                ...state,
                emailEditor: {
                    ...state.emailEditor,
                    status: "viewing",
                    password: "",
                    error: "network",
                    announcement: null
                }
            };
        default:
            return state;
    }
}
