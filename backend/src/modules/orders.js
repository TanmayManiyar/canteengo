'use strict';
const crypto = require('crypto');
const express = require('express');
const { Router } = express;
const { HttpError } = require('../lib/errors');
const { requireUser, requireRole, STAFF } = require('../middleware/auth');
const { validateOrder } = require('../lib/orderValidator');
const { audit } = require('../lib/audit');

// REQ-21 / REQ-24: allowed order lifecycle transitions made by staff.
const STAFF_TRANSITIONS = {
  Placed: ['Accepted', 'Rejected'],
  Accepted: ['Preparing'],
  Preparing: ['Ready'],
  Ready: ['Collected'],
};

const paise = (rupees) => Math.round(rupees * 100);

module.exports = function orderRoutes({ store, gateway, notifier, config, now }) {
  const r = Router();
  const users = store.col('users');
  const menu = store.col('menu');
  const slots = store.col('slots');
  const payments = store.col('payments');
  const orders = store.col('orders');

  // ---------- helpers ----------
  async function newToken() {
    for (;;) {
      const token = 'CG-' + crypto.randomBytes(3).toString('hex').toUpperCase();
      if (!(await orders.findOne({ token }))) return token;
    }
  }

  const presentOrder = (o) => ({
    id: o.id,
    token: o.token,
    status: o.status,
    items: o.items,
    total: o.total,
    slotId: o.slotId,
    slotLabel: o.slotLabel,
    createdAt: o.createdAt,
    needsManualResolution: !!o.needsManualResolution,
  });

  const session = (p) => ({
    paymentId: p.id,
    gatewayOrderId: p.gatewayOrderId,
    keyId: gateway.keyId,
    demo: !!gateway.demo,
    amount: p.amount,
    expiresAt: p.expiresAt,
    status: p.status,
  });

  // Mark a Pending payment as ended (Failed / TimedOut) and release its slot, exactly once.
  async function endPending(payment, status) {
    const updated = await payments.update(payment.id, { status }, { status: 'Pending' });
    if (updated && payment.slotId) await store.releaseSlot(payment.slotId);
    return updated;
  }

  // REQ-17: attempts with no confirmation after 5 minutes time out and free their slot.
  async function expirePending() {
    const pending = await payments.find({ status: 'Pending' });
    let expired = 0;
    for (const p of pending) {
      if (p.expiresAt <= now() && (await endPending(p, 'TimedOut'))) expired++;
    }
    return expired;
  }

  async function orderForPayment(payment) {
    return payment.orderId ? orders.get(payment.orderId) : orders.findOne({ paymentId: payment.id });
  }

  // REQ-13 / REQ-14: only a gateway-confirmed capture creates an order.
  async function confirmPayment(payment, gatewayPaymentId) {
    if (payment.status === 'Success') return { status: 'Success', order: await orderForPayment(payment) };

    let gp;
    try {
      gp = await gateway.fetchPayment(gatewayPaymentId);
    } catch (err) {
      console.error('gateway fetchPayment failed', err);
      throw new HttpError(502, 'Could not verify the payment with the gateway');
    }
    if (gp.order_id !== payment.gatewayOrderId || gp.amount !== paise(payment.amount)) {
      throw new HttpError(400, 'Payment does not match this checkout attempt');
    }
    if (gp.status === 'failed') {
      await endPending(payment, 'Failed'); // REQ-16
      return { status: 'Failed' };
    }
    if (gp.status !== 'captured') return { status: 'Pending' };

    const won = await payments.update(payment.id, { status: 'Success', gatewayPaymentId }, { status: 'Pending' });
    if (!won) {
      const cur = await payments.get(payment.id);
      if (cur.status === 'Success') return { status: 'Success', order: await orderForPayment(cur) }; // REQ-18
      // Money was captured after the attempt already timed out / failed: give it back.
      await gateway.refund(gatewayPaymentId, gp.amount);
      await payments.update(payment.id, { status: 'Refunded', gatewayPaymentId });
      return { status: 'Refunded' };
    }

    const order = await orders.insert({
      userId: payment.userId,
      items: payment.items,
      total: payment.amount,
      slotId: payment.slotId,
      slotLabel: payment.slotLabel,
      paymentId: payment.id,
      token: await newToken(),
      status: 'Placed',
      createdAt: now(),
    });
    await payments.update(payment.id, { orderId: order.id });
    return { status: 'Success', order };
  }

  // ---------- slots (REQ-10) ----------
  r.get('/slots', requireUser, async (req, res) => {
    const all = await slots.find();
    res.json({
      slots: all
        .filter((s) => s.reserved < s.capacity && (!s.startsAt || s.startsAt > now()))
        .sort((a, b) => (a.startsAt || 0) - (b.startsAt || 0))
        .map((s) => ({ id: s.id, label: s.label, startsAt: s.startsAt, remaining: s.capacity - s.reserved })),
    });
  });

  r.post('/slots', requireRole(...STAFF), async (req, res) => {
    const { label, capacity, startsAt } = req.body || {};
    if (typeof label !== 'string' || !label.trim()) throw new HttpError(400, 'label is required');
    if (!Number.isInteger(capacity) || capacity <= 0) throw new HttpError(400, 'capacity must be a positive integer');
    if (startsAt !== undefined && !Number.isFinite(startsAt)) throw new HttpError(400, 'startsAt must be epoch ms');
    const slot = await slots.insert({ label: label.trim(), capacity, startsAt, reserved: 0 });
    await audit(store, req.user, 'slot.create', slot.id, now);
    res.status(201).json(slot);
  });

  // ---------- pickup times: "right now", fixed slots, or any custom time ----------
  const WINDOW_MS = 15 * 60 * 1000;
  const fmtTime = (ms) =>
    new Date(ms).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: config.timezone });
  const windowLabel = (start) => `${fmtTime(start)} – ${fmtTime(start + WINDOW_MS)}`;
  const hourOf = (ms) =>
    Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: config.timezone }).format(ms));
  const isOpenAt = (ms) => hourOf(ms) >= config.openHour && hourOf(ms) < config.closeHour;
  const windowStart = (ms) => Math.floor(ms / WINDOW_MS) * WINDOW_MS;

  // Rush level from a load ratio (1.0 = the kitchen / slot is exactly full).
  const levelFor = (ratio) => (ratio < 0.4 ? 'low' : ratio < 0.8 ? 'moderate' : ratio < 1.2 ? 'busy' : 'very-busy');

  // Right-now rush: orders the kitchen is working on plus people who are paying right now.
  async function currentRush() {
    const [placed, accepted, preparing, checkingOut] = await Promise.all([
      orders.find({ status: 'Placed' }),
      orders.find({ status: 'Accepted' }),
      orders.find({ status: 'Preparing' }),
      payments.find({ status: 'Pending' }),
    ]);
    const active = [...placed, ...accepted, ...preparing];
    const stillPaying = checkingOut.filter((p) => p.expiresAt > now());
    const people = new Set([...active.map((o) => o.userId), ...stillPaying.map((p) => p.userId)]);
    const load = active.length + stillPaying.length;
    return {
      level: levelFor(load / config.kitchenCapacity),
      activeOrders: active.length,
      activeUsers: people.size,
      waitMinutes: Math.min(90, Math.round(5 + load * config.prepMinutesPerOrder)),
    };
  }

  const slotRush = (reserved, capacity) => ({
    level: levelFor(reserved / capacity),
    percent: Math.min(100, Math.round((reserved / capacity) * 100)),
    booked: reserved,
    remaining: Math.max(0, capacity - reserved),
    full: reserved >= capacity,
  });

  // Everything the cart needs in one call: rush right now, and the next pickup windows with their rush.
  r.get('/pickup/options', requireUser, async (req, res) => {
    const t = now();
    const [rushNow, allSlots] = await Promise.all([currentRush(), slots.find()]);
    const byStart = new Map(allSlots.filter((s) => s.startsAt).map((s) => [s.startsAt, s]));
    const earliest = t + config.pickupLeadMs;
    const list = [];
    for (let start = windowStart(earliest); list.length < 12; start += WINDOW_MS) {
      if (start + WINDOW_MS <= earliest) continue;
      if (!isOpenAt(start)) {
        if (start > t + 24 * 3_600_000) break;
        continue;
      }
      const doc = byStart.get(start);
      list.push({
        startsAt: start,
        label: doc?.label || windowLabel(start),
        slotId: doc?.id || null,
        ...slotRush(doc?.reserved || 0, doc?.capacity || config.defaultSlotCapacity),
      });
    }
    // Staff-made slots that do not sit on a quarter-hour boundary are listed too.
    for (const s of allSlots) {
      if (s.startsAt && s.startsAt >= earliest && s.startsAt % WINDOW_MS !== 0 && s.startsAt < t + 24 * 3_600_000) {
        list.push({ startsAt: s.startsAt, label: s.label, slotId: s.id, ...slotRush(s.reserved, s.capacity) });
      }
    }
    list.sort((a, b) => a.startsAt - b.startsAt);
    res.json({
      now: { available: isOpenAt(t), ...rushNow },
      windows: list,
      rules: { leadMinutes: config.pickupLeadMs / 60000, stepMinutes: 15, openHour: config.openHour, closeHour: config.closeHour, timezone: config.timezone },
    });
  });

  // Rush for any custom time the student types in.
  r.get('/pickup/rush', requireUser, async (req, res) => {
    const at = Number(req.query.at);
    if (!Number.isFinite(at)) throw new HttpError(400, 'at must be a time in milliseconds');
    const start = windowStart(at);
    const doc = (await slots.find({ startsAt: start }))[0];
    res.json({
      startsAt: start,
      label: doc?.label || windowLabel(start),
      open: isOpenAt(at),
      ...slotRush(doc?.reserved || 0, doc?.capacity || config.defaultSlotCapacity),
    });
  });

  // Turns the student's choice into a slot to reserve (or none for "right now").
  async function resolvePickup(body) {
    const p = body.pickup || (typeof body.slotId === 'string' ? { type: 'slot', slotId: body.slotId } : null);
    if (!p || typeof p !== 'object') throw new HttpError(400, 'pickup is required');
    if (p.type === 'asap') {
      if (!isOpenAt(now())) throw new HttpError(409, 'The canteen is closed right now. Please choose a later time.');
      return { slotId: null, label: 'Right now (ASAP)' };
    }
    if (p.type === 'slot') {
      const slot = typeof p.slotId === 'string' ? await slots.get(p.slotId) : null;
      if (!slot) throw new HttpError(404, 'Pickup slot not found');
      if (slot.startsAt && slot.startsAt <= now()) throw new HttpError(409, 'Pickup slot has already started');
      return { slotId: slot.id, label: slot.label };
    }
    if (p.type === 'custom') {
      const at = Number(p.at);
      if (!Number.isFinite(at)) throw new HttpError(400, 'pickup.at must be a time in milliseconds');
      const lead = config.pickupLeadMs / 60000;
      if (at < now() + config.pickupLeadMs) throw new HttpError(409, `Please choose a time at least ${lead} minutes from now`);
      if (at > now() + 2 * 24 * 3_600_000) throw new HttpError(409, 'You can order up to 2 days ahead');
      if (!isOpenAt(at)) throw new HttpError(409, 'The canteen is closed at that time');
      const start = windowStart(at);
      // Reuse a staff-made slot for this quarter-hour if there is one, otherwise create it on demand.
      let slot = (await slots.find({ startsAt: start }))[0];
      if (!slot) {
        slot = await store.ensureSlot({
          id: `auto-${start}`, label: windowLabel(start), capacity: config.defaultSlotCapacity, reserved: 0, startsAt: start, auto: true,
        });
      }
      return { slotId: slot.id, label: slot.label };
    }
    throw new HttpError(400, 'Unknown pickup type');
  }

  // ---------- checkout (REQ-9..12, 16, 18) ----------
  r.post('/checkout', requireRole('student'), async (req, res) => {
    const { items, idempotencyKey } = req.body || {};
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8) {
      throw new HttpError(400, 'idempotencyKey is required');
    }
    // Independent lookups run together: each database round trip is the main source of latency.
    const [, prior, menuDocs, pickup] = await Promise.all([
      expirePending(),
      payments.findOne({ idempotencyKey }),
      menu.find(),
      resolvePickup(req.body || {}).catch((error) => ({ error })),
    ]);
    if (prior) {
      if (prior.userId !== req.user.id) throw new HttpError(409, 'Idempotency key already used');
      return res.json(session(prior)); // retry of the same attempt, never a second one
    }

    // REQ-9 / REQ-11: re-validate price, availability, quantity against the server's menu.
    const result = validateOrder(
      Array.isArray(items) ? items : [],
      menuDocs.map((m) => ({ id: m.id, name: m.name, price: m.price, available: m.available }))
    );
    if (!result.valid) throw new HttpError(409, 'Cart is no longer valid', result.errors);

    if (pickup.error) throw pickup.error;
    const slotId = pickup.slotId; // null for "right now"
    if (slotId && !(await store.reserveSlot(slotId))) throw new HttpError(409, 'That pickup time is full, please choose another');

    const byId = new Map(menuDocs.map((m) => [m.id, m]));
    const snapshot = items.map((i) => ({
      itemId: i.itemId,
      name: byId.get(i.itemId).name,
      price: byId.get(i.itemId).price, // price at time of order
      quantity: i.quantity,
    }));

    let payment;
    try {
      payment = await payments.insert({
        userId: req.user.id,
        idempotencyKey,
        amount: result.total,
        items: snapshot,
        slotId,
        slotLabel: pickup.label,
        status: 'Pending',
        createdAt: now(),
        expiresAt: now() + config.paymentTimeoutMs,
      });
    } catch (err) {
      if (slotId) await store.releaseSlot(slotId);
      if (err.code === 11000) {
        const dup = await payments.findOne({ idempotencyKey });
        if (dup && dup.userId === req.user.id) return res.json(session(dup));
        throw new HttpError(409, 'Idempotency key already used');
      }
      throw err;
    }

    try {
      const g = await gateway.createOrder({ amountPaise: paise(result.total), receipt: payment.id });
      payment = await payments.update(payment.id, { gatewayOrderId: g.id });
    } catch (err) {
      console.error('gateway createOrder failed', err);
      await endPending(payment, 'Failed'); // REQ-16: no order, slot released, retry possible
      throw new HttpError(502, 'Payment gateway unavailable, please try again');
    }
    res.status(201).json(session(payment));
  });

  // Client reports a payment id; we confirm it with the gateway ourselves.
  r.post('/payments/:id/confirm', requireRole('student'), async (req, res) => {
    const payment = await payments.get(req.params.id);
    if (!payment || payment.userId !== req.user.id) throw new HttpError(404, 'Payment not found');
    const gatewayPaymentId = req.body?.gatewayPaymentId;
    if (typeof gatewayPaymentId !== 'string' || !gatewayPaymentId) {
      throw new HttpError(400, 'gatewayPaymentId is required');
    }
    const out = await confirmPayment(payment, gatewayPaymentId);
    res.json({ status: out.status, order: out.order ? presentOrder(out.order) : undefined });
  });

  // Demo gateway only: stands in for the student paying (or failing) in the gateway's window.
  // The client then calls /confirm, so the same server-side verification path is exercised.
  if (gateway.simulatePay) {
    r.post('/payments/:id/demo-pay', requireRole('student'), async (req, res) => {
      const payment = await payments.get(req.params.id);
      if (!payment || payment.userId !== req.user.id) throw new HttpError(404, 'Payment not found');
      if (payment.status !== 'Pending') throw new HttpError(409, `Payment is already ${payment.status}`);
      const outcome = req.body?.outcome === 'failed' ? 'failed' : 'success';
      res.json({ gatewayPaymentId: await gateway.simulatePay(payment.gatewayOrderId, outcome) });
    });
  }

  // Polling endpoint for the checkout screen.
  r.get('/payments/:id', requireRole('student'), async (req, res) => {
    await expirePending();
    const payment = await payments.get(req.params.id);
    if (!payment || payment.userId !== req.user.id) throw new HttpError(404, 'Payment not found');
    const order = await orderForPayment(payment);
    res.json({ status: payment.status, order: order ? presentOrder(order) : undefined });
  });

  // Razorpay server-to-server webhook; raw body is needed for the HMAC signature.
  // Mounted by app.js before JSON parsing and authentication (the gateway has no Firebase token).
  r.webhook = async (req, res) => {
    if (!Buffer.isBuffer(req.body)) throw new HttpError(400, 'Expected raw body');
    if (!gateway.verifyWebhookSignature(req.body, req.headers['x-razorpay-signature'])) {
      throw new HttpError(400, 'Invalid webhook signature');
    }
    const event = JSON.parse(req.body.toString('utf8'));
    const entity = event?.payload?.payment?.entity;
    if (entity && ['payment.captured', 'payment.failed'].includes(event.event)) {
      const payment = await payments.findOne({ gatewayOrderId: entity.order_id });
      if (payment) await confirmPayment(payment, entity.id);
    }
    res.json({ ok: true });
  };

  // ---------- orders ----------
  // REQ-23: students only ever see their own orders.
  r.get('/orders', requireRole('student'), async (req, res) => {
    const [mine, reviews] = await Promise.all([
      orders.find({ userId: req.user.id }),
      store.col('feedback').find({ userId: req.user.id }),
    ]);
    const rated = new Set(reviews.map((f) => f.orderId));
    res.json({
      orders: mine.sort((a, b) => b.createdAt - a.createdAt).map((o) => ({ ...presentOrder(o), rated: rated.has(o.id) })),
    });
  });

  r.get('/orders/:id', requireUser, async (req, res) => {
    const o = await orders.get(req.params.id);
    const isStaff = STAFF.includes(req.user.role);
    if (!o || (!isStaff && o.userId !== req.user.id)) throw new HttpError(404, 'Order not found');
    res.json(presentOrder(o));
  });

  // Staff order queue (active orders first-in-first-out).
  r.get('/staff/orders', requireRole(...STAFF), async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    const active = ['Placed', 'Accepted', 'Preparing', 'Ready'];
    const all = await orders.find(status ? { status } : undefined);
    const list = all.filter((o) => (status ? true : active.includes(o.status))).sort((a, b) => a.createdAt - b.createdAt);
    res.json({ orders: list.map(presentOrder) });
  });

  // REQ-24 / REQ-22: staff-only status transitions; Ready triggers a push notification.
  r.patch('/orders/:id/status', requireRole(...STAFF), async (req, res) => {
    const next = req.body?.status;
    const o = await orders.get(req.params.id);
    if (!o) throw new HttpError(404, 'Order not found');
    if (!(STAFF_TRANSITIONS[o.status] || []).includes(next)) {
      throw new HttpError(409, `Cannot change order from ${o.status} to ${next}`);
    }
    // Conditional update guards against two staff members acting at once.
    const patch = { status: next };
    if (next === 'Rejected') patch.needsManualResolution = true; // outside refund window: manual (REQ-20)
    const updated = await orders.update(o.id, patch, { status: o.status });
    if (!updated) throw new HttpError(409, 'Order was changed by someone else, refresh and retry');
    if (next === 'Rejected' && o.slotId) await store.releaseSlot(o.slotId);
    await audit(store, req.user, `order.${next}`, o.id, now);
    if (next === 'Ready') {
      const owner = await users.get(o.userId);
      try {
        if (owner) await notifier.notifyOrderReady(owner, updated);
      } catch (err) {
        console.error('push notification failed', err); // order state is already saved
      }
    }
    res.json(presentOrder(updated));
  });

  // Business rule 5.6: cancel within 2 minutes, only while Placed. REQ-20: refund via gateway.
  r.post('/orders/:id/cancel', requireRole('student'), async (req, res) => {
    const o = await orders.get(req.params.id);
    if (!o || o.userId !== req.user.id) throw new HttpError(404, 'Order not found');
    if (o.status !== 'Placed') throw new HttpError(409, 'Only orders still in Placed state can be cancelled');
    if (now() - o.createdAt > config.cancelWindowMs) {
      throw new HttpError(409, 'The cancellation window has passed; please ask canteen staff');
    }
    const updated = await orders.update(o.id, { status: 'Cancelled' }, { status: 'Placed' });
    if (!updated) throw new HttpError(409, 'Order can no longer be cancelled');
    const payment = await payments.get(o.paymentId);
    await gateway.refund(payment.gatewayPaymentId, paise(payment.amount));
    await payments.update(payment.id, { status: 'Refunded' });
    if (o.slotId) await store.releaseSlot(o.slotId);
    res.json(presentOrder(updated));
  });

  // Called by the scheduled Lambda (EventBridge) as well as lazily above.
  r.expirePending = expirePending;
  return r;
};
