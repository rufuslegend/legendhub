export function glassTableBandClass(index) {
    return Math.floor(index / 3) % 2 === 1 ? "glass-table-band" : undefined;
}
