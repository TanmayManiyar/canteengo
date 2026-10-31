'use strict';
const { Router } = require('express');
const { HttpError } = require('../lib/errors');
const { requireRole } = require('../middleware/auth');

module.exports = function feedbackRoutes({ store, now }) {
  const r = Router();
  const orders = store.col('orders');
  const feedback = store.col('feedback');
  const menu = store.col('menu');

  // REQ-34 / REQ-37: 1-5 stars, only for the student's own Collected order.
  r.post('/orders/:id/feedback', requireRole('student'), async (req, res) => {
    const order = await orders.get(req.params.id);
    if (!order) throw new HttpError(404, 'Order not found');
    if (order.userId !== req.user.id) throw new HttpError(403, 'You can only review your own orders');
    if (order.status !== 'Collected') throw new HttpError(409, 'You can rate an order after it is collected');

    const { rating, comment } = req.body || {};
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpError(400, 'rating must be 1 to 5');
    if (comment !== undefined && (typeof comment !== 'string' || comment.length > 500)) {
      throw new HttpError(400, 'comment must be text up to 500 characters');
    }
    if (await feedback.findOne({ orderId: order.id })) throw new HttpError(409, 'Feedback already submitted');

    const fb = await feedback.insert({
      orderId: order.id,
      userId: req.user.id,
      rating,
      comment: comment?.trim() || '',
      createdAt: now(),
    });
    // REQ-35: refresh each ordered item's running average.
    for (const line of order.items) await menu.inc(line.itemId, { ratingSum: rating, ratingCount: 1 });
    res.status(201).json(fb);
  });

  return r;
};
