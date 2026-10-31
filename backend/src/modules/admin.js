'use strict';
const { Router } = require('express');
const { HttpError } = require('../lib/errors');
const { requireRole } = require('../middleware/auth');
const { audit } = require('../lib/audit');

const REVENUE_STATUSES = ['Placed', 'Accepted', 'Preparing', 'Ready', 'Collected'];

module.exports = function adminRoutes({ store, now, authCache }) {
  const r = Router();
  const users = store.col('users');
  const owner = requireRole('owner');

  r.get('/admin/users', owner, async (req, res) => {
    const all = await users.find();
    res.json({ users: all.map((u) => ({ id: u.id, email: u.email, name: u.name, role: u.role })) });
  });

  // Business rule 5.6: only an owner grants or revokes staff access.
  r.put('/admin/users/:id/role', owner, async (req, res) => {
    const role = req.body?.role;
    if (!['student', 'staff'].includes(role)) throw new HttpError(400, 'role must be student or staff');
    const target = await users.get(req.params.id);
    if (!target) throw new HttpError(404, 'User not found');
    if (target.role === 'owner') throw new HttpError(409, 'Owner access cannot be changed here');
    const updated = await users.update(target.id, { role });
    authCache.invalidate(target.uid); // the new role applies on their very next request
    await audit(store, req.user, `role.${role}`, target.id, now);
    res.json({ id: updated.id, email: updated.email, role: updated.role });
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
