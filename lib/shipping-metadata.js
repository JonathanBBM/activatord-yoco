// Packs the customer's delivery details into Yoco checkout metadata, and
// unpacks them again when Yoco confirms the payment.
//
// Why metadata: Yoco hands the metadata back to us in its payment webhook, so
// the address travels with the payment itself. No database is needed, and an
// order only ever reaches Bob Go after Yoco has confirmed the money arrived.

import { getProduct } from "./catalog.js";

const MAX_LEN = 120;

const PROVINCES = {
  "eastern cape": "EC", "free state": "FS", "gauteng": "GP",
  "kwazulu-natal": "KZN", "kwazulu natal": "KZN", "kzn": "KZN",
  "limpopo": "LP", "mpumalanga": "MP", "northern cape": "NC",
  "north west": "NW", "north-west": "NW", "western cape": "WC",
};

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/[\r\n\t]+/g, " ").trim().slice(0, MAX_LEN);
}

function provinceCode(value) {
  const v = clean(value);
  if (!v) return "";
  const known = Object.values(PROVINCES);
  if (known.includes(v.toUpperCase())) return v.toUpperCase();
  return PROVINCES[v.toLowerCase()] || v;
}

// Called inside create-checkout. `order` is what the footer script sends.
// Returns { metadata } on success or { error } when something required is missing.
function buildCheckoutMetadata(order) {
  if (!order || typeof order !== "object") return { error: "Missing order details" };

  const product = clean(order.product);
  if (!getProduct(product)) return { error: `Unknown product code: ${product || "(empty)"}` };

  const qty = Math.max(1, Math.min(50, parseInt(order.qty, 10) || 1));
  const s = order.shipping || {};

  const metadata = {
    orderRef: clean(order.orderRef),
    parentRef: clean(order.parentRef),
    product,
    qty: String(qty),
    firstName: clean(s.firstName),
    surname: clean(s.surname),
    email: clean(s.email).toLowerCase(),
    phone: clean(s.phone),
    street: clean(s.street),
    suburb: clean(s.suburb),
    city: clean(s.city),
    province: provinceCode(s.province),
    postcode: clean(s.postcode),
  };

  const required = ["orderRef", "firstName", "email", "phone", "street", "city", "postcode"];
  const missing = required.filter((k) => !metadata[k]);
  if (missing.length) return { error: `Missing delivery fields: ${missing.join(", ")}` };

  // Drop empty optional keys so the metadata stays small.
  for (const k of Object.keys(metadata)) if (!metadata[k]) delete metadata[k];
  return { metadata };
}

export { buildCheckoutMetadata, provinceCode, clean };
