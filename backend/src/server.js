'use strict';
const { buildApp } = require('./bootstrap');
const { loadConfig } = require('./config');

buildApp()
  .then((app) => {
    const { port } = loadConfig();
    app.listen(port, () => console.log(`CanteenGo API listening on :${port}`));
    // Local stand-in for the EventBridge schedule used in AWS.
    setInterval(() => app.expirePendingPayments().catch(console.error), 60 * 1000).unref();
  })
  .catch((err) => {
    console.error('Failed to start', err);
    process.exit(1);
  });
