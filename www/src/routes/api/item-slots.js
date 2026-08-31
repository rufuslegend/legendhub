"use strict";

const SLOT_COUNT = 22;
const OTHER_SLOT = 21;
const VALID_MASK = (2 ** SLOT_COUNT) - 1;

class SlotValidationError extends Error {}

function slotBit(slotId) {
    if (!Number.isInteger(slotId) || slotId < 0 || slotId >= SLOT_COUNT)
        throw new SlotValidationError("Slot IDs must be integers from 0 through 21.");
    return 2 ** slotId;
}

function slotsToMask(values) {
    if (!Array.isArray(values) || values.length === 0)
        throw new SlotValidationError("Choose at least one slot.");
    const slots = [...new Set(values)].sort((left, right) => left - right);
    for (const slot of slots)
        slotBit(slot);
    if (slots.includes(OTHER_SLOT) && slots.length !== 1)
        throw new SlotValidationError("Other cannot be combined with another slot.");
    return slots.reduce((mask, slot) => mask + slotBit(slot), 0);
}

function maskToSlots(mask) {
    if (!Number.isSafeInteger(mask) || mask <= 0 || (mask & ~VALID_MASK) !== 0)
        throw new SlotValidationError("The stored slot mask is invalid.");
    if ((mask & slotBit(OTHER_SLOT)) !== 0 && mask !== slotBit(OTHER_SLOT))
        throw new SlotValidationError("Other cannot be combined with another slot.");
    return Array.from({length: SLOT_COUNT}, (_, slot) => slot)
        .filter(slot => (mask & slotBit(slot)) !== 0);
}

function resolveSlotWrite({slots, slot, holdable = false, currentSlot, currentMask, insert}) {
    const authoritative = slots !== undefined && slots !== null;
    let normalized;
    if (authoritative) {
        const slotMask = slotsToMask(slots);
        normalized = maskToSlots(slotMask);
    }
    else if (insert) {
        normalized = [slot];
        if (slot === 14 && holdable)
            normalized.push(15);
        slotsToMask(normalized);
    }
    else {
        normalized = maskToSlots(currentMask);
        if (slot !== undefined && slot !== null && !normalized.includes(slot))
            throw new SlotValidationError("The primary slot must be an item capability.");
    }
    const primary = !insert && !authoritative && slot !== undefined && slot !== null
        ? slot
        : !insert && normalized.includes(currentSlot)
            ? currentSlot
            : normalized[0];
    return {slots: normalized, slot: primary, slotMask: slotsToMask(normalized)};
}

module.exports = {
    OTHER_SLOT, SLOT_COUNT, SlotValidationError,
    maskToSlots, resolveSlotWrite, slotBit, slotsToMask
};
