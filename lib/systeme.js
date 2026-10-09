// Systeme.io public API — only used when SHIPPED_NOTIFY=systeme.
//
// Flow: find the buyer's contact by email → save tracking number + link into
// two custom contact fields → add the "order-shipped" tag. A Systeme.io
// automation rule ("Tag added: order-shipped" → send email) does the rest.
//
// Note: the API key must belong to the Systeme.io account that owns the
// ActivatorD contacts.

const BASE = "https://api.systeme.io/api";

async function call(method, path, body, contentType = "application/json") {
  const key = process.env.SYSTEME_API_KEY;
  if (!key) throw new Error("SYSTEME_API_KEY not set");
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "X-API-Key": key, Accept: "application/json", "Content-Type": contentType },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

async function findContactByEmail(email) {
  const r = await call("GET", `/contacts?email=${encodeURIComponent(email)}`);
  if (!r.ok) throw new Error(`Systeme contact lookup failed (HTTP ${r.status})`);
  const items = (r.data && r.data.items) || [];
  return items.find((c) => String(c.email).toLowerCase() === email.toLowerCase()) || null;
}

async function findOrCreateTag(name) {
  let after = "";
  for (let page = 0; page < 20; page++) {
    const r = await call("GET", `/tags?limit=100${after ? `&startingAfter=${after}` : ""}`);
    if (!r.ok) throw new Error(`Systeme tag list failed (HTTP ${r.status})`);
    const items = (r.data && r.data.items) || [];
    const hit = items.find((t) => t.name === name);
    if (hit) return hit.id;
    if (!r.data.hasMore || !items.length) break;
    after = items[items.length - 1].id;
  }
  const created = await call("POST", "/tags", { name });
  if (!created.ok) throw new Error(`Systeme tag create failed (HTTP ${created.status})`);
  return created.data.id;
}

async function markShipped(email, { trackingNumber, trackingUrl }) {
  const contact = await findContactByEmail(email);
  if (!contact) return { done: false, reason: "No Systeme contact for this email" };

  // Fields first, so the email the tag triggers already has the values.
  const fields = [];
  if (trackingNumber) fields.push({ slug: process.env.SYSTEME_FIELD_TRACKING_NUMBER || "tracking_number", value: trackingNumber });
  if (trackingUrl) fields.push({ slug: process.env.SYSTEME_FIELD_TRACKING_URL || "tracking_url", value: trackingUrl });
  if (fields.length) {
    const r = await call("PATCH", `/contacts/${contact.id}`, { fields }, "application/merge-patch+json");
    if (!r.ok) console.log(`[systeme] Could not save tracking fields (HTTP ${r.status}) — check the custom field slugs exist`);
  }

  const tagId = await findOrCreateTag(process.env.SYSTEME_SHIPPED_TAG || "order-shipped");
  const t = await call("POST", `/contacts/${contact.id}/tags`, { tagId });
  // A contact that already has the tag is fine — the email went out the first time.
  if (!t.ok && t.status !== 422) throw new Error(`Systeme tag assign failed (HTTP ${t.status})`);
  return { done: true };
}

export { markShipped };
