# Bob Go integration — setup

## What it does

1. Buyer fills in the Scalr order form → the footer script reads the delivery
   address and sends it with the checkout request.
2. `api/create-checkout.js` stores the address in the Yoco checkout's metadata.
3. Buyer pays. Yoco calls `api/yoco-webhook.js`, which checks Yoco's signature
   and creates a **paid** order in Bob Go. Abandoned checkouts never reach Bob Go.
4. Andre picks a courier and prints the waybill in Bob Go.
5. Bob Go calls `api/bobgo-webhook.js` (topic `fulfillment/created`), and the
   buyer gets a "your order is on its way" message — see the toggle below.

Checkouts sent without delivery details behave exactly as before.

## What changed in this repo

| File | Change |
|---|---|
| `api/create-checkout.js` | Accepts an optional `order` and adds it to the Yoco checkout as metadata. |
| `SCALR-FOOTER-SCRIPT.html` | Reads and validates phone and address, sends `order`. Set `PRODUCT_CODE` at the top. |
| `package.json` | `"type": "module"` (the code already used `export default`) and `npm test`. |
| `api/yoco-webhook.js` | New. Paid → Bob Go order. Skips duplicates when Yoco retries. |
| `api/bobgo-webhook.js` | New. Fulfilled → shipped notification (toggle). |
| `lib/` | New helpers. **Fill in `lib/catalog.js`** with real weights and box sizes. Prices come from the page. |
| `snippets/upsell-order.js` | Two small additions for the upsell page's own script. |
| `scripts/register-webhooks.js` | One-off webhook registration with Yoco and Bob Go. |
| `test/run-tests.js` | `npm test` — 19 offline tests. |
| `.env.example` | Every environment variable, with notes. |

## Setup, in order

1. Andre rotates his Bob Go API key (the current one was emailed) and confirms
   with Bob Go support that API access is on and where his webhook secret is.
2. Fill in `lib/catalog.js` and set `PRODUCT_CODE` in the footer script.
3. Vercel → activatord-yoco → Environment Variables: add `BOBGO_API_KEY`,
   `BOBGO_ENV=production`, `SHIPPED_NOTIFY=bobgo`. Merge this branch and deploy.
4. Register the webhooks from the repo folder:
   - `YOCO_SECRET_KEY=... node scripts/register-webhooks.js yoco` → copy the printed
     secret into Vercel as `YOCO_WEBHOOK_SECRET`.
   - `BOBGO_API_KEY=... node scripts/register-webhooks.js bobgo` → put Andre's
     Bob Go webhook secret into Vercel as `BOBGO_WEBHOOK_SECRET`.
   - Redeploy so the new variables load.
5. Paste the updated `SCALR-FOOTER-SCRIPT.html` into the checkout page footer in
   Scalr. On that page, run `ActivatorDShipping.listInputs()` in the browser
   console and check the address field names match `SHIP_FIELDS`.
6. Apply `snippets/upsell-order.js` to the upsell page's script.
7. Test with one real, low-value order: it should appear in Bob Go with the right
   address and parcel. Fulfil it, check the buyer gets the shipped message, then
   refund the payment in Yoco.

## "Order shipped" toggle — `SHIPPED_NOTIFY`

| Value | Who tells the buyer | Needs |
|---|---|---|
| `bobgo` (default) | Bob Go's own tracking email / WhatsApp | Notifications on in Bob Go. Branded emails are a paid Bob Go extra. |
| `systeme` | Your own Systeme.io email | `SYSTEME_API_KEY` for the account that owns the contacts, custom contact fields `tracking_number` and `tracking_url`, and a rule: *Tag added: order-shipped → Send email*. |
| `off` | Nobody | — |

`BOBGO_ENABLED=false` pauses sending orders to Bob Go without a code change.

## Notes

- **Price trust (existing behaviour):** the footer reads the price off the page
  and sends it, so a buyer could edit it in their browser. Once `lib/catalog.js`
  has real prices, the server can compute the amount instead.
- **Not verified against live systems yet:** Bob Go only gives API docs through
  sales, so field names come from Bob Go's own WooCommerce plugin. Yoco must echo
  checkout metadata on its payment webhook. The test order in step 7 confirms both.
- Errors appear in Vercel → Logs, prefixed `[yoco]` or `[bobgo]`.
