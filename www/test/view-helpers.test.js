"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {serializeJsonForHtml} = require("../src/view-helpers");

test("serializeJsonForHtml round-trips values without HTML-significant characters", async function(t) {
    const values = [
        {name: "quotes", value: {double: "\"", single: "'"}},
        {name: "ampersands", value: {query: "a&b"}},
        {name: "script markup", value: {content: "<script>alert('x')</script>"}},
        {name: "Unicode separators", value: {line: "before\u2028after", paragraph: "before\u2029after"}},
        {name: "null", value: null},
        {name: "arrays", value: ["<", "&", {nested: ">"}]},
        {name: "nested objects", value: {one: {two: {three: "safe"}}}}
    ];

    for (const {name, value} of values) {
        await t.test(`serializes ${name}`, function() {
            const serialized = serializeJsonForHtml(value);

            assert.deepEqual(JSON.parse(serialized), value);
            assert.doesNotMatch(serialized, /[<>&\u2028\u2029]/);
        });
    }
});
