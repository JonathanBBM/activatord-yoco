// Run with:  node test/run-tests.js
// No network: fetch is mocked so we can see exactly what would be sent.

import assert from "assert";
import crypto from "crypto";
import { verifyYoco, verifyBobgo } from "../lib/signatures.js";
import { buildCheckoutMetadata } from "../lib/shipping-metadata.js";
import * as bobgo from "../lib/bobgo.js";
import yocoHandler from "../api/yoco-webhook.js";
import bgHandler from "../api/bobgo-webhook.js";
import createCheckout from "../api/create-checkout.js";

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ok  ", name); }
  catch (e) { console.log("  FAIL", name, "\n      ", e.message); process.exitCode = 1; }
}

function mockRes() {
  return {
    statusCode: 0, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    end(b) { this.body = JSON.parse(b); },
  };
}

const calls = [];
function mockFetch(routes) {
  calls.length = 0;
  global.fetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || "GET", body: opts.body ? JSON.parse(opts.body) : null, headers: opts.headers });
    for (const [match, reply] of routes) {
      if (url.includes(match) && (!reply.method || reply.method === (opts.method || "GET"))) {
        return { ok: reply.status < 300, status: reply.status, text: async () => JSON.stringify(reply.body), json: async () => reply.body };
      }
    }
    return { ok: false, status: 404, text: async () => "{}" };
  };
}

const YOCO_SECRET = "whsec_" + Buffer.from("test-yoco-secret-key-123").toString("base64");
function signYoco(body, ts = Math.floor(Date.now() / 1000)) {
  const key = Buffer.from(YOCO_SECRET.slice(6), "base64");
  const sig = crypto.createHmac("sha256", key).update(`msg_1.${ts}.${body}`).digest("base64");
  return { "webhook-id": "msg_1", "webhook-timestamp": String(ts), "webhook-signature": `v1,${sig}` };
}

const goodOrder = {
  orderRef: "ACT-TEST-1", product: "single", qty: 2,
  shipping: {
    firstName: "Piet", surname: "Pompies", email: "Piet@Example.com", phone: "0821234567",
    street: "12 Pool Lane", suburb: "Three Rivers", city: "Vereeniging", province: "Gauteng", postcode: "1939",
  },
};

(async () => {
  console.log("Signatures");
  await test("Yoco: valid signature accepted", () => {
    const body = '{"a":1}';
    assert.ok(verifyYoco(signYoco(body), body, YOCO_SECRET).ok);
  });
  await test("Yoco: tampered body rejected", () => {
    assert.ok(!verifyYoco(signYoco('{"a":1}'), '{"a":2}', YOCO_SECRET).ok);
  });
  await test("Yoco: old timestamp rejected", () => {
    const body = "{}";
    assert.ok(!verifyYoco(signYoco(body, Math.floor(Date.now() / 1000) - 600), body, YOCO_SECRET).ok);
  });
  await test("Bob Go: valid signature accepted, wrong one rejected", () => {
    const body = '{"topic":"fulfillment/created"}';
    const sig = crypto.createHmac("sha256", "bg-secret").update(body).digest("base64");
    assert.ok(verifyBobgo({ "bobgo-webhook-signature": sig }, body, "bg-secret").ok);
    assert.ok(!verifyBobgo({ "bobgo-webhook-signature": sig }, body, "other").ok);
  });

  console.log("Checkout metadata");
  await test("builds flat string metadata with province code", () => {
    const { metadata, error } = buildCheckoutMetadata(goodOrder);
    assert.ok(!error, error);
    assert.strictEqual(metadata.province, "GP");
    assert.strictEqual(metadata.email, "piet@example.com");
    assert.strictEqual(metadata.qty, "2");
    assert.ok(Object.values(metadata).every((v) => typeof v === "string"));
  });
  await test("rejects missing address fields", () => {
    const r = buildCheckoutMetadata({ ...goodOrder, shipping: { ...goodOrder.shipping, street: "" } });
    assert.ok(/street/.test(r.error));
  });
  await test("rejects unknown product codes", () => {
    assert.ok(buildCheckoutMetadata({ ...goodOrder, product: "free-stuff" }).error);
  });

  console.log("Yoco webhook → Bob Go order");
  process.env.YOCO_WEBHOOK_SECRET = YOCO_SECRET;
  process.env.BOBGO_API_KEY = "bg-key";
  const { metadata } = buildCheckoutMetadata(goodOrder);
  const event = JSON.stringify({
    id: "evt_1", type: "payment.succeeded",
    payload: { id: "p_1", amount: 59400, currency: "ZAR", status: "succeeded", metadata: { checkoutId: "ch_1", ...metadata } },
  });

  await test("creates the Bob Go order with correct fields", async () => {
    mockFetch([
      ["v2/orders?channel_order_number", { status: 200, body: { orders: [] } }],
      ["v2/orders", { method: "POST", status: 201, body: { id: 987 } }],
    ]);
    const res = mockRes();
    await yocoHandler({ method: "POST", headers: signYoco(event), rawBody: event }, res);
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.status, "created");
    const post = calls.find((c) => c.method === "POST");
    assert.strictEqual(post.url, "https://api.bobgo.co.za/v2/orders");
    assert.strictEqual(post.headers.Authorization, "Bearer bg-key");
    assert.strictEqual(post.body.channel_order_number, "ACT-TEST-1");
    assert.strictEqual(post.body.payment_status, "paid");
    assert.strictEqual(post.body.delivery_address.zone, "GP");
    assert.strictEqual(post.body.delivery_address.local_area, "Three Rivers");
    assert.strictEqual(post.body.order_items[0].qty, 2);
    assert.strictEqual(post.body.order_items[0].unit_price, 297, "unit price = amount paid / qty");
    assert.ok(post.body.note.includes("R594.00"));
  });
  await test("does not create a duplicate when Yoco retries", async () => {
    mockFetch([["v2/orders?channel_order_number", { status: 200, body: { orders: [{ id: 987 }] } }]]);
    const res = mockRes();
    await yocoHandler({ method: "POST", headers: signYoco(event), rawBody: event }, res);
    assert.strictEqual(res.body.status, "duplicate");
    assert.ok(!calls.some((c) => c.method === "POST"));
  });
  await test("rejects unsigned calls", async () => {
    mockFetch([]);
    const res = mockRes();
    await yocoHandler({ method: "POST", headers: {}, rawBody: event }, res);
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(calls.length, 0);
  });
  await test("returns 500 (so Yoco retries) when Bob Go is down", async () => {
    mockFetch([
      ["v2/orders?channel_order_number", { status: 200, body: { orders: [] } }],
      ["v2/orders", { method: "POST", status: 503, body: { message: "down" } }],
    ]);
    const res = mockRes();
    await yocoHandler({ method: "POST", headers: signYoco(event), rawBody: event }, res);
    assert.strictEqual(res.statusCode, 500);
  });
  await test("upsell order notes the parent order", () => {
    const p = bobgo.buildOrderPayload({ ...metadata, orderRef: "ACT-TEST-1-UABC", parentRef: "ACT-TEST-1", product: "10-pack" });
    assert.ok(p.note.includes("ship together with order ACT-TEST-1"));
    assert.ok(p.tags.some((t) => t.name === "Ship with ACT-TEST-1"));
  });
  await test("BOBGO_ENABLED=false pauses pushing", async () => {
    process.env.BOBGO_ENABLED = "false";
    mockFetch([]);
    const res = mockRes();
    await yocoHandler({ method: "POST", headers: signYoco(event), rawBody: event }, res);
    assert.strictEqual(res.body.status, "disabled");
    assert.strictEqual(calls.length, 0);
    delete process.env.BOBGO_ENABLED;
  });

  console.log("Bob Go webhook → shipped notification");
  process.env.BOBGO_WEBHOOK_SECRET = "bg-secret";
  process.env.SYSTEME_API_KEY = "sys-key";
  const ful = JSON.stringify({ topic: "fulfillment/created", id: 55, order_id: 987, shipment_tracking_reference: "TRK123" });
  const bgSig = { "Bobgo-Webhook-Signature": crypto.createHmac("sha256", "bg-secret").update(ful).digest("base64") };

  await test("mode=bobgo (default): acknowledges, calls nothing", async () => {
    delete process.env.SHIPPED_NOTIFY;
    mockFetch([]);
    const res = mockRes();
    await bgHandler({ method: "POST", headers: bgSig, rawBody: ful }, res);
    assert.strictEqual(res.body.notify, "bobgo");
    assert.strictEqual(calls.length, 0);
  });
  await test("mode=systeme: saves tracking fields, then tags the buyer", async () => {
    process.env.SHIPPED_NOTIFY = "systeme";
    mockFetch([
      ["v2/orders?id=987", { status: 200, body: { orders: [{ id: 987, channel_order_number: "ACT-TEST-1", customer_email: "piet@example.com" }] } }],
      ["/contacts?email=", { status: 200, body: { items: [{ id: 42, email: "piet@example.com" }] } }],
      ["/contacts/42/tags", { method: "POST", status: 204, body: {} }],
      ["/contacts/42", { method: "PATCH", status: 200, body: {} }],
      ["/tags?limit", { status: 200, body: { items: [{ id: 7, name: "order-shipped" }], hasMore: false } }],
    ]);
    const res = mockRes();
    await bgHandler({ method: "POST", headers: bgSig, rawBody: ful }, res);
    assert.strictEqual(res.body.status, "notified", JSON.stringify(res.body));
    const patch = calls.find((c) => c.method === "PATCH");
    assert.deepStrictEqual(patch.body.fields[0], { slug: "tracking_number", value: "TRK123" });
    assert.strictEqual(patch.body.fields[1].value, "https://track.bobgo.co.za/TRK123");
    const tag = calls.find((c) => c.url.endsWith("/contacts/42/tags"));
    assert.deepStrictEqual(tag.body, { tagId: 7 });
    assert.ok(calls.indexOf(patch) < calls.indexOf(tag), "fields must be saved before tagging");
  });
  await test("ignores orders from other sales channels", async () => {
    mockFetch([["v2/orders?id=987", { status: 200, body: { orders: [{ id: 987, channel_order_number: "WOO-55" }] } }]]);
    const res = mockRes();
    await bgHandler({ method: "POST", headers: bgSig, rawBody: ful }, res);
    assert.strictEqual(res.body.status, "ignored");
    assert.ok(!calls.some((c) => c.url.includes("systeme")));
  });

  console.log("create-checkout (existing endpoint)");
  process.env.YOCO_SECRET_KEY = "sk_test_x";
  function vercelRes() {
    return {
      code: 0, payload: null, headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.code = c; return this; },
      json(p) { this.payload = p; return this; },
      end() { return this; },
    };
  }
  const yocoReply = ["payments.yoco.com/api/checkouts", { method: "POST", status: 200, body: { id: "ch_1", redirectUrl: "https://pay.yoco.com/x" } }];

  await test("without `order` it sends exactly what it did before", async () => {
    mockFetch([yocoReply]);
    const res = vercelRes();
    await createCheckout({ method: "POST", body: { amountInCents: 29700, currency: "ZAR", cancelUrl: "https://c" } }, res);
    assert.strictEqual(res.code, 200);
    assert.deepStrictEqual(Object.keys(calls[0].body).sort(), ["amount", "cancelUrl", "currency", "failureUrl", "successUrl"]);
  });
  await test("with `order` it adds the delivery metadata", async () => {
    mockFetch([yocoReply]);
    const res = vercelRes();
    await createCheckout({ method: "POST", body: { amountInCents: 29700, currency: "ZAR", order: goodOrder } }, res);
    assert.strictEqual(res.code, 200);
    assert.strictEqual(calls[0].body.metadata.orderRef, "ACT-TEST-1");
    assert.strictEqual(calls[0].body.metadata.city, "Vereeniging");
  });
  await test("with an incomplete address it refuses before calling Yoco", async () => {
    mockFetch([yocoReply]);
    const res = vercelRes();
    await createCheckout({ method: "POST", body: { amountInCents: 29700, currency: "ZAR", order: { ...goodOrder, shipping: {} } } }, res);
    assert.strictEqual(res.code, 400);
    assert.strictEqual(calls.length, 0);
  });

  console.log("One-time Yoco setup page");
  const setupHandler = (await import("../api/setup-yoco-webhook.js")).default;
  function htmlRes() { return { statusCode: 0, body: "", setHeader() {}, end(b) { this.body = b || ""; } }; }

  await test("switched off when SETUP_TOKEN isn't set", async () => {
    delete process.env.SETUP_TOKEN;
    mockFetch([]);
    const res = htmlRes();
    await setupHandler({ url: "/api/setup-yoco-webhook?token=anything" }, res);
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(calls.length, 0);
  });
  await test("wrong token gets a 404 and calls nothing", async () => {
    process.env.SETUP_TOKEN = "correct-horse-battery";
    mockFetch([]);
    const res = htmlRes();
    await setupHandler({ url: "/api/setup-yoco-webhook?token=wrong" }, res);
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(calls.length, 0);
  });
  await test("correct token registers the webhook and shows the secret", async () => {
    mockFetch([
      ["payments.yoco.com/api/webhooks", { method: "GET", status: 200, body: { subscriptions: [] } }],
      ["payments.yoco.com/api/webhooks", { method: "POST", status: 200, body: { id: "sub_1", mode: "live", secret: "whsec_TESTSECRET" } }],
    ]);
    const res = htmlRes();
    await setupHandler({ url: "/api/setup-yoco-webhook?token=correct-horse-battery" }, res);
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.body.includes("whsec_TESTSECRET"));
    const post = calls.find((c) => c.method === "POST");
    assert.strictEqual(post.body.url, "https://activatord-yoco.vercel.app/api/yoco-webhook");
    assert.strictEqual(post.headers.Authorization, "Bearer sk_test_x");
  });
  await test("doesn't replace an existing webhook unless asked", async () => {
    mockFetch([["payments.yoco.com/api/webhooks", { method: "GET", status: 200,
      body: { subscriptions: [{ id: "sub_1", url: "https://activatord-yoco.vercel.app/api/yoco-webhook" }] } }]]);
    const res = htmlRes();
    await setupHandler({ url: "/api/setup-yoco-webhook?token=correct-horse-battery" }, res);
    assert.ok(res.body.includes("Already registered"));
    assert.ok(!calls.some((c) => c.method === "DELETE" || c.method === "POST"));
  });
  delete process.env.SETUP_TOKEN;

  console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
})();
