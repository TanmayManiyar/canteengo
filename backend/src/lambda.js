'use strict';
// AWS Lambda entry points. The app (and its Mongo connection) is cached across warm invocations.
const serverless = require('serverless-http');
const { buildApp } = require('./bootstrap');

let appPromise;
const getApp = () => (appPromise ||= buildApp());

let httpHandler;
// API Gateway (HTTP API) -> Express. `binary` off: bodies are JSON/text; webhook arrives as a raw Buffer.
exports.handler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  httpHandler ||= serverless(await getApp());
  return httpHandler(event, context);
};

// EventBridge Scheduler (rate(1 minute)): time out unpaid checkouts and free their slots (REQ-17).
exports.expirePayments = async () => {
  const app = await getApp();
  return { expired: await app.expirePendingPayments() };
};
