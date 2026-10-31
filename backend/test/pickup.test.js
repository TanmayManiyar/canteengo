'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { start } = require('./helpers');

const MIN = 60_000;
let t, f;

async function boot(env = {}) {
  t = await start({ DEFAULT_SLOT_CAPACITY: '2', KITCHEN_CAPACITY: '4', ...env });
  f = await t.seed();
}
afterEach(() => t && t.close());

// Checks out with the given pickup choice and completes the (fake) payment.
async function order(token, pickup, qty = 1) {
  const co = await t.api('POST', '/api/checkout', {
    token,
    body: { items: [{ itemId: f.samosa.id, quantity: qty, price: 15 }], pickup, idempotencyKey: crypto.randomUUID() },
  });
  if (co.status !== 201) return { co };
  const payId = t.gateway.pay(co.body.gatewayOrderId);
  const conf = await t.api('POST', `/api/payments/${co.body.paymentId}/confirm`, { token, body: { gatewayPaymentId: payId } });
  return { co, conf };
}

beforeEach(() => boot());

test('"right now" orders need no slot and can be cancelled', async () => {
  const { conf } = await order(f.student, { type: 'asap' });
  assert.equal(conf.body.status, 'Success');
  assert.equal(conf.body.order.slotLabel, 'Right now (ASAP)');
  assert.equal(conf.body.order.slotId, null);
  const cancel = await t.api('POST', `/api/orders/${conf.body.order.id}/cancel`, { token: f.student });
  assert.equal(cancel.body.status, 'Cancelled');
});

test('a custom time creates its 15-minute window and enforces capacity', async () => {
  const at = t.clock.t + 40 * MIN;
  const a = await order(f.student, { type: 'custom', at });
  assert.equal(a.conf.body.status, 'Success');
  assert.match(a.conf.body.order.slotLabel, /–/);
  const other = await t.signUp('stu2', 'stu2@ves.ac.in');
  const third = await t.signUp('stu3', 'stu3@ves.ac.in');
  assert.equal((await order(other, { type: 'custom', at: at + 2 * MIN })).conf.body.status, 'Success'); // same window
  const full = await order(third, { type: 'custom', at: at + 5 * MIN });
  assert.equal(full.co.status, 409); // capacity is 2
  assert.match(full.co.body.error, /full/i);
});

test('custom times must be soon enough, not too far away, and within opening hours', async () => {
  const tooSoon = await order(f.student, { type: 'custom', at: t.clock.t + 3 * MIN });
  assert.equal(tooSoon.co.status, 409);
  const tooFar = await order(f.student, { type: 'custom', at: t.clock.t + 3 * 24 * 60 * MIN });
  assert.equal(tooFar.co.status, 409);
  assert.equal((await order(f.student, { type: 'custom', at: 'soon' })).co.status, 400);
  assert.equal((await order(f.student, { type: 'nonsense' })).co.status, 400);
});

test('opening hours block "right now" and custom times outside them', async () => {
  await t.close();
  await boot({ OPEN_HOUR: '8', CLOSE_HOUR: '18' }); // the fake clock is about 3:40 AM in India
  assert.equal((await order(f.student, { type: "asap" })).co.status, 409);
  assert.equal((await order(f.student, { type: 'custom', at: t.clock.t + 40 * MIN })).co.status, 409);
  const opts = await t.api('GET', '/api/pickup/options', { token: f.student });
  assert.equal(opts.body.now.available, false);
});

test('rush right now follows active orders and the people ordering', async () => {
  const idle = await t.api('GET', '/api/pickup/options', { token: f.student });
  assert.equal(idle.body.now.level, 'low');
  assert.equal(idle.body.now.activeOrders, 0);

  const s2 = await t.signUp('stu2', 'stu2@ves.ac.in');
  await order(f.student, { type: 'asap' });
  await order(s2, { type: 'asap' });
  await order(s2, { type: 'asap' }); // 3 active orders, kitchen capacity 4 -> 75%
  const busy = (await t.api('GET', '/api/pickup/options', { token: f.student })).body.now;
  assert.equal(busy.activeOrders, 3);
  assert.equal(busy.activeUsers, 2);
  assert.equal(busy.level, 'moderate');
  assert.equal(busy.waitMinutes, 5 + 3 * 2);

  await order(f.student, { type: 'asap' });
  await order(f.student, { type: 'asap' }); // 5 active -> 125%
  assert.equal((await t.api('GET', '/api/pickup/options', { token: f.student })).body.now.level, 'very-busy');
});

test('finished orders stop counting as rush', async () => {
  const { conf } = await order(f.student, { type: 'asap' });
  for (const s of ['Accepted', 'Preparing', 'Ready', 'Collected']) {
    await t.api('PATCH', `/api/orders/${conf.body.order.id}/status`, { token: f.staff, body: { status: s } });
  }
  assert.equal((await t.api('GET', '/api/pickup/options', { token: f.student })).body.now.activeOrders, 0);
});

test('time windows report how booked they are, and a custom time can be looked up', async () => {
  const at = t.clock.t + 40 * MIN;
  await order(f.student, { type: 'custom', at });
  const r = await t.api('GET', `/api/pickup/rush?at=${at}`, { token: f.student });
  assert.equal(r.body.percent, 50);
  assert.equal(r.body.level, 'moderate');
  assert.equal(r.body.remaining, 1);
  assert.equal(r.body.full, false);
  const other = await t.signUp('stu2', 'stu2@ves.ac.in');
  await order(other, { type: 'custom', at });
  const full = await t.api('GET', `/api/pickup/rush?at=${at}`, { token: f.student });
  assert.equal(full.body.full, true);

  const opts = (await t.api('GET', '/api/pickup/options', { token: f.student })).body;
  const win = opts.windows.find((w) => w.startsAt <= at && at < w.startsAt + 15 * MIN);
  assert.equal(win.full, true);
  assert.ok(opts.windows.length >= 8);
  assert.equal((await t.api('GET', '/api/pickup/rush?at=abc', { token: f.student })).status, 400);
});
