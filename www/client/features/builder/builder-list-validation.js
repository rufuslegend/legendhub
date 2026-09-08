export function validateBuilderListName({
    name,
    mode,
    allLists,
    selectedListIndex,
    selectedVariantIndex
}) {
    name = String(name || "").trim();
    if (!/^[A-Za-z\s\d]+$/.test(name))
        return {name, error: "Invalid characters."};
    if (mode === "add-character" && allLists.length >= 20000)
        return {name, error: "Limit reached."};

    const characterDialog = mode === "add-character" || mode === "edit-character";
    const variantDialog = mode === "edit-variant";
    const duplicateCharacter = characterDialog && allLists.some((list, index) =>
        list.name === name && (mode !== "edit-character" || index !== selectedListIndex));
    const variants = allLists[selectedListIndex]?.variants || [];
    const duplicateVariant = variantDialog && variants.some((variant, index) =>
        variant.name === name && (mode !== "edit-variant" || index !== selectedVariantIndex));
    return {name, error: duplicateCharacter || duplicateVariant ? "Duplicate entry." : ""};
}
