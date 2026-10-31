'use strict';
// DEVELOPMENT ONLY. Runs the real API with an in-memory database, a fake login and the demo payment
// gateway, so the screens can be tried out (or tested by an assistant) without Firebase, Atlas or AWS.
//   node scripts/dev-mock-server.js            (listens on :4001)
// Any password works. The login token is "<uid>|<email>" and uid is always "fb:<email>".
const { createApp } = require('../src/app');
const { createMemoryStore } = require('../src/store/memory');
const { createDemoGateway } = require('../src/integrations/demo');
const { loadConfig } = require('../src/config');

const OWNER = '2024.tanmay.maniyar@ves.ac.in';
const tokenFor = (email) => `fb:${email}|${email}`;

async function main() {
  const store = createMemoryStore();
  const accounts = new Map();
  const config = loadConfig({ COLLEGE_EMAIL_DOMAIN: 'ves.ac.in', OWNER_EMAIL: OWNER, KITCHEN_CAPACITY: '6', DEFAULT_SLOT_CAPACITY: '6' });
  const app = createApp({
    store,
    config,
    gateway: createDemoGateway(store),
    notifier: { notifyOrderReady: async () => {} },
    verifyToken: async (token) => {
      const [uid, email] = String(token).split('|');
      if (!uid || !email) throw new Error('bad token');
      return { uid, email };
    },
    identity: {
      async createUser({ email, password }) {
        if (accounts.has(email)) throw Object.assign(new Error('exists'), { code: 'auth/email-already-exists' });
        accounts.set(email, password);
        return { uid: `fb:${email}` };
      },
      async updatePassword() {},
      async deleteUser() {},
    },
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(Number(process.env.PORT) || 4001, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, email, body) => {
    const res = await fetch(base + '/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenFor(email)}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)}`);
    return json;
  };

  // ---- seed: people ----
  await call('POST', '/auth/register', OWNER, { name: 'Tanmay (owner)' });
  const students = ['aarav', 'diya', 'rohan'].map((n) => `${n}@ves.ac.in`);
  for (const e of students) await call('POST', '/auth/register', e, { name: e.split('@')[0] });
  await call('POST', '/auth/register', 'student@ves.ac.in', { name: 'Demo Student' });
  await call('POST', '/admin/staff', OWNER, { name: 'Meera Kulkarni', email: 'meera@ves.ac.in', password: 'meera-pass-1' });

  // ---- seed: menu, slots, offers ----
  const MENU = [
    ['Snacks', 'Samosa', 15], ['Snacks', 'Vada Pav', 20], ['Snacks', 'Pav Bhaji', 60], ['Snacks', 'French Fries', 50],
    ['Meals', 'Veg Thali', 90], ['Meals', 'Chole Bhature', 75],
    ['South Indian', 'Masala Dosa', 60], ['South Indian', 'Idli Sambar (2 pcs)', 40],
    ['Beverages', 'Masala Chai', 10.5], ['Beverages', 'Cold Coffee', 50], ['Beverages', 'Mango Lassi', 45],
    ['Desserts', 'Gulab Jamun (2 pcs)', 30],
  ];
  const menu = [];
  for (const [category, name, price] of MENU) menu.push(await call('POST', '/menu', OWNER, { name, category, price }));
  await call('PUT', `/menu/${menu.find((m) => m.name === 'French Fries').id}`, OWNER, { available: false });
  const t = Date.now();
  await call('POST', '/slots', OWNER, { label: 'Lunch window', capacity: 4, startsAt: Math.ceil((t + 60 * 60_000) / 900_000) * 900_000 });
  await call('POST', '/offers', OWNER, { title: 'Chai Time', description: 'Masala Chai + Samosa together', startsAt: t - 3_600_000, endsAt: t + 86_400_000 });

  // ---- seed: a few live orders so the rush meter and the staff board have data ----
  const byName = (n) => menu.find((m) => m.name === n);
  async function order(email, pickup, names) {
    const items = names.map((n) => ({ itemId: byName(n).id, quantity: 1, price: byName(n).price }));
    const co = await call('POST', '/checkout', email, { items, pickup, idempotencyKey: `seed-${Math.random().toString(36).slice(2)}-${Date.now()}` });
    const { gatewayPaymentId } = await call('POST', `/payments/${co.paymentId}/demo-pay`, email, {});
    return (await call('POST', `/payments/${co.paymentId}/confirm`, email, { gatewayPaymentId })).order;
  }
  const o1 = await order(students[0], { type: 'asap' }, ['Samosa', 'Masala Chai']);
  const o2 = await order(students[1], { type: 'asap' }, ['Veg Thali']);
  await order(students[2], { type: 'asap' }, ['Masala Dosa']);
  await call('PATCH', `/orders/${o1.id}/status`, OWNER, { status: 'Accepted' });
  await call('PATCH', `/orders/${o2.id}/status`, OWNER, { status: 'Accepted' });
  await call('PATCH', `/orders/${o2.id}/status`, OWNER, { status: 'Preparing' });

  console.log(`MOCK API ready on ${base}  (owner ${OWNER}, student student@ves.ac.in, staff meera@ves.ac.in; any password)`);
}

main().catch((e) => {
  console.error('mock server failed:', e);
  process.exit(1);
});
