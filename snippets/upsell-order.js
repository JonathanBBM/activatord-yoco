// UPSELL PAGE (upsell-6-pack) — the script for this page isn't in the repo,
// so add these two pieces to it by hand.
//
// 1) Paste this function inside the upsell footer script:

function buildUpsellOrder(productCode, qty) {
    // Reuses the delivery details the buyer typed on the checkout page.
    var saved = null;
    try { saved = JSON.parse(sessionStorage.getItem('actd_ship_v1') || 'null'); } catch (e) {}
    if (!saved) return undefined; // no details → checkout still works, Andre adds the address by hand
    return {
        orderRef: saved.orderRef + '-U' + Date.now().toString(36).slice(-3).toUpperCase(),
        parentRef: saved.orderRef,
        product: productCode,
        qty: qty || 1,
        shipping: saved.shipping
    };
}

// 2) In the fetch() to /api/create-checkout on the upsell page, add `order`:
//
//    body: JSON.stringify({
//        amountInCents: ...,
//        currency: 'ZAR',
//        cancelUrl: ...,
//        order: buildUpsellOrder('4-pack', 1)   // or '10-pack'   // <-- product code from lib/catalog.js
//    })
//
// Bob Go receives the upsell as its own order, tagged "Ship with ACT-…" and
// noted "ship together with order …", so Andre can pack both in one box.
