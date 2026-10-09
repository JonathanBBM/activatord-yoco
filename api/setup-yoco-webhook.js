// ONE-TIME SETUP PAGE: registers /api/yoco-webhook with Yoco.
//
// It does nothing unless SETUP_TOKEN is set in Vercel. To use it:
//   1. Add SETUP_TOKEN (any long random password) in Vercel, then redeploy.
//   2. Open https://activatord-yoco.vercel.app/api/setup-yoco-webhook?token=YOUR_TOKEN
//   3. Copy the signing secret it shows into Vercel as YOCO_WEBHOOK_SECRET.
//   4. Delete SETUP_TOKEN in Vercel and redeploy. This page is switched off again.
//
// Uses the YOCO_SECRET_KEY already in Vercel, so no key is ever typed into a browser.

import crypto from "crypto";

const YOCO_API = "https://payments.yoco.com/api/webhooks";
const SITE = process.env.WEBHOOK_BASE_URL || "https://activatord-yoco.vercel.app";
const WEBHOOK_URL = `${SITE}/api/yoco-webhook`;

function page(res, status, title, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<body style="font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;line-height:1.5">
<h1 style="font-size:22px">${title}</h1>${body}</body>`);
}

function tokenOk(given) {
  const expected = process.env.SETUP_TOKEN;
  if (!expected || !given) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function yoco(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${process.env.YOCO_SECRET_KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export default async function handler(req, res) {
  // Switched off unless SETUP_TOKEN exists and matches. Looks like a 404 to anyone guessing.
  const url = new URL(req.url, "https://x");
  if (!tokenOk(url.searchParams.get("token"))) {
    res.statusCode = 404;
    return res.end("Not found");
  }
  if (!process.env.YOCO_SECRET_KEY) {
    return page(res, 500, "Missing Yoco key", "<p>YOCO_SECRET_KEY isn't set in Vercel.</p>");
  }

  try {
    // Yoco only shows a webhook's secret when it's created, so if ours already
    // exists, replace it (only when asked) to get a fresh secret.
    const list = await yoco("GET", YOCO_API);
    const existing = ((list.data && (list.data.subscriptions || list.data.webhooks || list.data.data)) || [])
      .filter((w) => w && w.url === WEBHOOK_URL);

    if (existing.length && url.searchParams.get("replace") !== "1") {
      return page(res, 200, "Already registered",
        `<p>Yoco already sends payments to <code>${WEBHOOK_URL}</code>.</p>
         <p>If <b>YOCO_WEBHOOK_SECRET</b> is already in Vercel, you're done: delete SETUP_TOKEN and redeploy.</p>
         <p>If you don't have the secret, add <code>&amp;replace=1</code> to the end of this page's address and open it again.
         That replaces the webhook and shows a new secret.</p>`);
    }
    for (const w of existing) await yoco("DELETE", `${YOCO_API}/${encodeURIComponent(w.id)}`);

    const created = await yoco("POST", YOCO_API, { name: "activatord-bobgo", url: WEBHOOK_URL });
    if (!created.ok || !created.data.secret) {
      return page(res, 502, "Yoco said no",
        `<p>Yoco returned HTTP ${created.status}.</p><pre style="white-space:pre-wrap">${
          JSON.stringify(created.data, null, 2).replace(/</g, "&lt;")}</pre>`);
    }

    console.log(`[setup] Yoco webhook registered (${created.data.mode || "unknown"} mode)`);
    return page(res, 200, "Done: copy this secret now",
      `<p>Yoco will now send payments to <code>${WEBHOOK_URL}</code> (${created.data.mode || ""} mode).</p>
       <p>In Vercel, add an environment variable:</p>
       <p>Key: <b>YOCO_WEBHOOK_SECRET</b><br>Value:</p>
       <pre style="background:#f3f3f3;padding:12px;border-radius:6px;word-break:break-all;white-space:pre-wrap">${created.data.secret}</pre>
       <p><b>This is shown only once.</b> If you lose it, open this page again with <code>&amp;replace=1</code> on the end.</p>
       <p>Then delete <b>SETUP_TOKEN</b> in Vercel and redeploy.</p>`);
  } catch (err) {
    console.log(`[setup] failed: ${err.message}`);
    return page(res, 500, "Something went wrong", "<p>Check Vercel → Logs for the line starting with [setup].</p>");
  }
}
