// One-off setup: tell Yoco and Bob Go where to send their webhooks.
//
// Run from the project folder (Node 18+), keys passed as env vars:
//
//   YOCO_SECRET_KEY=sk_live_... BOBGO_API_KEY=... node scripts/register-webhooks.js yoco
//   BOBGO_API_KEY=... node scripts/register-webhooks.js bobgo
//   BOBGO_API_KEY=... node scripts/register-webhooks.js list-bobgo
//
// Yoco prints a signing secret ONCE — copy it into Vercel as YOCO_WEBHOOK_SECRET.

import * as bobgo from "../lib/bobgo.js";

const SITE = process.env.WEBHOOK_BASE_URL || "https://activatord-yoco.vercel.app";

async function registerYoco() {
  const key = process.env.YOCO_SECRET_KEY;
  if (!key) throw new Error("Set YOCO_SECRET_KEY");
  const res = await fetch("https://payments.yoco.com/api/webhooks", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "activatord-bobgo", url: `${SITE}/api/yoco-webhook` }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Yoco said HTTP ${res.status}: ${JSON.stringify(data)}`);
  console.log("Yoco webhook registered:", data.id, `(mode: ${data.mode})`);
  console.log("\nCopy this into Vercel as YOCO_WEBHOOK_SECRET (shown only once):\n");
  console.log(data.secret);
}

async function registerBobgo() {
  const r = await bobgo.request("POST", "v2/webhooks", {
    webhook_subscriptions: [
      { delivery_url: `${SITE}/api/bobgo-webhook`, topic: "fulfillment/created", status: "active" },
    ],
  });
  if (!r.ok) throw new Error(`Bob Go said HTTP ${r.status}: ${JSON.stringify(r.data)}`);
  console.log("Bob Go webhook registered:", JSON.stringify(r.data, null, 2));
  console.log("\nThe signing secret is in Bob Go → Settings (webhook / sales channel section). Put it in Vercel as BOBGO_WEBHOOK_SECRET.");
}

async function listBobgo() {
  const r = await bobgo.request("GET", "v2/webhooks");
  console.log(`HTTP ${r.status}`, JSON.stringify(r.data, null, 2));
}

const cmd = process.argv[2];
const run = { yoco: registerYoco, bobgo: registerBobgo, "list-bobgo": listBobgo }[cmd];
if (!run) {
  console.log("Usage: node scripts/register-webhooks.js yoco | bobgo | list-bobgo");
  process.exit(1);
}
run().catch((e) => { console.error(e.message); process.exit(1); });
