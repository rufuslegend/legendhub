import {deriveRuneCharmStats} from "./builder-derivations.js";
import {RUNE_CHARM_ID, RUNE_CHARM_ITEM_INDEX} from "./item-constants.js";

export function createItemsBySlotQuery(fragment) {
    return `${fragment || ""} query BuilderItems($slotId: Int!) { getItemsBySlotId(slotId: $slotId) { ... ItemAll } }`;
}

export function createItemsInIdsQuery(fragment) {
    return `${fragment || ""} query BuilderItemsInIds($ids: [Int!]) { getItemsInIds(ids: $ids) { ... ItemAll } }`;
}

export function hydrateBuilderVariant(variant, items) {
    const itemsById = new Map((items || []).map(item => [item.id, item]));
    return {
        ...variant,
        items: variant.items.map(function(item, index) {
            if (item.id === RUNE_CHARM_ID) {
                const charm = variant.runeCharms[RUNE_CHARM_ITEM_INDEX[index]] || "AAAAA";
                const stats = deriveRuneCharmStats(charm);
                return {...item, ...stats, name: `Runecharm (${stats.charmName.slice(0, -1)})`};
            }
            if (item.id <= 0)
                return {...item, name: "-"};
            const found = itemsById.get(item.id);
            return found ? {...found, slot: item.slot, locked: item.locked} : {...item, name: "DELETED"};
        })
    };
}
