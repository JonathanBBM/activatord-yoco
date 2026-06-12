export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { amountInCents, currency, cancelUrl } = req.body;

    if (!amountInCents || !currency) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    const secretKey = process.env.YOCO_SECRET_KEY;

    if (!secretKey) {
        return res.status(500).json({ error: 'Server misconfiguration: missing secret key' });
    }

    const successUrl = 'https://activatord-yoco.vercel.app/success.html';

    try {
        const yocoRes = await fetch('https://payments.yoco.com/api/checkouts', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${secretKey}`
            },
            body: JSON.stringify({
                amount: amountInCents,
                currency: currency,
                successUrl: successUrl,
                cancelUrl: cancelUrl || successUrl,
                failureUrl: cancelUrl || successUrl
            })
        });

        const data = await yocoRes.json();

        if (!yocoRes.ok) {
            console.error('Yoco API error:', data);
            return res.status(yocoRes.status).json({ error: data.message || 'Yoco API error' });
        }

        return res.status(200).json({
            checkoutId: data.id,
            redirectUrl: data.redirectUrl
        });

    } catch (err) {
        console.error('Server error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
