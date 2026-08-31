"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
    SlotValidationError,
    maskToSlots,
    resolveSlotWrite,
    slotsToMask
} = require("../src/routes/api/item-slots");

test("slot masks round-trip in canonical order", function() {
    assert.equal(slotsToMask([15, 2, 14]), (2 ** 2) + (2 ** 14) + (2 ** 15));
    assert.deepEqual(maskToSlots((2 ** 15) + (2 ** 2) + (2 ** 14)), [2, 14, 15]);
});

test("authoritative arrays retain a selected primary then fall back canonically", function() {
    assert.deepEqual(resolveSlotWrite({slots: [15, 2], currentSlot: 15, insert: false}), {
        slots: [2, 15], slot: 15, slotMask: (2 ** 2) + (2 ** 15)
    });
    assert.equal(resolveSlotWrite({slots: [15, 2], currentSlot: 14, insert: false}).slot, 2);
});

test("legacy creates infer only Holdable Wield and legacy updates preserve masks", function() {
    assert.deepEqual(resolveSlotWrite({slot: 14, holdable: true, insert: true}).slots, [14, 15]);
    assert.deepEqual(resolveSlotWrite({slot: 10, holdable: true, insert: true}).slots, [10]);
    assert.deepEqual(resolveSlotWrite({currentSlot: 14, currentMask: (2 ** 14) + (2 ** 15), insert: false}).slots, [14, 15]);
    assert.equal(resolveSlotWrite({slot: 15, currentSlot: 14, currentMask: (2 ** 14) + (2 ** 15), insert: false}).slot, 15);
    assert.throws(() => resolveSlotWrite({slot: 10, currentSlot: 14, currentMask: (2 ** 14) + (2 ** 15), insert: false}), SlotValidationError);
});

test("slot masks reject empty, unknown, and Other-combined capabilities", function() {
    for (const slots of [[], [-1], [22], [1, 21], [1.5]])
        assert.throws(() => slotsToMask(slots), SlotValidationError);
});
