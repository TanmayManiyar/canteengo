'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');

let t, f;
before(async () => {
  t = await start();
  f = await t.seed();
});
after(() => t.close());

test('REQ-3: missing, malformed and invalid tokens are rejected with 401', async () => {
  assert.equal((await t.api('GET', '/api/menu')).status, 401);
  assert.equal((await t.api('GET', '/api/menu', { token: 'bad' })).status, 401);
});

test('REQ-1: registration needs a college email and defaults to Student', async () => {
  const outsider = await t.api('POST', '/api/auth/register', { token: 'x|x@gmail.com' });
  assert.equal(outsider.status, 403);
  const ok = await t.api('POST', '/api/auth/register', { token: 'new|new@ves.ac.in' });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.role, 'student');
  // registering twice is harmless
  assert.equal((await t.api('POST', '/api/auth/register', { token: 'new|new@ves.ac.in' })).status, 200);
});

test('owner email becomes Owner; unregistered user cannot use the API', async () => {
  assert.equal((await t.api('GET', '/api/me', { token: f.owner })).body.role, 'owner');
  assert.equal((await t.api('GET', '/api/menu', { token: 'ghost|ghost@ves.ac.in' })).status, 403);
});

test('menu: staff manage, students read; invalid writes rejected at the API layer', async () => {
  assert.equal((await t.api('POST', '/api/menu', { token: f.student, body: { name: 'X', category: 'Y', price: 5 } })).status, 403);
  const neg = await t.api('POST', '/api/menu', { token: f.staff, body: { name: 'Bad', category: 'Snacks', price: -5 } });
  assert.equal(neg.status, 400);
  const dup = await t.api('POST', '/api/menu', { token: f.staff, body: { name: 'samosa', category: 'snacks', price: 20 } });
  assert.equal(dup.status, 409);
});

test('REQ-5/7/8: grouped menu, unavailable flag, search', async () => {
  await t.api('PUT', `/api/menu/${f.tea.id}`, { token: f.staff, body: { available: false } });
  const m = await t.api('GET', '/api/menu', { token: f.student });
  const cats = m.body.categories.map((c) => c.category);
  assert.deepEqual(cats, ['Beverages', 'Snacks']);
  assert.equal(m.body.categories[0].items[0].available, false);
  const q = await t.api('GET', '/api/menu?q=sam', { token: f.student });
  assert.equal(q.body.categories.length, 1);
  assert.equal(q.body.categories[0].items[0].name, 'Samosa');
  await t.api('PUT', `/api/menu/${f.tea.id}`, { token: f.staff, body: { available: true } });
});

test('admin actions are audit-logged with user and time', async () => {
  const log = await t.store.col('audit').find();
  assert.ok(log.some((e) => e.action === 'menu.create' && e.email === 'staff1@ves.ac.in' && e.at));
});

test('offers: staff create, only active ones are returned (REQ-25/26)', async () => {
  const now = t.clock.t;
  await t.api('POST', '/api/offers', { token: f.staff, body: { title: 'Live', startsAt: now - 1000, endsAt: now + 1000 } });
  await t.api('POST', '/api/offers', { token: f.staff, body: { title: 'Expired', startsAt: now - 5000, endsAt: now - 1 } });
  assert.equal((await t.api('POST', '/api/offers', { token: f.student, body: { title: 'x', startsAt: 1, endsAt: 2 } })).status, 403);
  const r = await t.api('GET', '/api/offers', { token: f.student });
  assert.deepEqual(r.body.offers.map((o) => o.title), ['Live']);
});

test('bulk CSV upload: row errors reported, duplicates flagged, nothing published automatically', async () => {
  const csv = [
    'item name,category,price,availability',
    'Vada Pav,Snacks,20,yes',
    'Samosa,Snacks,18,yes', // duplicate of existing
    'Free Lunch,Meals,-1,yes', // bad price
    'Mystery,Meals,30,maybe', // bad availability
  ].join('\n');
  const up = await t.api('POST', '/api/menu/drafts/upload', { token: f.staff, body: { csv } });
  assert.equal(up.status, 201);
  assert.equal(up.body.drafts.length, 2);
  assert.deepEqual(up.body.errors.map((e) => e.line), [4, 5]);
  const before = (await t.api('GET', '/api/menu', { token: f.student })).body.categories.flatMap((c) => c.items).map((i) => i.name);
  assert.ok(!before.includes('Vada Pav'));

  const vada = up.body.drafts.find((d) => d.name === 'Vada Pav');
  const dup = up.body.drafts.find((d) => d.name === 'Samosa');
  const pub = await t.api('POST', '/api/menu/drafts/publish', { token: f.staff, body: { ids: [vada.id, dup.id] } });
  assert.deepEqual(pub.body.unresolved, [dup.id]); // duplicate needs an explicit decision
  const pub2 = await t.api('POST', '/api/menu/drafts/publish', { token: f.staff, body: { ids: [dup.id], resolutions: { [dup.id]: 'merge' } } });
  assert.equal(pub2.body.published[0].price, 18);
});

test('bulk CSV with wrong columns is rejected', async () => {
  const r = await t.api('POST', '/api/menu/drafts/upload', { token: f.staff, body: { csv: 'a,b\n1,2' } });
  assert.equal(r.status, 400);
});
