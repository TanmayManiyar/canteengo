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
    // Pickup times. Defaults mean "no opening-hours restriction"; set OPEN_HOUR/CLOSE_HOUR (e.g. 8 and 18) to enforce them.
    timezone: env.CANTEEN_TIMEZONE || 'Asia/Kolkata',
    openHour: env.OPEN_HOUR === undefined ? 0 : Number(env.OPEN_HOUR),
    closeHour: env.CLOSE_HOUR === undefined ? 24 : Number(env.CLOSE_HOUR),
    pickupLeadMs: (env.PICKUP_LEAD_MINUTES === undefined ? 10 : Number(env.PICKUP_LEAD_MINUTES)) * 60 * 1000,
    // Rush estimate: how many orders the kitchen can work on at once, and minutes of preparation per order.
    kitchenCapacity: Number(env.KITCHEN_CAPACITY) || 10,
    prepMinutesPerOrder: env.PREP_MINUTES_PER_ORDER === undefined ? 2 : Number(env.PREP_MINUTES_PER_ORDER),
    defaultSlotCapacity: Number(env.DEFAULT_SLOT_CAPACITY) || 12,
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
