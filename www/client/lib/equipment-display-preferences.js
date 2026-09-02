export function equipmentTableValue(value, stat, hideZeros) {
    const numeric = stat?.type === "int" || stat?.type === "decimal";
    const zero = value === 0 || (
        typeof value === "string" && value.trim() !== "" && Number(value) === 0
    );
    if (hideZeros && zero && numeric && stat.var !== "rent")
        return "";
    return value ?? "";
}

export function equipmentDisplayPreferences(accountPreferences) {
    return {
        itemPreviews: accountPreferences?.document?.itemPreviews !== false,
        hideEquipmentZeros: accountPreferences?.document?.hideEquipmentZeros === true
    };
}
