'use strict';

function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT) || 4000,
    mongoUri: env.MONGODB_URI,
    dbName: env.MONGODB_DB || 'canteengo',
    corsOrigin: env.CORS_ORIGIN ? env.CORS_ORIGIN.split(',') : true,
    // Business rules (SRS 5.6, REQ-17)
    collegeEmailDomain: (env.COLLEGE_EMAIL_DOMAIN || '').toLowerCase(),
    ownerEmail: (env.OWNER_EMAIL || '').toLowerCase(),
    authCacheMs: env.AUTH_CACHE_MS === undefined ? 30_000 : Number(env.AUTH_CACHE_MS),
    paymentTimeoutMs: Number(env.PAYMENT_TIMEOUT_MS) || 5 * 60 * 1000,
    cancelWindowMs: Number(env.CANCEL_WINDOW_MS) || 2 * 60 * 1000,
    // Demo gateway is used when Razorpay keys are absent, or when DEMO_PAYMENTS=true.
    demoPayments: env.DEMO_PAYMENTS === 'true' || !env.RAZORPAY_KEY_ID,
    razorpay: {
      keyId: env.RAZORPAY_KEY_ID,
      keySecret: env.RAZORPAY_KEY_SECRET,
      webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
    },
  };
}

module.exports = { loadConfig };
