export function glassTableBandClass(index) {
    return [
        Math.floor(index / 3) % 2 === 1 ? "glass-table-band" : "",
        index > 0 && index % 3 === 0 ? "glass-table-band-start" : ""
    ].filter(Boolean).join(" ") || undefined;
}
