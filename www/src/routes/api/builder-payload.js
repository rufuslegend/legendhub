"use strict";

const {BadRequestError} = require("./utils");

let codecPromise;
const characterName = /^[A-Za-z0-9 ]+$/;

function loadCodec() {
    codecPromise ||= import("../../../shared/builder-codec.mjs");
    return codecPromise;
}

async function validateBuilderProfile({name, payload}) {
    if (typeof name !== "string" || !characterName.test(name))
        throw new BadRequestError("A character name may contain only letters, digits, and spaces.");
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

module.exports.validateBuilderProfile = validateBuilderProfile;
