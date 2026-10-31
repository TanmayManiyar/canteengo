'use strict';
// Copies serviceAccount.json into backend/.env as the one-line FIREBASE_SERVICE_ACCOUNT value.
// Never prints the key. Usage: node scripts/set-firebase-env.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const key = JSON.parse(fs.readFileSync(path.join(root, 'serviceAccount.json'), 'utf8'));
if (key.type !== 'service_account' || !key.private_key) throw new Error('serviceAccount.json is not a service-account key');

const envPath = path.join(root, '.env');
const line = `FIREBASE_SERVICE_ACCOUNT=${JSON.stringify(key)}`;
let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
env = /^FIREBASE_SERVICE_ACCOUNT=.*$/m.test(env)
  ? env.replace(/^FIREBASE_SERVICE_ACCOUNT=.*$/m, () => line)
  : env.trimEnd() + '\n' + line + '\n';
fs.writeFileSync(envPath, env);
console.log(`FIREBASE_SERVICE_ACCOUNT set in .env for project ${key.project_id}`);
