'use strict';
// Demo payment gateway for classroom demos (no real money, no Razorpay account needed).
// It implements the same interface as razorpay.js, and keeps its state in MongoDB so it works across
// Lambda invocations. The backend still confirms payments through fetchPayment(), as with the real gateway.
const crypto = require('crypto');

function createDemoGateway(store) {
  const col = store.col('demoGateway');
  const id = (prefix) => `${prefix}_${crypto.randomBytes(8).toString('hex')}`;

  return {
    keyId: 'demo',
    demo: true,
    async createOrder({ amountPaise, receipt }) {
      const doc = await col.insert({ id: id('demo_order'), kind: 'order', amountPaise, receipt });
      return { id: doc.id };
    },
    async fetchPayment(paymentId) {
      const p = await col.get(paymentId);
      if (!p || p.kind !== 'payment') throw new Error('No such demo payment');
      return { id: p.id, order_id: p.orderId, amount: p.amount, status: p.status };
    },
    async refund(paymentId) {
      await col.update(paymentId, { status: 'refunded' });
    },
    // Pretend the student finished (or failed) paying in a gateway window.
    async simulatePay(orderId, outcome) {
      const order = await col.get(orderId);
      if (!order || order.kind !== 'order') throw new Error('No such demo order');
      const p = await col.insert({
        id: id('demo_pay'),
        kind: 'payment',
        orderId,
        amount: order.amountPaise,
        status: outcome === 'failed' ? 'failed' : 'captured',
      });
      return p.id;
    },
    verifyWebhookSignature: () => false,
  };
}

module.exports = { createDemoGateway };
