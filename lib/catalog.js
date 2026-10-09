// Product catalog: what physically gets shipped.
//
// Prices are NOT taken from here. The Scalr page sets the price, Yoco charges
// it, and the amount actually paid is what Bob Go receives. The prices below
// are only a fallback and a reference.
//
// What Bob Go needs from this file is the packed weight and box size per unit,
// so couriers quote correctly. TODO: replace these with Andre's real figures.
// The quantity the buyer chooses is multiplied in automatically.

export const CATALOG = {
  // fixmypool-checkout: one unit, delivery included
  "single": {
    sku: "ACTD-1",
    description: "ActivatorD Single Unit",
    unitPrice: 297,
    unitWeightKg: 0.5,     // TODO: packed weight
    lengthCm: 15,          // TODO: box size
    widthCm: 10,
    heightCm: 10,
  },
  "4-pack": {
    sku: "ACTD-4",
    description: "ActivatorD 4 Pack",
    unitPrice: 849,
    unitWeightKg: 2.0,     // TODO
    lengthCm: 25,          // TODO
    widthCm: 20,
    heightCm: 15,
  },
  "10-pack": {
    sku: "ACTD-10",
    description: "ActivatorD 10-Pack",
    unitPrice: 1859,
    unitWeightKg: 5.0,     // TODO
    lengthCm: 40,          // TODO
    widthCm: 30,
    heightCm: 20,
  },
};

export function getProduct(code) {
  return Object.prototype.hasOwnProperty.call(CATALOG, code) ? CATALOG[code] : null;
}
