'use strict';
// Firebase Authentication (REQ-1..4) and Cloud Messaging (REQ-22).
const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getMessaging } = require('firebase-admin/messaging');

function createFirebase() {
  if (!getApps().length) {
    // JSON string in .env, or serviceAccount.json bundled with the Lambda package. Never in git.
    let json = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!json) {
      try {
        json = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'serviceAccount.json'), 'utf8');
      } catch {
        /* fall back to application default credentials */
      }
    }
    initializeApp(json ? { credential: cert(JSON.parse(json)) } : undefined);
  }
  return {
    async verifyToken(token) {
      const t = await getAuth().verifyIdToken(token, true); // true = reject revoked sessions
      return { uid: t.uid, email: (t.email || '').toLowerCase() };
    },
    revokeSession: (uid) => getAuth().revokeRefreshTokens(uid),
    notifier: {
      async notifyOrderReady(user, order) {
        if (!user.fcmToken) return;
        await getMessaging().send({
          token: user.fcmToken,
          notification: { title: 'Your order is ready', body: `Token ${order.token} is ready for pickup` },
          data: { orderId: order.id },
        });
      },
    },
  };
}

module.exports = { createFirebase };
