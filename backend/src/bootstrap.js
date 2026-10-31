'use strict';
// Wires the real services together. Shared by the local server and the Lambda handler.
const { loadConfig } = require('./config');
const { createApp } = require('./app');
const { createMongoStore } = require('./store/mongo');
const { createRazorpayGateway } = require('./integrations/razorpay');
const { createFirebase } = require('./integrations/firebase');
const { createDemoGateway } = require('./integrations/demo');

// On AWS Learner Lab there is no way to create secrets, so deploy-lab.js bundles the settings in
// lambda-env.json inside the (private) function package. Real environment variables win over it.
function loadBundledEnv(env) {
  try {
    const bundled = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'lambda-env.json'), 'utf8'));
    for (const [k, v] of Object.entries(bundled)) if (env[k] === undefined) env[k] = v;
  } catch {
    /* not running from a Lambda package */
  }
}

async function buildApp(env = process.env) {
  loadBundledEnv(env);
  const config = loadConfig(env);
  if (!config.mongoUri) throw new Error('MONGODB_URI is not set');
  const store = await createMongoStore(config.mongoUri, config.dbName);
  const firebase = createFirebase();
  return createApp({
    config,
    store,
    gateway: config.demoPayments ? createDemoGateway(store) : createRazorpayGateway(config.razorpay),
    notifier: firebase.notifier,
    verifyToken: firebase.verifyToken,
    revokeSession: firebase.revokeSession,
  });
}

module.exports = { buildApp };
