// Bob Go API client. Endpoints and field names match Bob Go's own
// WooCommerce plugin (v2 API): POST /v2/orders, GET /v2/orders,
// GET /v2/order-fulfillments, POST /v2/webhooks.

import { getProduct } from "./catalog.js";

const BASE_URLS = {
  production: "https://api.bobgo.co.za",
  sandbox: "https://api.sandbox.bobgo.co.za",
};

function baseUrl() {
  return BASE_URLS[process.env.BOBGO_ENV === "sandbox" ? "sandbox" : "production"];
}

async function request(method, path, body) {
  const apiKey = process.env.BOBGO_API_KEY;
  if (!apiKey) throw new Error("BOBGO_API_KEY not set");

  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  // Only needed if the key was issued for a specific sales channel in Bob Go.
  if (process.env.BOBGO_CHANNEL_IDENTIFIER) {
    headers["bobgo-channel-identifier"] = process.env.BOBGO_CHANNEL_IDENTIFIER;
  }

  const res = await fetch(`${baseUrl()}/${path.replace(/^\//, "")}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

// Turns the unpacked Yoco metadata into a Bob Go order.
function buildOrderPayload(meta, { amountPaidCents, currency = "ZAR", placedAt } = {}) {
  const product = getProduct(meta.product);
  if (!product) throw new Error(`Unknown product code: ${meta.product}`);
  const qty = Math.max(1, parseInt(meta.qty, 10) || 1);

  // The price comes from what Yoco actually charged (the page sets it), so a
  // price change on the Scalr page never needs a code change here. The catalog
  // price is only a fallback if Yoco didn't report an amount.
  const unitPrice = Number.isFinite(amountPaidCents) && amountPaidCents > 0
    ? Math.round(amountPaidCents / qty) / 100
    : product.unitPrice;

  const notes = [];
  if (meta.parentRef) notes.push(`UPSELL: ship together with order ${meta.parentRef}.`);
  if (Number.isFinite(amountPaidCents)) notes.push(`Paid via Yoco: R${(amountPaidCents / 100).toFixed(2)}.`);

  const payload = {
    channel_ref_id: meta.orderRef,
    channel_order_number: meta.orderRef,
    customer_name: meta.firstName || "",
    customer_surname: meta.surname || "",
    customer_email: meta.email || "",
    customer_phone: meta.phone || "",
    currency,
    payment_status: "paid",
    delivery_address: {
      company: "",
      street_address: meta.street || "",
      local_area: meta.suburb || "",
      city: meta.city || "",
      zone: meta.province || "",
      country: "ZA",
      code: meta.postcode || "",
    },
    order_items: [
      {
        channel_ref_id: 1,
        description: product.description,
        sku: product.sku,
        unit_price: unitPrice,
        qty,
        unit_weight_kg: product.unitWeightKg,
        unit_length_cm: product.lengthCm,
        unit_width_cm: product.widthCm,
        unit_height_cm: product.heightCm,
      },
    ],
    note: notes.join(" "),
    tags: [{ name: "ActivatorD" }].concat(meta.parentRef ? [{ name: `Ship with ${meta.parentRef}` }] : []),
  };
  if (placedAt) payload.date_placed_on_channel = placedAt;
  return payload;
}

async function findOrderByNumber(orderNumber) {
  const r = await request("GET", `v2/orders?channel_order_number=${encodeURIComponent(orderNumber)}`);
  if (!r.ok) throw new Error(`Bob Go lookup failed (HTTP ${r.status})`);
  const orders = (r.data && r.data.orders) || [];
  return orders[0] || null;
}

async function getOrderById(id) {
  const r = await request("GET", `v2/orders?id=${encodeURIComponent(id)}`);
  if (!r.ok) throw new Error(`Bob Go order fetch failed (HTTP ${r.status})`);
  const orders = (r.data && r.data.orders) || [];
  return orders[0] || null;
}

async function createOrder(payload) {
  const r = await request("POST", "v2/orders", payload);
  if (!r.ok) {
    const msg = r.data && r.data.message ? r.data.message : `HTTP ${r.status}`;
    throw new Error(`Bob Go rejected the order: ${msg}`);
  }
  return r.data;
}

// First tracking reference on an order's fulfilments, if Bob Go has one yet.
async function getTrackingReference(bobgoOrderId) {
  const r = await request("GET", `v2/order-fulfillments?order_id=${encodeURIComponent(bobgoOrderId)}`);
  if (!r.ok) return "";
  for (const entry of (r.data && r.data.order_fulfillments) || []) {
    const of = entry.order_fulfillment || entry;
    const shipment = entry.shipment || {};
    const ref = shipment.tracking_reference || of.method_reference;
    if (ref) return String(ref);
  }
  return "";
}

function trackingUrl(ref) {
  if (!ref) return "";
  const host = process.env.BOBGO_ENV === "sandbox" ? "track.dev.bobgo.co.za" : "track.bobgo.co.za";
  return `https://${host}/${encodeURIComponent(ref)}`;
}

export {
  request, buildOrderPayload, findOrderByNumber, getOrderById,
  createOrder, getTrackingReference, trackingUrl, baseUrl,
};
