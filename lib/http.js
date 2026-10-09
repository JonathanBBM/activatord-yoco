// Small helpers shared by the webhook endpoints.

// Read the untouched request body. Signature checks need the exact bytes, so
// never touch req.body before calling this.
async function readRawBody(req) {
  if (typeof req.rawBody === "string") return req.rawBody; // tests
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function lowerHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) out[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
  return out;
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function log(scope, message, extra) {
  // Shows up in Vercel → Project → Logs. Never log keys or full addresses.
  console.log(`[${scope}] ${message}`, extra ? JSON.stringify(extra) : "");
}

export { readRawBody, lowerHeaders, send, log };
