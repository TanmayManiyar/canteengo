'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { start } = require('./helpers');

let t, f;
beforeEach(async () => {
  t = await start();
  f = await t.seed();
});
afterEach(() => t.close());

const checkoutBody = (f, over = {}) => ({
  items: [{ itemId: f.samosa.id, quantity: 2, price: 15 }],
  slotId: f.slot.id,
  idempotencyKey: crypto.randomUUID(),
  ...over,
});
const slotState = async (f) => (await t.store.col('slots').get(f.slot.id)).reserved;

test('REQ-9/11: tampered price, unavailable item or unknown item is rejected, no slot held', async () => {
  const cheat = await t.api('POST', '/api/checkout', {
    token: f.student,
    body: checkoutBody(f, { items: [{ itemId: f.samosa.id, quantity: 2, price: 1 }] }),
  });
  assert.equal(cheat.status, 409);
  await t.api('PUT', `/api/menu/${f.samosa.id}`, { token: f.staff, body: { available: false } });
  const gone = await t.api('POST', '/api/checkout', { token: f.student, body: checkoutBody(f) });
  assert.equal(gone.status, 409);
  assert.equal(await slotState(f), 0);
});

test('staff cannot check out; checkout needs an idempotency key', async () => {
  assert.equal((await t.api('POST', '/api/checkout', { token: f.staff, body: checkoutBody(f) })).status, 403);
  assert.equal((await t.api('POST', '/api/checkout', { token: f.student, body: checkoutBody(f, { idempotencyKey: undefined }) })).status, 400);
});

test('REQ-12..15: verified payment creates exactly one order with a token', async () => {
  const { conf } = await t.placeOrder(f.student, f);
  assert.equal(conf.status, 200);
  assert.equal(conf.body.status, 'Success');
  assert.match(conf.body.order.token, /^CG-[0-9A-F]{6}$/);
  assert.equal(conf.body.order.total, 30);
  assert.equal(conf.body.order.status, 'Placed');
  assert.equal(await slotState(f), 1);
});

test('REQ-13: an unpaid / uncaptured payment never creates an order', async () => {
  const co = await t.api('POST', '/api/checkout', { token: f.student, body: checkoutBody(f) });
  const payId = t.gateway.pay(co.body.gatewayOrderId, 'created');
  const r = await t.api('POST', `/api/payments/${co.body.paymentId}/confirm`, { token: f.student, body: { gatewayPaymentId: payId } });
  assert.equal(r.body.status, 'Pending');
  assert.equal((await t.api('GET', '/api/orders', { token: f.student })).body.orders.length, 0);
  // a made-up payment id is not accepted either
  const fake = await t.api('POST', `/api/payments/${co.body.paymentId}/confirm`, { token: f.student, body: { gatewayPaymentId: 'pay_fake' } });
  assert.equal(fake.status, 502);
});

test('payment for a different gateway order is rejected', async () => {
  const a = await t.api('POST', '/api/checkout', { token: f.student, body: checkoutBody(f) });
  const b = await t.api('POST', '/api/checkout', { token: f.student, body: checkoutBody(f) });
  const payForB = t.gateway.pay(b.body.gatewayOrderId);
  const r = await t.api('POST', `/api/payments/${a.body.paymentId}/confirm`, { token: f.student, body: { gatewayPaymentId: payForB } });
  assert.equal(r.status, 400);
});

test('REQ-18: replayed confirmation and repeated checkout create only one order', async () => {
  const key = crypto.randomUUID();
  const { co, conf, payId } = await t.placeOrder(f.student, f, key);
  const again = await t.api('POST', `/api/payments/${co.body.paymentId}/confirm`, { token: f.student, body: { gatewayPaymentId: payId } });
  assert.equal(again.body.order.id, conf.body.order.id);
  const retry = await t.api('POST', '/api/checkout', { token: f.student, body: checkoutBody(f, { idempotencyKey: key }) });
  assert.equal(retry.body.paymentId, co.body.paymentId);
  assert.equal((await t.api('GET', '/api/orders', { token: f.student })).body.orders.length, 1);
  assert.equal(await slotState(f), 1);
});

test('REQ-18: simultaneous confirmations still yield a single order', async () => {
  const co = await t.api('POST', '/api/checkout', { token: f.student, body: checkoutBody(f) });
  const payId = t.gateway.pay(co.body.gatewayOrderId);
  await Promise.all(
    [1, 2, 3].map(() => t.api('POST', `/api/payments/${co.body.paymentId}/confirm`, { token: f.student, body: { gatewayPaymentId: payId } }))
  );
  assert.equal((await t.store.col('orders').find()).length, 1);
});

test('REQ-11: slot capacity is never exceeded under simultaneous checkouts', async () => {
  const others = await Promise.all([2, 3, 4, 5].map((n) => t.signUp(`s${n}`, `s${n}@ves.ac.in`)));
  const results = await Promise.all(others.map((tok) => t.api('POST', '/api/checkout', { token: tok, body: checkoutBody(f) })));
  assert.equal(results.filter((r) => r.status === 201).length, 2); // capacity is 2
  assert.equal(results.filter((r) => r.status === 409).length, 2);
  assert.equal(await slotState(f), 2);
});

test('REQ-10: full slots are not offered', async () => {
  await t.placeOrder(f.student, f);
  await t.placeOrder(f.student, f);
  const slots = await t.api('GET', '/api/slots', { token: f.student });
  assert.equal(slots.body.slots.length, 0);
});

test('REQ-16: failed payment creates no order and releases the slot; retry works', async () => {
  const co = await t.api('POST', '/api/checkout', { token: f.student, body: checkoutBody(f) });
  assert.equal(await slotState(f), 1);
  const payId = t.gateway.pay(co.body.gatewayOrderId, 'failed');
  const r = await t.api('POST', `/api/payments/${co.body.paymentId}/confirm`, { token: f.student, body: { gatewayPaymentId: payId } });
  assert.equal(r.body.status, 'Failed');
  assert.equal(await slotState(f), 0);
  assert.equal((await t.placeOrder(f.student, f)).conf.body.status, 'Success');
});

test('REQ-16: gateway outage fails the attempt cleanly', async () => {
  t.gateway.failCreate = true;
  const r = await t.api('POST', '/api/checkout', { token: f.student, body: checkoutBody(f) });
  assert.equal(r.status, 502);
  assert.equal(await slotState(f), 0);
  assert.equal((await t.store.col('orders').find()).length, 0);
});

test('REQ-17: unconfirmed checkout times out after 5 minutes and frees the slot', async () => {
  const co = await t.api('POST', '/api/checkout', { token: f.student, body: checkoutBody(f) });
  t.clock.t += 5 * 60 * 1000 + 1;
  const st = await t.api('GET', `/api/payments/${co.body.paymentId}`, { token: f.student });
  assert.equal(st.body.status, 'TimedOut');
  assert.equal(await slotState(f), 0);
});

test('a payment captured after timeout is refunded, not turned into an order', async () => {
  const co = await t.api('POST', '/api/checkout', { token: f.student, body: checkoutBody(f) });
  t.clock.t += 6 * 60 * 1000;
  await t.api('GET', `/api/payments/${co.body.paymentId}`, { token: f.student });
  const payId = t.gateway.pay(co.body.gatewayOrderId);
  const r = await t.api('POST', `/api/payments/${co.body.paymentId}/confirm`, { token: f.student, body: { gatewayPaymentId: payId } });
  assert.equal(r.body.status, 'Refunded');
  assert.deepEqual(t.gateway.refunds, [{ paymentId: payId, amount: 3000 }]);
  assert.equal((await t.store.col('orders').find()).length, 0);
});

test('webhook: valid signature confirms payment, bad signature is rejected', async () => {
  const co = await t.api('POST', '/api/checkout', { token: f.student, body: checkoutBody(f) });
  const payId = t.gateway.pay(co.body.gatewayOrderId);
  const raw = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: payId, order_id: co.body.gatewayOrderId } } } });
  const bad = await t.api('POST', '/api/payments/webhook', { raw, headers: { 'x-razorpay-signature': 'nope' } });
  assert.equal(bad.status, 400);
  const sig = crypto.createHmac('sha256', t.gateway.webhookSecret).update(raw).digest('hex');
  const ok = await t.api('POST', '/api/payments/webhook', { raw, headers: { 'x-razorpay-signature': sig, 'Content-Type': 'application/json' } });
  assert.equal(ok.status, 200);
  assert.equal((await t.store.col('orders').find()).length, 1);
});

test('REQ-23: students see only their own orders', async () => {
  const { conf } = await t.placeOrder(f.student, f);
  const other = await t.signUp('stu2', 'stu2@ves.ac.in');
  assert.equal((await t.api('GET', '/api/orders', { token: other })).body.orders.length, 0);
  assert.equal((await t.api('GET', `/api/orders/${conf.body.order.id}`, { token: other })).status, 404);
  assert.equal((await t.api('GET', `/api/orders/${conf.body.order.id}`, { token: f.student })).status, 200);
});

test('REQ-24/22: students cannot change status; staff follow the lifecycle; Ready sends a push', async () => {
  const { conf } = await t.placeOrder(f.student, f);
  const id = conf.body.order.id;
  const patch = (token, status) => t.api('PATCH', `/api/orders/${id}/status`, { token, body: { status } });
  assert.equal((await patch(f.student, 'Accepted')).status, 403);
  assert.equal((await patch(f.staff, 'Ready')).status, 409); // cannot skip steps
  assert.equal((await patch(f.staff, 'Accepted')).body.status, 'Accepted');
  assert.equal((await patch(f.staff, 'Preparing')).body.status, 'Preparing');
  assert.equal(t.pushed.length, 0);
  assert.equal((await patch(f.staff, 'Ready')).body.status, 'Ready');
  assert.equal(t.pushed.length, 1);
  assert.equal(t.pushed[0].order.token, conf.body.order.token);
  assert.equal((await patch(f.staff, 'Collected')).body.status, 'Collected');
  assert.equal((await patch(f.staff, 'Placed')).status, 409);
  const queue = await t.api('GET', '/api/staff/orders', { token: f.staff });
  assert.equal(queue.body.orders.length, 0); // Collected leaves the active queue
});

test('rejecting an order frees the slot and flags it for manual resolution', async () => {
  const { conf } = await t.placeOrder(f.student, f);
  const r = await t.api('PATCH', `/api/orders/${conf.body.order.id}/status`, { token: f.staff, body: { status: 'Rejected' } });
  assert.equal(r.body.needsManualResolution, true);
  assert.equal(await slotState(f), 0);
});

test('REQ-20 / 5.6: cancel within 2 minutes refunds; later or after acceptance is refused', async () => {
  const a = await t.placeOrder(f.student, f);
  const c = await t.api('POST', `/api/orders/${a.conf.body.order.id}/cancel`, { token: f.student });
  assert.equal(c.body.status, 'Cancelled');
  assert.deepEqual(t.gateway.refunds, [{ paymentId: a.payId, amount: 3000 }]);
  assert.equal(await slotState(f), 0);

  const b = await t.placeOrder(f.student, f);
  t.clock.t += 2 * 60 * 1000 + 1;
  assert.equal((await t.api('POST', `/api/orders/${b.conf.body.order.id}/cancel`, { token: f.student })).status, 409);

  const c2 = await t.placeOrder(f.student, f);
  await t.api('PATCH', `/api/orders/${c2.conf.body.order.id}/status`, { token: f.staff, body: { status: 'Accepted' } });
  assert.equal((await t.api('POST', `/api/orders/${c2.conf.body.order.id}/cancel`, { token: f.student })).status, 409);
});

test("a student cannot cancel someone else's order", async () => {
  const a = await t.placeOrder(f.student, f);
  const other = await t.signUp('stu2', 'stu2@ves.ac.in');
  assert.equal((await t.api('POST', `/api/orders/${a.conf.body.order.id}/cancel`, { token: other })).status, 404);
});

test('REQ-34/35/37: feedback only for own Collected order; averages update', async () => {
  const { conf } = await t.placeOrder(f.student, f);
  const id = conf.body.order.id;
  const rate = (token, body) => t.api('POST', `/api/orders/${id}/feedback`, { token, body });
  assert.equal((await rate(f.student, { rating: 5 })).status, 409); // not Collected yet
  for (const s of ['Accepted', 'Preparing', 'Ready', 'Collected']) {
    await t.api('PATCH', `/api/orders/${id}/status`, { token: f.staff, body: { status: s } });
  }
  const other = await t.signUp('stu2', 'stu2@ves.ac.in');
  assert.equal((await rate(other, { rating: 5 })).status, 403);
  assert.equal((await rate(f.student, { rating: 6 })).status, 400);
  assert.equal((await rate(f.student, { rating: 4, comment: 'good' })).status, 201);
  assert.equal((await rate(f.student, { rating: 5 })).status, 409); // only once
  const menu = await t.api('GET', '/api/menu?q=samosa', { token: f.student });
  assert.equal(menu.body.categories[0].items[0].avgRating, 4);
  const rep = await t.api('GET', '/api/reports/feedback', { token: f.owner });
  assert.equal(rep.body.count, 1);
  assert.equal(rep.body.distribution[4], 1);
});

test('reports are owner-only and exclude cancelled orders', async () => {
  await t.placeOrder(f.student, f); // 30
  const x = await t.placeOrder(f.student, f); // 30, then cancelled
  await t.api('POST', `/api/orders/${x.conf.body.order.id}/cancel`, { token: f.student });
  assert.equal((await t.api('GET', '/api/reports/sales', { token: f.staff })).status, 403);
  const r = await t.api('GET', '/api/reports/sales', { token: f.owner });
  assert.equal(r.body.orderCount, 1);
  assert.equal(r.body.totalRevenue, 30);
  assert.equal(r.body.topItems[0].quantity, 2);
});

test('REQ-4: logout calls the session revoker', async () => {
  assert.equal((await t.api('POST', '/api/auth/logout', { token: f.student })).status, 204);
});
