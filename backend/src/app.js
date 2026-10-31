'use strict';
const express = require('express');
const cors = require('cors');
const { errorHandler, HttpError } = require('./lib/errors');
const { authenticate, createAuthCache } = require('./middleware/auth');

/**
 * Builds the Express app from injected dependencies so the same code runs in
 * production (Mongo, Firebase, Razorpay) and in tests (memory store, fakes).
 * deps: { store, gateway, notifier, verifyToken, revokeSession, config, now }
 */
function createApp(deps) {
  const d = { revokeSession: async () => {}, now: Date.now, ...deps };
  d.authCache = d.authCache || createAuthCache(d.config.authCacheMs);
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: d.config.corsOrigin }));

  app.get('/health', (req, res) => res.json({ ok: true }));

  const orders = require('./modules/orders')(d);

  // Gateway webhook: raw body + signature, no Firebase token.
  app.post('/api/payments/webhook', express.raw({ type: '*/*', limit: '256kb' }), orders.webhook);

  app.use(express.json({ limit: '5600kb' })); // room for a 4 MB PDF sent as base64
  const api = express.Router();
  api.use(authenticate(d));
  api.use(require('./modules/auth')(d));
  api.use(require('./modules/menu')(d));
  api.use(orders);
  api.use(require('./modules/offers')(d));
  api.use(require('./modules/feedback')(d));
  api.use(require('./modules/admin')(d));
  app.use('/api', api);
  app.use('/api', (req, res, next) => next(new HttpError(404, 'Not found')));

  app.use(errorHandler);
  app.expirePendingPayments = orders.expirePending;
  return app;
}

module.exports = { createApp };
