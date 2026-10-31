'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { start, tokenFor } = require('./helpers');

let t, f;
beforeEach(async () => {
  t = await start();
  f = await t.seed();
});
afterEach(() => t.close());

const create = (token, body) => t.api('POST', '/api/admin/staff', { token, body });

test('the old "make a student staff" route is gone', async () => {
  const users = (await t.api('GET', '/api/admin/users', { token: f.owner })).body.users;
  const stu = users.find((u) => u.email === 'stu1@ves.ac.in');
  assert.equal((await t.api('PUT', `/api/admin/users/${stu.id}/role`, { token: f.owner, body: { role: 'staff' } })).status, 404);
});

test('only the owner can create staff logins', async () => {
  const body = { name: 'New Person', email: 'new.person@ves.ac.in' };
  assert.equal((await create(f.staff, body)).status, 403);
  assert.equal((await create(f.student, body)).status, 403);
  assert.equal((await t.api('POST', '/api/admin/staff', { body })).status, 401);
});

test('owner creates a staff login with a generated password, and that staff member can work', async () => {
  const r = await create(f.owner, { name: 'Meera K', email: 'Meera.K@ves.ac.in' });
  assert.equal(r.status, 201);
  assert.equal(r.body.role, 'staff');
  assert.equal(r.body.email, 'meera.k@ves.ac.in'); // normalised
  assert.equal(r.body.passwordGenerated, true);
  assert.match(r.body.password, /^[A-Za-z0-9]{10}$/);
  assert.equal(t.accounts.get('fb:meera.k@ves.ac.in').password, r.body.password); // the login really got that password

  const token = tokenFor('fb:meera.k@ves.ac.in', 'meera.k@ves.ac.in');
  assert.equal((await t.api('GET', '/api/me', { token })).body.role, 'staff');
  assert.equal((await t.api('GET', '/api/staff/orders', { token })).status, 200);
  assert.equal((await t.api('GET', '/api/admin/users', { token })).status, 403); // staff cannot manage accounts
});

test('owner may choose the password; short ones and bad emails are rejected; duplicates conflict', async () => {
  const ok = await create(f.owner, { name: 'Imran', email: 'imran@college.edu', password: 'chosen-pass-1' });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.passwordGenerated, false);
  assert.equal(t.accounts.get('fb:imran@college.edu').password, 'chosen-pass-1');
  assert.equal((await create(f.owner, { name: 'X', email: 'x@y.com', password: 'short' })).status, 400);
  assert.equal((await create(f.owner, { name: 'X', email: 'not-an-email' })).status, 400);
  assert.equal((await create(f.owner, { email: 'a@b.com' })).status, 400);
  assert.equal((await create(f.owner, { name: 'Dup', email: 'imran@college.edu' })).status, 409);
  assert.equal((await create(f.owner, { name: 'Dup', email: 'stu1@ves.ac.in' })).status, 409); // an existing student's email
});

test('the owner can reset a staff password, and remove a staff login', async () => {
  const made = await create(f.owner, { name: 'Temp', email: 'temp@ves.ac.in' });
  const reset = await t.api('POST', `/api/admin/staff/${made.body.id}/reset-password`, { token: f.owner });
  assert.equal(reset.status, 200);
  assert.notEqual(reset.body.password, made.body.password);
  assert.equal(t.accounts.get('fb:temp@ves.ac.in').password, reset.body.password);

  const token = tokenFor('fb:temp@ves.ac.in', 'temp@ves.ac.in');
  assert.equal((await t.api('GET', '/api/staff/orders', { token })).status, 200); // warms the auth cache
  assert.equal((await t.api('DELETE', `/api/admin/staff/${made.body.id}`, { token: f.owner })).status, 204);
  assert.equal(t.accounts.has('fb:temp@ves.ac.in'), false);
  assert.equal((await t.api('GET', '/api/staff/orders', { token })).status, 403); // access ends immediately
  assert.equal((await t.api('DELETE', `/api/admin/staff/${made.body.id}`, { token: f.owner })).status, 404);
});

test('students and the owner cannot be reset or removed through the staff routes', async () => {
  const users = (await t.api('GET', '/api/admin/users', { token: f.owner })).body.users;
  const stu = users.find((u) => u.email === 'stu1@ves.ac.in');
  assert.equal((await t.api('DELETE', `/api/admin/staff/${stu.id}`, { token: f.owner })).status, 409);
  assert.equal((await t.api('POST', `/api/admin/staff/${stu.id}/reset-password`, { token: f.owner })).status, 409);
});

test('account list is searchable, filterable and paged', async () => {
  for (let i = 1; i <= 12; i++) await t.signUp(`kid${String(i).padStart(2, '0')}`, `kid${String(i).padStart(2, '0')}@ves.ac.in`);
  await create(f.owner, { name: 'Zed Cook', email: 'zed@ves.ac.in' });
  const list = (query) => t.api('GET', `/api/admin/users${query}`, { token: f.owner });

  const students = (await list('?role=student&limit=5')).body;
  assert.equal(students.total, 13); // stu1 + 12 kids
  assert.equal(students.users.length, 5);
  const page3 = (await list('?role=student&limit=5&offset=10')).body;
  assert.equal(page3.users.length, 3);
  assert.ok(students.users.every((u) => u.role === 'student'));

  const found = (await list('?q=KID07')).body; // case-insensitive
  assert.deepEqual(found.users.map((u) => u.email), ['kid07@ves.ac.in']);
  const staff = (await list('?role=staff')).body;
  assert.deepEqual(staff.users.map((u) => u.name).sort(), ['Zed Cook', 'staff1']);
  assert.ok(!(await list('')).body.users.some((u) => u.role === 'owner')); // the owner is never listed
  assert.equal((await list('?role=student&q=nobody-here')).body.total, 0);
});

test('staff changes are audit-logged', async () => {
  const made = await create(f.owner, { name: 'Logged', email: 'logged@ves.ac.in' });
  await t.api('DELETE', `/api/admin/staff/${made.body.id}`, { token: f.owner });
  const actions = (await t.store.col('audit').find()).map((e) => e.action);
  assert.ok(actions.includes('staff.create') && actions.includes('staff.remove'));
});
