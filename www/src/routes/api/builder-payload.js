"use strict";

const {BadRequestError} = require("./utils");

let codecPromise;
const characterName = /^[A-Za-z0-9 ]+$/;

function loadCodec() {
    codecPromise ||= import("../../../shared/builder-codec.mjs");
    return codecPromise;
}

function validateCharacterName(name) {
    if (typeof name !== "string" || !characterName.test(name))
        throw new BadRequestError("A character name may contain only letters, digits, and spaces.");
}

async function validateBuilderProfile({name, payload}) {
    validateCharacterName(name);
    const codec = await loadCodec();
    const lists = codec.decodeBuilderLists(payload);
    if (lists.length !== 1)
        throw new BadRequestError("A profile must contain exactly one character.");
    if (!characterName.test(lists[0].name) || lists[0].name !== name)
        throw new BadRequestError("The encoded character name does not match.");
    const canonical = codec.encodeBuilderLists(lists);
    return {
        name,
        payload: canonical,
        payloadVersion: codec.readBuilderFormatVersion(canonical),
        byteLength: Buffer.byteLength(canonical),
        decoded: lists[0]
    };
}

async function renameValidatedBuilderProfile(validated, name) {
    validateCharacterName(name);
    if (!validated?.decoded || validated.decoded.name !== validated.name ||
        !Array.isArray(validated.decoded.variants)) {
        throw new BadRequestError("A validated Builder profile is required.");
    }
    const codec = await loadCodec();
    const payload = codec.encodeBuilderLists([{
        ...validated.decoded,
        name
    }]);
    return validateBuilderProfile({name, payload});
}

module.exports.renameValidatedBuilderProfile = renameValidatedBuilderProfile;
module.exports.validateBuilderProfile = validateBuilderProfile;
