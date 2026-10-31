'use strict';
const crypto = require('crypto');
const { Router } = require('express');
const { HttpError } = require('../lib/errors');
const { requireRole } = require('../middleware/auth');
const { audit } = require('../lib/audit');

const REVENUE_STATUSES = ['Placed', 'Accepted', 'Preparing', 'Ready', 'Collected'];

// Easy to read out loud: no 0/O, 1/l/I.
const PASSWORD_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
const generatePassword = (length = 10) => Array.from({ length }, () => PASSWORD_CHARS[crypto.randomInt(PASSWORD_CHARS.length)]).join('');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const present = (u) => ({ id: u.id, name: u.name || '', email: u.email, role: u.role, createdAt: u.createdAt || null });

module.exports = function adminRoutes({ store, now, authCache, identity }) {
  const r = Router();
  const users = store.col('users');
  const owner = requireRole('owner');

  // Searchable, paged account list so the screen never has to show everyone at once.
  //   GET /admin/users?role=staff|student&q=text&limit=10&offset=0
  r.get('/admin/users', owner, async (req, res) => {
    const role = ['staff', 'student'].includes(req.query.role) ? req.query.role : null;
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    let list = (await users.find(role ? { role } : undefined)).filter((u) => u.role !== 'owner');
    if (q) list = list.filter((u) => `${u.name || ''} ${u.email}`.toLowerCase().includes(q));
    list.sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
    res.json({ total: list.length, users: list.slice(offset, offset + limit).map(present) });
  });

  // Business rule 5.6: only the owner can give someone staff access. The owner creates the login;
  // the server creates the Firebase account and returns the password once so it can be handed over.
  r.post('/admin/staff', owner, async (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 80) : '';
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    let password = req.body?.password;
    if (!name) throw new HttpError(400, 'name is required');
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'a valid email is required');
    if (password !== undefined && password !== '' && (typeof password !== 'string' || password.length < 8)) {
      throw new HttpError(400, 'password must be at least 8 characters');
    }
    const generated = !password;
    if (generated) password = generatePassword();
    if (await users.findOne({ email })) throw new HttpError(409, 'An account with this email already exists');

    let account;
    try {
      account = await identity.createUser({ email, password, displayName: name });
    } catch (err) {
      if (err.code === 'auth/email-already-exists') throw new HttpError(409, 'An account with this email already exists');
      throw err;
    }
    let user;
    try {
      user = await users.insert({ uid: account.uid, email, name, role: 'staff', createdAt: now(), createdBy: req.user.id });
    } catch (err) {
      await identity.deleteUser(account.uid).catch(() => {}); // do not leave a login without a staff record
      throw err;
    }
    await audit(store, req.user, 'staff.create', user.id, now);
    res.status(201).json({ ...present(user), password, passwordGenerated: generated });
  });

  async function staffOr404(id) {
    const target = await users.get(id);
    if (!target) throw new HttpError(404, 'Account not found');
    if (target.role !== 'staff') throw new HttpError(409, 'Only staff accounts can be managed here');
    return target;
  }

  r.post('/admin/staff/:id/reset-password', owner, async (req, res) => {
    const target = await staffOr404(req.params.id);
    const password = generatePassword();
    await identity.updatePassword(target.uid, password);
    await audit(store, req.user, 'staff.resetPassword', target.id, now);
    res.json({ id: target.id, email: target.email, password });
  });

  r.delete('/admin/staff/:id', owner, async (req, res) => {
    const target = await staffOr404(req.params.id);
    await identity.deleteUser(target.uid).catch((err) => {
      if (err.code !== 'auth/user-not-found') throw err; // already gone (e.g. a sample account) is fine
    });
    await users.remove(target.id);
    authCache.invalidate(target.uid); // access ends on their very next request
    await audit(store, req.user, 'staff.remove', target.id, now);
    res.status(204).end();
  });

  // Sales report (owner only). Cancelled/Rejected orders are excluded.
  r.get('/reports/sales', owner, async (req, res) => {
    const from = req.query.from ? Number(req.query.from) : 0;
    const to = req.query.to ? Number(req.query.to) : Infinity;
    if (Number.isNaN(from) || Number.isNaN(to)) throw new HttpError(400, 'from/to must be epoch milliseconds');
    const all = (await store.col('orders').find()).filter(
      (o) => REVENUE_STATUSES.includes(o.status) && o.createdAt >= from && o.createdAt <= to
    );
    const perItem = {};
    for (const o of all) {
      for (const l of o.items) {
        const e = (perItem[l.itemId] ||= { itemId: l.itemId, name: l.name, quantity: 0, revenue: 0 });
        e.quantity += l.quantity;
        e.revenue += Math.round(l.price * 100) * l.quantity;
      }
    }
    const topItems = Object.values(perItem)
      .map((e) => ({ ...e, revenue: e.revenue / 100 }))
      .sort((a, b) => b.quantity - a.quantity);
    const totalPaise = all.reduce((s, o) => s + Math.round(o.total * 100), 0);
    res.json({ orderCount: all.length, totalRevenue: totalPaise / 100, topItems });
  });

  // REQ-36: aggregated feedback and rating trends.
  r.get('/reports/feedback', owner, async (req, res) => {
    const all = await store.col('feedback').find();
    const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const f of all) dist[f.rating]++;
    const menu = await store.col('menu').find();
    res.json({
      count: all.length,
      average: all.length ? Math.round((all.reduce((s, f) => s + f.rating, 0) / all.length) * 10) / 10 : null,
      distribution: dist,
      items: menu
        .filter((m) => m.ratingCount)
        .map((m) => ({ id: m.id, name: m.name, average: Math.round((m.ratingSum / m.ratingCount) * 10) / 10, count: m.ratingCount }))
        .sort((a, b) => b.average - a.average),
    });
  });

  return r;
};
