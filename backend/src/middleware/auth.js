'use strict';
const { HttpError } = require('../lib/errors');

// Short-lived cache of verified tokens and user records. Verifying a Firebase token (with its revocation
// check) and loading the user are two network round trips on every request; caching them for a few seconds
// removes most of the latency. Role changes and logout invalidate the entry immediately.
function createAuthCache(ttlMs = 30_000, now = Date.now) {
  const tokens = new Map(); // token -> { claims, until }
  const users = new Map(); // uid -> { user, until }
  const live = (e) => e && e.until > now();
  return {
    token: (t) => (live(tokens.get(t)) ? tokens.get(t).claims : null),
    setToken(t, claims) {
      if (ttlMs > 0) tokens.set(t, { claims, until: now() + ttlMs });
    },
    user: (uid) => (live(users.get(uid)) ? users.get(uid).user : undefined),
    setUser(uid, user) {
      if (ttlMs > 0 && user) users.set(uid, { user, until: now() + ttlMs });
    },
    invalidate(uid) {
      users.delete(uid);
      for (const [t, e] of tokens) if (e.claims.uid === uid) tokens.delete(t);
    },
  };
}

// REQ-2 / REQ-3: verify the Firebase ID token on every request; reject missing/invalid/expired.
function authenticate({ verifyToken, store, authCache }) {
  return async (req, res, next) => {
    const m = (req.headers.authorization || '').match(/^Bearer (.+)$/);
    if (!m) throw new HttpError(401, 'Missing authorization token');
    let claims = authCache.token(m[1]);
    if (!claims) {
      try {
        claims = await verifyToken(m[1]);
      } catch {
        throw new HttpError(401, 'Invalid or expired token');
      }
      authCache.setToken(m[1], claims);
    }
    req.claims = claims;
    let user = authCache.user(claims.uid);
    if (user === undefined) {
      user = await store.col('users').findOne({ uid: claims.uid });
      authCache.setUser(claims.uid, user); // unregistered users are not cached, so sign-up shows up at once
    }
    req.user = user;
    next();
  };
}

const requireUser = (req, res, next) => {
  if (!req.user) throw new HttpError(403, 'Account not registered');
  next();
};

// SRS 5.3: role-based authorization on every endpoint.
const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!req.user) throw new HttpError(403, 'Account not registered');
    if (!roles.includes(req.user.role)) throw new HttpError(403, 'Insufficient permissions');
    next();
  };

const STAFF = ['staff', 'owner'];

module.exports = { authenticate, createAuthCache, requireUser, requireRole, STAFF };
