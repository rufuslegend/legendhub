"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

test("Builder list validation scopes duplicates and enforces the character limit", async function() {
    const {validateBuilderListName} = await import("../../client/features/builder/builder-list-validation.js");
    const allLists = [{name: "Hero", variants: [{name: "Tank"}, {name: "Caster"}]}];
    const input = {allLists, selectedListIndex: 0, selectedVariantIndex: 0};

    assert.deepEqual(validateBuilderListName({...input, mode: "add-character", name: "Tank"}), {name: "Tank", error: ""});
    assert.deepEqual(validateBuilderListName({...input, mode: "edit-variant", name: "Hero"}), {name: "Hero", error: ""});
    assert.equal(validateBuilderListName({...input, mode: "add-character", name: "Hero"}).error, "Duplicate entry.");
    assert.deepEqual(validateBuilderListName({...input, mode: "edit-variant", name: "Tank"}), {name: "Tank", error: ""});
    assert.equal(validateBuilderListName({...input, mode: "edit-variant", name: "Caster"}).error, "Duplicate entry.");
    assert.equal(validateBuilderListName({...input, mode: "edit-variant", name: "Bad!"}).error, "Invalid characters.");
    assert.equal(validateBuilderListName({
        ...input,
        mode: "add-character",
        name: "Overflow",
        allLists: Array.from({length: 20000}, (_, index) => ({name: `Character ${index}`, variants: []}))
    }).error, "Limit reached.");
});
