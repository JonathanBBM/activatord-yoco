// Webhook signature checks. Anything that fails these is rejected before we
// parse it, so nobody can fake a "payment succeeded" or "order shipped" call.

import crypto from "crypto";

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// Yoco uses the Standard Webhooks scheme:
//   signed content = `${webhook-id}.${webhook-timestamp}.${rawBody}`
//   key            = base64-decoded secret after the "whsec_" prefix
//   header         = "v1,<base64>" (possibly several, space-separated)
function verifyYoco(headers, rawBody, secret, { toleranceSec = 180, now = Date.now() } = {}) {
  if (!secret) return { ok: false, reason: "YOCO_WEBHOOK_SECRET not set" };
  const id = headers["webhook-id"];
  const ts = headers["webhook-timestamp"];
  const sigHeader = headers["webhook-signature"];
  if (!id || !ts || !sigHeader) return { ok: false, reason: "Missing signature headers" };

  const tsNum = parseInt(ts, 10);
  if (!Number.isFinite(tsNum) || Math.abs(now / 1000 - tsNum) > toleranceSec) {
    return { ok: false, reason: "Timestamp outside tolerance" };
  }

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = crypto.createHmac("sha256", key).update(`${id}.${ts}.${rawBody}`).digest("base64");

  const match = String(sigHeader)
    .split(" ")
    .map((part) => part.split(",")[1])
    .some((sig) => sig && safeEqual(sig, expected));
  return match ? { ok: true } : { ok: false, reason: "Signature mismatch" };
}

// Bob Go signs the raw body with HMAC-SHA256 using the webhook secret and
// sends it base64-encoded in the "Bobgo-Webhook-Signature" header (this is
// what Bob Go's own WooCommerce plugin verifies).
function verifyBobgo(headers, rawBody, secret) {
  if (!secret) return { ok: false, reason: "BOBGO_WEBHOOK_SECRET not set" };
  const sig = headers["bobgo-webhook-signature"];
  if (!sig) return { ok: false, reason: "Missing Bobgo-Webhook-Signature header" };
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  return safeEqual(sig, expected) ? { ok: true } : { ok: false, reason: "Signature mismatch" };
}

export { verifyYoco, verifyBobgo };
