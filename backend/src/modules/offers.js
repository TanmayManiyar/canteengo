'use strict';
const { Router } = require('express');
const { HttpError } = require('../lib/errors');
const { requireUser, requireRole, STAFF } = require('../middleware/auth');
const { audit } = require('../lib/audit');

function validateOffer(body, { partial = false } = {}) {
  const out = {};
  const errors = [];
  for (const k of ['title', 'description']) {
    if (body[k] !== undefined) {
      if (typeof body[k] !== 'string' || !body[k].trim()) errors.push(`${k} must be non-empty text`);
      else out[k] = body[k].trim();
    }
  }
  if (!partial && !out.title) errors.push('title is required');
  for (const k of ['startsAt', 'endsAt']) {
    if (body[k] !== undefined) {
      if (!Number.isFinite(body[k])) errors.push(`${k} must be epoch milliseconds`);
      else out[k] = body[k];
    } else if (!partial) errors.push(`${k} is required`);
  }
  if (out.startsAt !== undefined && out.endsAt !== undefined && out.endsAt <= out.startsAt) {
    errors.push('endsAt must be after startsAt');
  }
  if (errors.length) throw new HttpError(400, 'Invalid offer', errors);
  return out;
}

module.exports = function offerRoutes({ store, now }) {
  const r = Router();
  const offers = store.col('offers');

  // REQ-26: only currently active offers.
  r.get('/offers', requireUser, async (req, res) => {
    const t = now();
    const active = (await offers.find()).filter((o) => o.startsAt <= t && t < o.endsAt);
    res.json({ offers: active });
  });

  // REQ-25
  r.post('/offers', requireRole(...STAFF), async (req, res) => {
    const offer = await offers.insert(validateOffer(req.body || {}));
    await audit(store, req.user, 'offer.create', offer.id, now);
    res.status(201).json(offer);
  });

  r.put('/offers/:id', requireRole(...STAFF), async (req, res) => {
    const offer = await offers.update(req.params.id, validateOffer(req.body || {}, { partial: true }));
    if (!offer) throw new HttpError(404, 'Offer not found');
    await audit(store, req.user, 'offer.update', offer.id, now);
    res.json(offer);
  });

  return r;
};
