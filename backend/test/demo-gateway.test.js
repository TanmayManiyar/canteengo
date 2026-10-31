'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { start } = require('./helpers');
const { createDemoGateway } = require('../src/integrations/demo');

let t, f;
beforeEach(async () => {
  t = await start({}, { makeGateway: createDemoGateway });
  f = await t.seed();
});
afterEach(() => t.close());

const checkout = (token) =>
  t.api('POST', '/api/checkout', {
    token,
    body: { items: [{ itemId: f.samosa.id, quantity: 2, price: 15 }], slotId: f.slot.id, idempotencyKey: crypto.randomUUID() },
  });

test('demo payment: checkout, simulated payment, server-side confirm creates the order', async () => {
  const co = await checkout(f.student);
  assert.equal(co.body.demo, true);
  const pay = await t.api('POST', `/api/payments/${co.body.paymentId}/demo-pay`, { token: f.student, body: { outcome: 'success' } });
  const conf = await t.api('POST', `/api/payments/${co.body.paymentId}/confirm`, {
    token: f.student,
    body: { gatewayPaymentId: pay.body.gatewayPaymentId },
  });
  assert.equal(conf.body.status, 'Success');
  assert.match(conf.body.order.token, /^CG-/);
});

test('demo payment: a failed payment creates no order and frees the slot', async () => {
  const co = await checkout(f.student);
  const pay = await t.api('POST', `/api/payments/${co.body.paymentId}/demo-pay`, { token: f.student, body: { outcome: 'failed' } });
  const conf = await t.api('POST', `/api/payments/${co.body.paymentId}/confirm`, {
    token: f.student,
    body: { gatewayPaymentId: pay.body.gatewayPaymentId },
  });
  assert.equal(conf.body.status, 'Failed');
  assert.equal((await t.store.col('slots').get(f.slot.id)).reserved, 0);
});

test('demo payment: a student cannot pay for someone else\'s checkout; staff cannot use it', async () => {
  const co = await checkout(f.student);
  const other = await t.signUp('stu2', 'stu2@ves.ac.in');
  assert.equal((await t.api('POST', `/api/payments/${co.body.paymentId}/demo-pay`, { token: other })).status, 404);
  assert.equal((await t.api('POST', `/api/payments/${co.body.paymentId}/demo-pay`, { token: f.staff })).status, 403);
});

test('demo payment: paying twice is refused, and cancel refunds through the demo gateway', async () => {
  const co = await checkout(f.student);
  const pay = await t.api('POST', `/api/payments/${co.body.paymentId}/demo-pay`, { token: f.student });
  const conf = await t.api('POST', `/api/payments/${co.body.paymentId}/confirm`, {
    token: f.student,
    body: { gatewayPaymentId: pay.body.gatewayPaymentId },
  });
  assert.equal((await t.api('POST', `/api/payments/${co.body.paymentId}/demo-pay`, { token: f.student })).status, 409);
  const cancel = await t.api('POST', `/api/orders/${conf.body.order.id}/cancel`, { token: f.student });
  assert.equal(cancel.body.status, 'Cancelled');
});
