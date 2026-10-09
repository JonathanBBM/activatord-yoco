// POST /api/bobgo-webhook
// Bob Go calls this when Andre fulfils an order (topic: fulfillment/created).
// What happens next depends on SHIPPED_NOTIFY:
//   "bobgo"   (default) — do nothing here; Bob Go's own tracking emails/WhatsApp
//                         notify the customer. Works on Bob Go's free plan.
//   "systeme"           — tag the buyer in Systeme.io so an automation sends
//                         the "your order is on its way" email.
//   "off"               — no shipped notification.

import { readRawBody, lowerHeaders, send, log } from "../lib/http.js";
import { verifyBobgo } from "../lib/signatures.js";
import * as bobgo from "../lib/bobgo.js";
import * as systeme from "../lib/systeme.js";

const ORDER_PREFIX = process.env.ORDER_PREFIX || "ACT-";

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });

  const raw = await readRawBody(req);
  const headers = lowerHeaders(req.headers);
  const check = verifyBobgo(headers, raw, process.env.BOBGO_WEBHOOK_SECRET);
  if (!check.ok) {
    log("bobgo", `Rejected webhook: ${check.reason}`);
    return send(res, 403, { error: "Invalid signature" });
  }

  let data;
  try { data = JSON.parse(raw); } catch { return send(res, 400, { error: "Bad JSON" }); }

  const topic = data.topic || headers["x-bobgroup-topic"] || "";
  if (topic !== "fulfillment/created") return send(res, 200, { status: "ignored", topic });

  const mode = (process.env.SHIPPED_NOTIFY || "bobgo").toLowerCase();
  if (mode !== "systeme") return send(res, 200, { status: "ok", notify: mode });

  try {
    // Fulfilment payloads point at their order via order_id.
    const bobgoOrderId = data.order_id;
    if (!bobgoOrderId) return send(res, 200, { status: "ignored", reason: "no order_id" });

    const order = await bobgo.getOrderById(bobgoOrderId);
    // Subscriptions are account-wide: only act on orders this integration made.
    if (!order || !String(order.channel_order_number || "").startsWith(ORDER_PREFIX)) {
      return send(res, 200, { status: "ignored", reason: "not an ActivatorD funnel order" });
    }

    const trackingNumber = data.shipment_tracking_reference || (await bobgo.getTrackingReference(bobgoOrderId));
    const result = await systeme.markShipped(order.customer_email, {
      trackingNumber,
      trackingUrl: bobgo.trackingUrl(trackingNumber),
    });
    log("bobgo", result.done ? "Buyer tagged as shipped in Systeme.io" : `Not tagged: ${result.reason}`, {
      order: order.channel_order_number,
    });
    return send(res, 200, { status: result.done ? "notified" : "skipped" });
  } catch (err) {
    // Always 200 here: repeated failures make Bob Go disable the whole
    // subscription. The failure is in the Vercel logs for follow-up.
    log("bobgo", `FAILED shipped notification: ${err.message}`);
    return send(res, 200, { status: "error-logged" });
  }
}
