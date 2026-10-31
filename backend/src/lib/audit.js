'use strict';

// SRS 5.3: administrative actions are logged with the acting user and a timestamp.
async function audit(store, user, action, target, now) {
  await store.col('audit').insert({ userId: user.id, email: user.email, action, target, at: now() });
}

module.exports = { audit };
