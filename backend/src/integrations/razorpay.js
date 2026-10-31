'use strict';
// Razorpay gateway (REQ-12). Uses the REST API directly; no card/UPI credentials ever reach us (REQ-19).
const crypto = require('crypto');

function createRazorpayGateway({ keyId, keySecret, webhookSecret }) {
  const auth = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  const base = 'https://api.razorpay.com/v1';

  async function call(method, path, body) {
    const res = await fetch(base + path, {
      method,
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Razorpay ${res.status}: ${json.error?.description || 'request failed'}`);
    return json;
  }

  return {
    keyId,
    createOrder: ({ amountPaise, receipt }) =>
      call('POST', '/orders', { amount: amountPaise, currency: 'INR', receipt }),
    // Server-to-server confirmation (REQ-13): never trust client-reported status.
    fetchPayment: (paymentId) => call('GET', `/payments/${encodeURIComponent(paymentId)}`),
    refund: (paymentId, amountPaise) =>
      call('POST', `/payments/${encodeURIComponent(paymentId)}/refunds`, { amount: amountPaise }),
    verifyWebhookSignature(rawBody, signature) {
      if (!webhookSecret || !signature) return false;
      const expected = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
      const a = Buffer.from(expected);
      const b = Buffer.from(String(signature));
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    },
  };
}

module.exports = { createRazorpayGateway };
