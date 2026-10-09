// POST /api/yoco-webhook
// Yoco calls this when a payment succeeds. We verify Yoco's signature, read the
// delivery details we stored in the checkout metadata, and create the order in
// Bob Go. Safe to receive the same event twice: we check Bob Go first.

import { readRawBody, lowerHeaders, send, log } from "../lib/http.js";
import { verifyYoco } from "../lib/signatures.js";
import * as bobgo from "../lib/bobgo.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });

  const raw = await readRawBody(req);
  const check = verifyYoco(lowerHeaders(req.headers), raw, process.env.YOCO_WEBHOOK_SECRET);
  if (!check.ok) {
    log("yoco", `Rejected webhook: ${check.reason}`);
    return send(res, 403, { error: "Invalid signature" });
  }

  let event;
  try { event = JSON.parse(raw); } catch { return send(res, 400, { error: "Bad JSON" }); }

  if (event.type !== "payment.succeeded") {
    return send(res, 200, { status: "ignored", type: event.type });
  }

  if (process.env.BOBGO_ENABLED === "false") {
    log("yoco", "Bob Go push disabled (BOBGO_ENABLED=false)");
    return send(res, 200, { status: "disabled" });
  }

  const payment = event.payload || {};
  const meta = payment.metadata || {};

  // Payments from checkouts that didn't carry delivery details (e.g. other
  // products) are not ours to ship.
  if (!meta.orderRef || !meta.product) {
    log("yoco", "Payment has no delivery metadata — not sent to Bob Go", { paymentId: payment.id });
    return send(res, 200, { status: "ignored", reason: "no delivery metadata" });
  }

  try {
    const existing = await bobgo.findOrderByNumber(meta.orderRef);
    if (existing) {
      log("yoco", "Order already in Bob Go — skipping duplicate", { orderRef: meta.orderRef, bobgoId: existing.id });
      return send(res, 200, { status: "duplicate", bobgoOrderId: existing.id });
    }

    const payload = bobgo.buildOrderPayload(meta, {
      amountPaidCents: Number(payment.amount),
      currency: payment.currency || "ZAR",
      placedAt: payment.createdDate || new Date().toISOString(),
    });
    const created = await bobgo.createOrder(payload);
    log("yoco", "Order created in Bob Go", { orderRef: meta.orderRef, bobgoId: created && created.id });
    return send(res, 200, { status: "created", bobgoOrderId: created && created.id });
  } catch (err) {
    // 500 makes Yoco retry later, which covers Bob Go being briefly down.
    log("yoco", `FAILED to push order ${meta.orderRef}: ${err.message}`);
    return send(res, 500, { error: "Could not create Bob Go order" });
  }
}
