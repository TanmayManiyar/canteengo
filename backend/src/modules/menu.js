'use strict';
const { Router } = require('express');
const { HttpError } = require('../lib/errors');
const { requireUser, requireRole, STAFF } = require('../middleware/auth');
const { parseCsv } = require('../lib/csv');
const { audit } = require('../lib/audit');

const norm = (s) => String(s).trim().toLowerCase();

// SRS 5.2: reject invalid menu writes at the API layer, before they reach MongoDB.
function validateItem(body, { partial = false } = {}) {
  const out = {};
  const errors = [];
  if (!partial || body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) errors.push('name is required');
    else out.name = body.name.trim();
  }
  if (!partial || body.category !== undefined) {
    if (typeof body.category !== 'string' || !body.category.trim()) errors.push('category is required');
    else out.category = body.category.trim();
  }
  if (!partial || body.price !== undefined) {
    if (typeof body.price !== 'number' || !Number.isFinite(body.price) || body.price <= 0) {
      errors.push('price must be a positive number');
    } else out.price = body.price;
  }
  if (body.available !== undefined) {
    if (typeof body.available !== 'boolean') errors.push('available must be true or false');
    else out.available = body.available;
  } else if (!partial) out.available = true;
  if (errors.length) throw new HttpError(400, 'Invalid menu item', errors);
  return out;
}

const present = (m) => ({
  id: m.id,
  name: m.name,
  category: m.category,
  price: m.price,
  available: m.available,
  avgRating: m.ratingCount ? Math.round((m.ratingSum / m.ratingCount) * 10) / 10 : null,
  ratingCount: m.ratingCount || 0,
});

function parseAvailability(v) {
  const s = norm(v ?? '');
  if (['true', 'yes', 'y', '1', 'available'].includes(s)) return true;
  if (['false', 'no', 'n', '0', 'unavailable'].includes(s)) return false;
  return null;
}

module.exports = function menuRoutes({ store, now }) {
  const r = Router();
  const menu = store.col('menu');
  const drafts = store.col('menuDrafts');

  // REQ-5 / REQ-8: menu grouped by category, optional search by name/keyword.
  r.get('/menu', requireUser, async (req, res) => {
    const q = typeof req.query.q === 'string' ? norm(req.query.q) : '';
    let items = (await menu.find()).map(present);
    if (q) items = items.filter((i) => norm(i.name).includes(q) || norm(i.category).includes(q));
    const grouped = {};
    for (const i of items.sort((a, b) => a.name.localeCompare(b.name))) (grouped[i.category] ||= []).push(i);
    const categories = Object.entries(grouped)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, items]) => ({ category, items }));
    res.json({ categories });
  });

  r.post('/menu', requireRole(...STAFF), async (req, res) => {
    const data = validateItem(req.body || {});
    const dup = (await menu.find()).find((m) => norm(m.name) === norm(data.name) && norm(m.category) === norm(data.category));
    if (dup) throw new HttpError(409, 'Menu item already exists in this category');
    const item = await menu.insert({ ...data, ratingSum: 0, ratingCount: 0 });
    await audit(store, req.user, 'menu.create', item.id, now);
    res.status(201).json(present(item));
  });

  r.put('/menu/:id', requireRole(...STAFF), async (req, res) => {
    const patch = validateItem(req.body || {}, { partial: true });
    const item = await menu.update(req.params.id, patch);
    if (!item) throw new HttpError(404, 'Menu item not found');
    await audit(store, req.user, 'menu.update', item.id, now);
    res.json(present(item));
  });

  r.delete('/menu/:id', requireRole(...STAFF), async (req, res) => {
    if (!(await menu.remove(req.params.id))) throw new HttpError(404, 'Menu item not found');
    await audit(store, req.user, 'menu.delete', req.params.id, now);
    res.status(204).end();
  });

  // ---- Bulk upload (REQ-29, 31-33). CSV text is sent as JSON; PDF support is still to do. ----
  r.post('/menu/drafts/upload', requireRole(...STAFF), async (req, res) => {
    const csv = req.body?.csv;
    if (typeof csv !== 'string' || !csv.trim()) throw new HttpError(400, 'csv text is required');
    const rows = parseCsv(csv);
    const header = rows.shift().map(norm);
    const col = (names) => header.findIndex((h) => names.includes(h));
    const idx = {
      name: col(['item name', 'name', 'item']),
      category: col(['category']),
      price: col(['price']),
      available: col(['availability', 'available']),
    };
    const missing = Object.entries(idx).filter(([, i]) => i < 0).map(([k]) => k);
    if (missing.length) {
      throw new HttpError(400, 'CSV must have columns: item name, category, price, availability', { missing });
    }

    const existing = await menu.find();
    const created = [];
    const errors = [];
    for (const [n, cells] of rows.entries()) {
      const line = n + 2; // 1-based, after header
      const name = (cells[idx.name] || '').trim();
      const category = (cells[idx.category] || '').trim();
      const price = Number((cells[idx.price] || '').trim());
      const available = parseAvailability(cells[idx.available]);
      const problems = [];
      if (!name) problems.push('item name is empty');
      if (!category) problems.push('category is empty');
      if (!Number.isFinite(price) || price <= 0) problems.push('price must be a positive number');
      if (available === null) problems.push('availability must be yes/no or true/false');
      if (problems.length) {
        errors.push({ line, reason: problems.join('; ') });
        continue;
      }
      const duplicateOf = existing.find((m) => norm(m.name) === norm(name) && norm(m.category) === norm(category));
      created.push(
        await drafts.insert({
          name,
          category,
          price,
          available,
          duplicateOf: duplicateOf ? duplicateOf.id : null,
          createdBy: req.user.id,
        })
      );
    }
    res.status(201).json({ drafts: created, errors }); // nothing goes live yet (REQ-31)
  });

  r.get('/menu/drafts', requireRole(...STAFF), async (req, res) => res.json({ drafts: await drafts.find() }));

  r.put('/menu/drafts/:id', requireRole(...STAFF), async (req, res) => {
    const patch = validateItem(req.body || {}, { partial: true });
    const d = await drafts.update(req.params.id, patch);
    if (!d) throw new HttpError(404, 'Draft not found');
    res.json(d);
  });

  // REQ-32 / REQ-33: publish only what staff confirm; duplicates need an explicit decision.
  r.post('/menu/drafts/publish', requireRole(...STAFF), async (req, res) => {
    const { ids, resolutions = {} } = req.body || {};
    if (!Array.isArray(ids) || !ids.length) throw new HttpError(400, 'ids is required');
    const published = [];
    const unresolved = [];
    for (const id of ids) {
      const d = await drafts.get(id);
      if (!d) continue;
      if (d.duplicateOf) {
        const choice = resolutions[id];
        if (choice === 'skip') {
          await drafts.remove(id);
          continue;
        }
        if (choice === 'merge' || choice === 'replace') {
          const patch = choice === 'merge' ? { price: d.price } : { price: d.price, available: d.available };
          const item = await menu.update(d.duplicateOf, patch);
          if (item) published.push(present(item));
          await drafts.remove(id);
          continue;
        }
        unresolved.push(id);
        continue;
      }
      const item = await menu.insert({
        name: d.name,
        category: d.category,
        price: d.price,
        available: d.available,
        ratingSum: 0,
        ratingCount: 0,
      });
      await drafts.remove(id);
      published.push(present(item));
    }
    await audit(store, req.user, 'menu.bulkPublish', `${published.length} items`, now);
    res.json({ published, unresolved });
  });

  return r;
};
