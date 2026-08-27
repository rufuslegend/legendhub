"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {classifyImport} = require("../src/routes/api/builder-import");

function profile(name, payload, id) {
    return {name, payload, id, byteLength: Buffer.byteLength(payload)};
}

// Catches comparing raw input instead of canonical payload text, overwriting a
// different same-name account row, or using a non-deterministic Local suffix.
test("import classification copies, deduplicates, and renames per profile", function() {
    const localProfiles = [
        profile("Same", "canonical-same", "local-same"),
        profile("Hero", "canonical-local", "local-hero"),
        profile("Fresh", "canonical-fresh", "local-fresh")
    ];
    const accountProfiles = [
        profile("Same", "canonical-same", "account-same"),
        profile("Hero", "canonical-account", "account-hero"),
        profile("Hero Local", "occupied", "account-local")
    ];

    assert.deepEqual(classifyImport({localProfiles, accountProfiles}).map(action => ({
        type: action.type,
        name: action.profile.name,
        accountId: action.accountProfile?.id,
        to: action.to
    })), [
        {type: "deduplicate", name: "Same", accountId: "account-same", to: undefined},
        {type: "rename", name: "Hero", accountId: undefined, to: "Hero Local 2"},
        {type: "copy", name: "Fresh", accountId: undefined, to: undefined}
    ]);
});

// Catches case-folding names or failing to reserve names generated earlier in
// the same batch before classifying later local profiles.
test("import classification reserves generated names with exact case", function() {
    const actions = classifyImport({
        localProfiles: [
            profile("Hero", "one"),
            profile("Hero", "two"),
            profile("hero", "lower")
        ],
        accountProfiles: [profile("Hero", "server")]
    });

    assert.deepEqual(actions.map(action => [action.type, action.to || action.profile.name]), [
        ["rename", "Hero Local"],
        ["rename", "Hero Local 2"],
        ["copy", "hero"]
    ]);
});

// Catches malformed classification input being silently treated as an empty
// import and later producing a misleading completed receipt.
test("import classification requires profile arrays", function() {
    assert.throws(() => classifyImport({localProfiles: null, accountProfiles: []}), /profiles/i);
    assert.throws(() => classifyImport({localProfiles: [], accountProfiles: null}), /profiles/i);
});
