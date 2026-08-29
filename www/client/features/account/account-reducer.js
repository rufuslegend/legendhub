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

export const BUILDER_ACCOUNT_QUOTA_BYTES = 10 * 1024 * 1024;

const emptyBuilderStorage = {
    enabled: false,
    profiles: [],
    usedBytes: 0,
    quotaBytes: 0,
    storageGeneration: 0,
    exportStatus: "idle",
    exportError: null,
    deleteDialogOpen: false,
    deleteStatus: "idle",
    deleteError: null,
    announcement: null
};

function safeNonnegativeInteger(value, fallback = 0) {
    return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function createInitialBuilderStorage(emailStatus, suppliedBuilderStorage) {
    if (!emailStatus.canUseAccountStorage || suppliedBuilderStorage?.enabled !== true)
        return {...emptyBuilderStorage};

    return {
        ...emptyBuilderStorage,
        enabled: true,
        profiles: Array.isArray(suppliedBuilderStorage.profiles)
            ? suppliedBuilderStorage.profiles.map(profile => ({
                id: profile.id,
                name: profile.name,
                revision: profile.revision,
                updatedOn: profile.updatedOn
            }))
            : [],
        usedBytes: safeNonnegativeInteger(suppliedBuilderStorage.usedBytes),
        quotaBytes: suppliedBuilderStorage.quotaBytes === BUILDER_ACCOUNT_QUOTA_BYTES
            ? suppliedBuilderStorage.quotaBytes
            : BUILDER_ACCOUNT_QUOTA_BYTES,
        storageGeneration: safeNonnegativeInteger(
            suppliedBuilderStorage.storageGeneration
        )
    };
}

function formatBytes(value) {
    const bytes = safeNonnegativeInteger(value);
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024) {
        const kilobytes = bytes / 1024;
        return `${Number(kilobytes.toFixed(1))} KB`;
    }
    const megabytes = bytes / (1024 * 1024);
    return `${Number(megabytes.toFixed(1))} MB`;
}

export function formatBuilderStorageUsage(usedBytes) {
    return `${formatBytes(usedBytes)} of 10 MB used`;
}

export function createInitialAccountState(
    notificationSettings,
    suppliedEmailStatus,
    suppliedBuilderStorage
) {
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
        },
        builderStorage: createInitialBuilderStorage(
            emailStatus,
            suppliedBuilderStorage
        )
    };
}

export function accountReducer(state, action) {
    switch (action.type) {
        case "storage/export-requested":
            if (!state.builderStorage.enabled ||
                state.builderStorage.exportStatus === "exporting") {
                return state;
            }
            return {
                ...state,
                builderStorage: {
                    ...state.builderStorage,
                    exportStatus: "exporting",
                    exportError: null,
                    announcement: null
                }
            };
        case "storage/export-succeeded":
            if (state.builderStorage.exportStatus !== "exporting")
                return state;
            return {
                ...state,
                builderStorage: {
                    ...state.builderStorage,
                    exportStatus: "idle",
                    exportError: null,
                    announcement: "exported"
                }
            };
        case "storage/export-failed":
            if (state.builderStorage.exportStatus !== "exporting")
                return state;
            return {
                ...state,
                builderStorage: {
                    ...state.builderStorage,
                    exportStatus: "idle",
                    exportError: "export-failed",
                    announcement: null
                }
            };
        case "storage/dialog-opened":
            if (!state.builderStorage.enabled ||
                state.builderStorage.deleteStatus === "deleting") {
                return state;
            }
            return {
                ...state,
                builderStorage: {
                    ...state.builderStorage,
                    deleteDialogOpen: true,
                    deleteError: null,
                    announcement: null
                }
            };
        case "storage/delete-requested":
            if (!state.builderStorage.enabled ||
                !state.builderStorage.deleteDialogOpen ||
                state.builderStorage.deleteStatus === "deleting") {
                return state;
            }
            return {
                ...state,
                builderStorage: {
                    ...state.builderStorage,
                    deleteStatus: "deleting",
                    deleteError: null,
                    announcement: null
                }
            };
        case "storage/delete-succeeded": {
            const result = action.result;
            const valid = state.builderStorage.deleteStatus === "deleting" &&
                result?.status === "deleted" &&
                result.storageGeneration ===
                    state.builderStorage.storageGeneration + 1 &&
                result.usedBytes === 0 &&
                result.quotaBytes === BUILDER_ACCOUNT_QUOTA_BYTES;
            if (!valid) {
                return {
                    ...state,
                    builderStorage: {
                        ...state.builderStorage,
                        deleteStatus: "idle",
                        deleteError: "delete-failed",
                        announcement: null
                    }
                };
            }
            return {
                ...state,
                builderStorage: {
                    ...state.builderStorage,
                    profiles: [],
                    usedBytes: result.usedBytes,
                    quotaBytes: result.quotaBytes,
                    storageGeneration: result.storageGeneration,
                    deleteDialogOpen: false,
                    deleteStatus: "idle",
                    deleteError: null,
                    announcement: "deleted"
                }
            };
        }
        case "storage/delete-failed":
            if (state.builderStorage.deleteStatus !== "deleting")
                return state;
            return {
                ...state,
                builderStorage: {
                    ...state.builderStorage,
                    deleteStatus: "idle",
                    deleteError: "delete-failed",
                    announcement: null
                }
            };
        case "storage/dialog-closed":
            if (state.builderStorage.deleteStatus === "deleting")
                return state;
            return {
                ...state,
                builderStorage: {
                    ...state.builderStorage,
                    deleteDialogOpen: false,
                    deleteError: null
                }
            };
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
