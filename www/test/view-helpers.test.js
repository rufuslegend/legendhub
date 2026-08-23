"use strict";

const assert = require("node:assert/strict");
const ejs = require("ejs");
const path = require("node:path");
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

// Catches editable item data escaping the inert Items-page props container.
test("items page serializes editable results through the shared HTML-safe contract", async function() {
    const editableName = "</script><img src=x onerror=alert(1)>&\u2028";
    const html = await ejs.renderFile(path.join(__dirname, "../src/views/items/index.ejs"), {
        cookies: {},
        serializeJsonForHtml,
        title: "Items",
        url: {path: "/items/"},
        user: null,
        version: "test",
        vm: {
            constants: {},
            itemStatCategories: [],
            itemStatInfo: [],
            moreResults: false,
            noSearch: false,
            page: 1,
            query: {},
            results: [{name: editableName}],
            selectedColumns: []
        }
    });
    const propsMatch = html.match(
        /<script type="application\/json" data-react-props="items">([\s\S]*?)<\/script>/);

    assert.ok(propsMatch, "items page must contain one inert props element");
    assert.equal(/[<>&\u2028\u2029]/.test(propsMatch[1]), false,
        "items props must not contain literal HTML-significant characters");
    const parsed = JSON.parse(propsMatch[1]);
    assert.equal(parsed.results[0].name === editableName, true,
        "escaped item props must preserve the original value");
});
