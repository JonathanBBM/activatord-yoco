// Product catalog: what physically gets shipped.
//
// Prices are NOT taken from here. The Scalr page sets the price, Yoco charges
// it, and the amount actually paid is what Bob Go receives. The prices below
// are only a fallback and a reference.
//
// What Bob Go needs from this file is the packed weight and box size per unit,
// so couriers quote correctly. Single unit is measured; pack sizes are
// estimates until Andre confirms his actual outer boxes.
// The quantity the buyer chooses is multiplied in automatically.

export const CATALOG = {
  // fixmypool-checkout: one unit, delivery included
  "single": {
    sku: "ACTD-1",
    description: "ActivatorD Single Unit",
    unitPrice: 297,
    unitWeightKg: 0.9,     // 850 g unit, packed
    lengthCm: 14,
    widthCm: 14,
    heightCm: 7,
  },
  "4-pack": {
    sku: "ACTD-4",
    description: "ActivatorD 4 Pack",
    unitPrice: 849,
    unitWeightKg: 3.8,     // estimate: 4 x 0.9 kg + box. Confirm with Andre.
    lengthCm: 30,          // estimate: 2 x 2 layer + padding
    widthCm: 30,
    heightCm: 10,
  },
  "10-pack": {
    sku: "ACTD-10",
    description: "ActivatorD 10-Pack",
    unitPrice: 1859,
    unitWeightKg: 9.5,     // estimate: 10 x 0.9 kg + box. Confirm with Andre.
    lengthCm: 44,          // estimate: 2 layers + padding
    widthCm: 30,
    heightCm: 16,
  },
};

export function getProduct(code) {
  return Object.prototype.hasOwnProperty.call(CATALOG, code) ? CATALOG[code] : null;
}
