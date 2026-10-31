'use strict';
const crypto = require('crypto');
const { createApp } = require('../src/app');
const { createMemoryStore } = require('../src/store/memory');
const { loadConfig } = require('../src/config');

// Fake Razorpay: tests decide what the gateway reports for each payment.
function createFakeGateway() {
  const g = {
    keyId: 'rzp_test_key',
    orders: new Map(),
    payments: new Map(),
    refunds: [],
    failCreate: false,
    webhookSecret: 'whsec',
    async createOrder({ amountPaise, receipt }) {
      if (g.failCreate) throw new Error('gateway down');
      const id = 'order_' + (g.orders.size + 1);
      g.orders.set(id, { id, amountPaise, receipt });
      return { id };
    },
    async fetchPayment(id) {
      const p = g.payments.get(id);
      if (!p) throw new Error('no such payment');
      return p;
    },
    async refund(paymentId, amount) {
      g.refunds.push({ paymentId, amount });
    },
    // Simulate the student finishing (or failing) payment at the gateway.
    pay(gatewayOrderId, status = 'captured', id = 'pay_' + (g.payments.size + 1)) {
      const o = g.orders.get(gatewayOrderId);
      g.payments.set(id, { id, order_id: gatewayOrderId, amount: o.amountPaise, status });
      return id;
    },
    verifyWebhookSignature(raw, sig) {
      return sig === crypto.createHmac('sha256', g.webhookSecret).update(raw).digest('hex');
    },
  };
  return g;
}

// Token format used by the fake verifier: "<uid>|<email>"; "bad" is rejected.
const tokenFor = (uid, email) => `${uid}|${email}`;

async function start(envOverrides = {}, { makeGateway } = {}) {
  const clock = { t: 1_700_000_000_000 };
  const store = createMemoryStore();
  const gateway = makeGateway ? makeGateway(store) : createFakeGateway();
  const pushed = [];
  // Fake Firebase user management used by the owner's "create staff login" feature.
  const accounts = new Map(); // uid -> { email, password }
  const identity = {
    async createUser({ email, password }) {
      if ([...accounts.values()].some((a) => a.email === email)) throw Object.assign(new Error('exists'), { code: 'auth/email-already-exists' });
      const uid = 'fb:' + email;
      accounts.set(uid, { email, password });
      return { uid };
    },
    async updatePassword(uid, password) {
      if (!accounts.has(uid)) throw Object.assign(new Error('missing'), { code: 'auth/user-not-found' });
      accounts.get(uid).password = password;
    },
    async deleteUser(uid) {
      if (!accounts.delete(uid)) throw Object.assign(new Error('missing'), { code: 'auth/user-not-found' });
    },
  };
  const config = loadConfig({
    COLLEGE_EMAIL_DOMAIN: 'ves.ac.in',
    OWNER_EMAIL: 'owner@ves.ac.in',
    ...envOverrides,
  });
  const app = createApp({
    store,
    gateway,
    config,
    identity,
    now: () => clock.t,
    notifier: { notifyOrderReady: async (user, order) => pushed.push({ user, order }) },
    verifyToken: async (token) => {
      const [uid, email] = token.split('|');
      if (!uid || !email) throw new Error('bad token');
      return { uid, email };
    },
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  async function api(method, path, { token, body, headers, raw } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(raw ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = text;
    }
    return { status: res.status, body: json };
  }

  // Registers a user and returns their token.
  async function signUp(uid, email) {
    const token = tokenFor(uid, email);
    const r = await api('POST', '/api/auth/register', { token, body: { name: uid } });
    if (r.status >= 300) throw new Error(`signUp failed ${r.status} ${JSON.stringify(r.body)}`);
    return token;
  }

  // The owner creates a staff login; returns the token that staff member would use after logging in.
  async function createStaff(ownerToken, name = 'staff1') {
    const email = `${name}@ves.ac.in`;
    const r = await api('POST', '/api/admin/staff', { token: ownerToken, body: { name, email } });
    if (r.status !== 201) throw new Error(`createStaff failed ${r.status} ${JSON.stringify(r.body)}`);
    return tokenFor('fb:' + email, email);
  }

  // Standard fixture: owner, staff, student, one menu item and a slot.
  async function seed() {
    const owner = await signUp('owner', 'owner@ves.ac.in');
    const staff = await createStaff(owner, 'staff1');
    const student = await signUp('stu1', 'stu1@ves.ac.in');
    const samosa = (await api('POST', '/api/menu', { token: staff, body: { name: 'Samosa', category: 'Snacks', price: 15 } })).body;
    const tea = (await api('POST', '/api/menu', { token: staff, body: { name: 'Tea', category: 'Beverages', price: 10.5 } })).body;
    const slot = (await api('POST', '/api/slots', { token: staff, body: { label: '1:00-1:15', capacity: 2, startsAt: clock.t + 3_600_000 } })).body;
    return { owner, staff, student, samosa, tea, slot };
  }

  // Checkout + capture payment + confirm: returns the order.
  async function placeOrder(student, f, key = crypto.randomUUID(), qty = 2) {
    const co = await api('POST', '/api/checkout', {
      token: student,
      body: { items: [{ itemId: f.samosa.id, quantity: qty, price: 15 }], slotId: f.slot.id, idempotencyKey: key },
    });
    const payId = gateway.pay(co.body.gatewayOrderId);
    const conf = await api('POST', `/api/payments/${co.body.paymentId}/confirm`, { token: student, body: { gatewayPaymentId: payId } });
    return { co, conf, payId };
  }

  return {
    api, signUp, createStaff, seed, placeOrder, store, gateway, identity, accounts, pushed, clock, config,
    close: () => new Promise((r) => server.close(r)),
  };
}

module.exports = { start, tokenFor };
