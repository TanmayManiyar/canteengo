'use strict';
// Deploys CanteenGo to an AWS Academy Learner Lab account.
//   node infra/deploy-lab.js backend    -> Lambda + Function URL (stack canteengo-api)
//   node infra/deploy-lab.js frontend   -> builds the web app and hosts it on S3
// Needs the lab credentials in ~/.aws/credentials (they change every time the lab restarts).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const REGION = 'us-east-1';
const STACK = 'canteengo-api';
const env = {
  ...process.env,
  AWS_DEFAULT_REGION: REGION,
  PATH: `C:\\Program Files\\Amazon\\AWSCLIV2;C:\\Program Files\\Amazon\\AWSSAMCLI\\bin;${process.env.PATH}`,
};

function run(cmd, { cwd = ROOT, capture = false, extraEnv = {} } = {}) {
  const r = spawnSync(cmd, { cwd, shell: true, encoding: 'utf8', env: { ...env, ...extraEnv }, stdio: capture ? 'pipe' : 'inherit' });
  if (r.status !== 0) {
    if (capture) console.error(r.stdout, r.stderr);
    throw new Error(`Command failed: ${cmd.split(' ').slice(0, 3).join(' ')}`);
  }
  return capture ? r.stdout.trim() : '';
}

function parseEnvFile(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const accountId = () => run('aws sts get-caller-identity --query Account --output text', { capture: true });
const bucketName = () => `canteengo-web-${accountId()}`;
const siteUrl = () => `http://${bucketName()}.s3-website-${REGION}.amazonaws.com`;
const apiUrl = () =>
  run(`aws cloudformation describe-stacks --stack-name ${STACK} --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text`, { capture: true }).replace(/\/$/, '');

function backend() {
  const cfg = parseEnvFile(path.join(ROOT, 'backend', '.env'));
  if (!cfg.MONGODB_URI || cfg.MONGODB_URI.includes('PASTE_DB_PASSWORD')) throw new Error('Set MONGODB_URI in backend/.env first');
  if (!fs.existsSync(path.join(ROOT, 'backend', 'serviceAccount.json'))) throw new Error('backend/serviceAccount.json is missing');

  // Stage a clean package: source + production dependencies only (no tests, no .env).
  const stage = path.join(__dirname, '.build', 'backend');
  fs.rmSync(path.join(__dirname, '.build'), { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  fs.cpSync(path.join(ROOT, 'backend', 'src'), path.join(stage, 'src'), { recursive: true });
  for (const f of ['package.json', 'package-lock.json', 'serviceAccount.json']) fs.copyFileSync(path.join(ROOT, 'backend', f), path.join(stage, f));
  const bundled = {
    MONGODB_URI: cfg.MONGODB_URI,
    MONGODB_DB: cfg.MONGODB_DB || 'canteengo',
    COLLEGE_EMAIL_DOMAIN: cfg.COLLEGE_EMAIL_DOMAIN,
    OWNER_EMAIL: cfg.OWNER_EMAIL,
    CORS_ORIGIN: `${siteUrl()},http://localhost:5173`,
    DEMO_PAYMENTS: 'true',
  };
  fs.writeFileSync(path.join(stage, 'lambda-env.json'), JSON.stringify(bundled));
  console.log('Installing production dependencies...');
  run('npm ci --omit=dev --no-audit --no-fund', { cwd: stage });

  console.log('Deploying stack...');
  run(
    `sam deploy --template-file infra/template.learner-lab.yaml --stack-name ${STACK} --region ${REGION} ` +
      '--resolve-s3 --no-confirm-changeset --no-fail-on-empty-changeset'
  );
  console.log(`\nAPI URL: ${apiUrl()}\nSite URL (after frontend deploy): ${siteUrl()}`);
}

function frontend() {
  const bucket = bucketName();
  const api = apiUrl();
  const site = path.join(ROOT, 'frontend');

  console.log('Building the web app against', api);
  const fbEnv = parseEnvFile(path.join(site, '.env'));
  run('npm run build', { cwd: site, extraEnv: { ...fbEnv, VITE_API_URL: api } });

  console.log('Preparing bucket', bucket);
  try {
    run(`aws s3api head-bucket --bucket ${bucket}`, { capture: true });
  } catch {
    run(`aws s3api create-bucket --bucket ${bucket} --region ${REGION}`);
  }
  run(`aws s3api put-public-access-block --bucket ${bucket} --public-access-block-configuration BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false`);
  const policy = JSON.stringify({
    Version: '2012-10-17',
    Statement: [{ Sid: 'PublicRead', Effect: 'Allow', Principal: '*', Action: 's3:GetObject', Resource: `arn:aws:s3:::${bucket}/*` }],
  });
  const policyFile = path.join(__dirname, '.build', 'policy.json');
  fs.mkdirSync(path.dirname(policyFile), { recursive: true });
  fs.writeFileSync(policyFile, policy);
  // relative path: the repo folder name contains spaces, which break file:// URIs
  run(`aws s3api put-bucket-policy --bucket ${bucket} --policy file://${path.relative(ROOT, policyFile).replace(/\\/g, '/')}`);
  run(`aws s3 website s3://${bucket}/ --index-document index.html --error-document index.html`);
  run(`aws s3 sync "${path.join(site, 'dist')}" s3://${bucket}/ --delete`);
  console.log(`\nLive at: ${siteUrl()}`);
}

const step = process.argv[2];
try {
  if (step === 'backend') backend();
  else if (step === 'frontend') frontend();
  else console.log('Usage: node infra/deploy-lab.js backend|frontend');
} catch (e) {
  console.error('\nDeploy failed:', e.message);
  process.exit(1);
}
