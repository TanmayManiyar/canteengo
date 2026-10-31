'use strict';
// Fills the database with demo data. Everything it creates has sample:true, so it can be removed again.
//   node --env-file=.env scripts/seed-sample.js           add sample data (safe to re-run)
//   node --env-file=.env scripts/seed-sample.js --reset   remove all sample data
// Sample students/staff are database records only: they have no Firebase account and cannot log in.
const crypto = require('crypto');
const { MongoClient } = require('mongodb');

const id = () => crypto.randomUUID();
const norm = (s) => s.trim().toLowerCase();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const MENU = [
  ['Snacks', 'Samosa', 15], ['Snacks', 'Vada Pav', 20], ['Snacks', 'Veg Puff', 18], ['Snacks', 'Aloo Tikki', 30],
  ['Snacks', 'Bhel Puri', 35], ['Snacks', 'Pav Bhaji', 60], ['Snacks', 'Onion Pakoda', 40], ['Snacks', 'French Fries', 50],
  ['Sandwiches', 'Veg Sandwich', 40], ['Sandwiches', 'Grilled Cheese Sandwich', 60], ['Sandwiches', 'Club Sandwich', 80, false],
  ['Sandwiches', 'Bombay Masala Toast', 45],
  ['Meals', 'Veg Thali', 90], ['Meals', 'Rajma Chawal', 70], ['Meals', 'Chole Bhature', 75], ['Meals', 'Paneer Butter Masala with Roti', 110],
  ['Meals', 'Veg Biryani', 95], ['Meals', 'Dal Khichdi', 65],
  ['South Indian', 'Masala Dosa', 60], ['South Indian', 'Idli Sambar (2 pcs)', 40], ['South Indian', 'Medu Vada', 35], ['South Indian', 'Onion Uttapam', 55],
  ['Chinese', 'Veg Hakka Noodles', 70], ['Chinese', 'Veg Fried Rice', 70], ['Chinese', 'Veg Manchurian', 65], ['Chinese', 'Schezwan Noodles', 75],
  ['Beverages', 'Masala Chai', 10.5], ['Beverages', 'Cutting Chai', 12], ['Beverages', 'Filter Coffee', 20], ['Beverages', 'Cold Coffee', 50],
  ['Beverages', 'Fresh Lime Soda', 30], ['Beverages', 'Mango Lassi', 45], ['Beverages', 'Cold Drink', 25], ['Beverages', 'Mineral Water', 15],
  ['Desserts', 'Gulab Jamun (2 pcs)', 30], ['Desserts', 'Chocolate Brownie', 50], ['Desserts', 'Ice Cream Cup', 35], ['Desserts', 'Chocolate Shake', 60],
];

const STUDENTS = [
  ['Aarav Sharma', 'sample.aarav'], ['Diya Patel', 'sample.diya'], ['Rohan Mehta', 'sample.rohan'],
  ['Sneha Iyer', 'sample.sneha'], ['Kabir Singh', 'sample.kabir'],
];
const STAFF = [['Meera Kulkarni', 'sample.staff.meera'], ['Imran Shaikh', 'sample.staff.imran']];

const OFFERS = [
  ['Lunch Combo', 'Veg Thali + Mango Lassi for ₹120'],
  ['Chai Time', 'Masala Chai + Samosa, order both between 4 and 6 PM'],
  ['Sweet Finish', 'Add a Gulab Jamun to any meal'],
];

function slotLabel(d) {
  const f = (x) => x.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(' ', '');
  return `${f(d)} – ${f(new Date(d.getTime() + 15 * 60_000))}`;
}

// Deterministic pseudo-random so re-runs look the same.
let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

async function main() {
  const reset = process.argv.includes('--reset');
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'canteengo');
  const col = (n) => db.collection(n);
  const now = Date.now();

  if (reset) {
    for (const n of ['menu', 'slots', 'offers', 'users', 'orders', 'payments', 'feedback', 'demoGateway']) {
      const r = await col(n).deleteMany({ sample: true });
      console.log(`removed ${r.deletedCount} sample ${n}`);
    }
    await client.close();
    return;
  }

  // ---- menu (skips items that already exist) ----
  const existing = await col('menu').find().toArray();
  const have = new Set(existing.map((m) => `${norm(m.name)}|${norm(m.category)}`));
  const fresh = MENU.filter(([c, n]) => !have.has(`${norm(n)}|${norm(c)}`)).map(([category, name, price, available = true]) => ({
    _id: id(), name, category, price, available, ratingSum: 0, ratingCount: 0, sample: true,
  }));
  if (fresh.length) await col('menu').insertMany(fresh);
  console.log(`menu: added ${fresh.length}, ${MENU.length - fresh.length} already existed`);

  // ---- pickup slots: the next 8 quarter-hours that are at least 20 minutes away ----
  const start = new Date(Math.ceil((now + 20 * 60_000) / (15 * 60_000)) * 15 * 60_000);
  const slots = Array.from({ length: 8 }, (_, i) => {
    const t = new Date(start.getTime() + i * 15 * 60_000);
    return { _id: id(), label: slotLabel(t), capacity: 12, reserved: 0, startsAt: t.getTime(), sample: true };
  });
  await col('slots').insertMany(slots);
  console.log(`slots: added ${slots.length}`);

  // ---- offers ----
  await col('offers').insertMany(
    OFFERS.map(([title, description]) => ({ _id: id(), title, description, startsAt: now - HOUR, endsAt: now + 2 * DAY, sample: true }))
  );
  console.log(`offers: added ${OFFERS.length}`);

  // ---- sample people (records only, no Firebase account) ----
  const people = [
    ...STUDENTS.map(([name, local]) => ({ name, email: `${local}@ves.ac.in`, role: 'student' })),
    ...STAFF.map(([name, local]) => ({ name, email: `${local}@ves.ac.in`, role: 'staff' })),
  ];
  const users = [];
  for (const p of people) {
    if (await col('users').findOne({ email: p.email })) continue;
    users.push({ _id: id(), uid: `sample-${p.email}`, ...p, createdAt: now - 10 * DAY, sample: true });
  }
  if (users.length) await col('users').insertMany(users);
  console.log(`users: added ${users.length} (${STUDENTS.length} students, ${STAFF.length} staff, cannot log in)`);

  // ---- sample orders: history over 6 days + a few active ones for the live queue ----
  if (await col('orders').findOne({ sample: true })) {
    console.log('orders: sample orders already exist, skipping (run with --reset first to rebuild)');
    await client.close();
    return;
  }
  const menu = (await col('menu').find({ sample: true, available: true }).toArray());
  const students = await col('users').find({ sample: true, role: 'student' }).toArray();
  const orders = [], payments = [], feedback = [];
  const tally = {}; // menuId -> { sum, count }

  const makeOrder = (createdAt, status, rating) => {
    const lines = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => pick(menu));
    const items = [...new Map(lines.map((m) => [m._id, m])).values()].map((m) => ({
      itemId: m._id, name: m.name, price: m.price, quantity: 1 + Math.floor(rnd() * 2),
    }));
    const total = items.reduce((s, i) => s + Math.round(i.price * 100) * i.quantity, 0) / 100;
    const student = pick(students);
    const orderId = id(), paymentId = id();
    const slot = new Date(createdAt + 30 * 60_000);
    payments.push({
      _id: paymentId, userId: student._id, idempotencyKey: id(), amount: total, items, slotId: 'sample-slot',
      slotLabel: slotLabel(slot), status: status === 'Cancelled' ? 'Refunded' : 'Success', createdAt, expiresAt: createdAt + 300_000,
      gatewayOrderId: `sample_order_${paymentId.slice(0, 8)}`, gatewayPaymentId: `sample_pay_${paymentId.slice(0, 8)}`, orderId, sample: true,
    });
    orders.push({
      _id: orderId, userId: student._id, items, total, slotId: 'sample-slot', slotLabel: slotLabel(slot), paymentId,
      token: `CG-${crypto.randomBytes(3).toString('hex').toUpperCase()}`, status, createdAt, sample: true,
    });
    if (rating) {
      feedback.push({ _id: id(), orderId, userId: student._id, rating, comment: '', createdAt: createdAt + HOUR, sample: true });
      for (const i of items) {
        const t = (tally[i.itemId] ||= { sum: 0, count: 0 });
        t.sum += rating; t.count += 1;
      }
    }
  };

  for (let day = 6; day >= 1; day--) {
    for (let k = 0; k < 3 + Math.floor(rnd() * 3); k++) {
      const at = now - day * DAY - Math.floor(rnd() * 5) * HOUR;
      const roll = rnd();
      makeOrder(at, roll < 0.1 ? 'Cancelled' : 'Collected', roll < 0.1 ? 0 : rnd() < 0.7 ? 3 + Math.floor(rnd() * 3) : 0);
    }
  }
  makeOrder(now - 3 * HOUR, 'Collected', 5);
  makeOrder(now - 6 * 60_000, 'Placed', 0);
  makeOrder(now - 12 * 60_000, 'Accepted', 0);
  makeOrder(now - 20 * 60_000, 'Preparing', 0);
  makeOrder(now - 28 * 60_000, 'Ready', 0);

  await col('payments').insertMany(payments);
  await col('orders').insertMany(orders);
  if (feedback.length) await col('feedback').insertMany(feedback);
  for (const [menuId, t] of Object.entries(tally)) {
    await col('menu').updateOne({ _id: menuId }, { $inc: { ratingSum: t.sum, ratingCount: t.count } });
  }
  console.log(`orders: added ${orders.length} (${orders.filter((o) => ['Placed', 'Accepted', 'Preparing', 'Ready'].includes(o.status)).length} active), feedback: ${feedback.length}`);
  await client.close();
}

main().catch((e) => {
  console.error('Seed failed:', e.message);
  process.exit(1);
});
