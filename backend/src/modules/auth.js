'use strict';
const { Router } = require('express');
const { HttpError } = require('../lib/errors');
const { requireUser } = require('../middleware/auth');

const publicUser = (u) => ({ id: u.id, email: u.email, role: u.role, name: u.name });

module.exports = function authRoutes({ store, config, revokeSession, now, authCache }) {
  const r = Router();
  const users = store.col('users');

  // REQ-1: create the backend user (default role Student) for a verified Firebase identity.
  r.post('/auth/register', async (req, res) => {
    if (req.user) return res.json(publicUser(req.user));
    const email = req.claims.email;
    if (!email) throw new HttpError(400, 'Token has no email address');
    // SRS 5.6: only college email addresses may register.
    if (config.collegeEmailDomain && !email.endsWith('@' + config.collegeEmailDomain)) {
      throw new HttpError(403, `Registration requires a @${config.collegeEmailDomain} email`);
    }
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 80) : '';
    const role = config.ownerEmail && email === config.ownerEmail ? 'owner' : 'student';
    let user;
    try {
      user = await users.insert({ uid: req.claims.uid, email, name, role, createdAt: now() });
    } catch (err) {
      if (err.code !== 11000) throw err; // two sign-up requests raced: the other one won, return its record
      return res.json(publicUser(await users.findOne({ uid: req.claims.uid })));
    }
    res.status(201).json(publicUser(user));
  });

  r.get('/me', requireUser, (req, res) => res.json(publicUser(req.user)));

  // Student device token for order-ready push notifications.
  r.put('/me/fcm-token', requireUser, async (req, res) => {
    const token = req.body?.token;
    if (typeof token !== 'string' || !token) throw new HttpError(400, 'token is required');
    await users.update(req.user.id, { fcmToken: token });
    res.status(204).end();
  });

  // REQ-4: invalidate the session so the token can no longer be used.
  r.post('/auth/logout', requireUser, async (req, res) => {
    await revokeSession(req.user.uid);
    authCache.invalidate(req.user.uid);
    res.status(204).end();
  });

  return r;
};
