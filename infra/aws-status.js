'use strict';
// Prints a summary of the CanteenGo resources in the AWS account, for demonstrations.
//   node infra/aws-status.js          show the resources
//   node infra/aws-status.js --logs   also stream live Lambda logs (Ctrl+C to stop)
const { spawnSync, spawn } = require('child_process');

const REGION = 'us-east-1';
const PATH = `C:\\Program Files\\Amazon\\AWSCLIV2;${process.env.PATH}`;
const env = { ...process.env, AWS_DEFAULT_REGION: REGION, PATH, MSYS_NO_PATHCONV: '1' };

function aws(args) {
  const r = spawnSync(`aws ${args}`, { shell: true, encoding: 'utf8', env });
  if (r.status !== 0) throw new Error((r.stderr || r.stdout).trim().split('\n')[0]);
  return r.stdout.trim();
}
const json = (args) => JSON.parse(aws(`${args} --output json`));
const line = (label, value) => console.log(`  ${label.padEnd(18)} ${value}`);
const title = (t) => console.log(`\n${t}\n${'-'.repeat(t.length)}`);

try {
  const id = json('sts get-caller-identity');
  title('AWS account');
  line('Account', id.Account);
  line('Signed in as', id.Arn.split('/').slice(-2).join('/'));
  line('Region', REGION);

  title('CloudFormation stack (infrastructure as code)');
  const stack = json('cloudformation describe-stacks --stack-name canteengo-api').Stacks[0];
  line('Stack', stack.StackName);
  line('Status', stack.StackStatus);
  line('Created', stack.CreationTime);
  const resources = json('cloudformation describe-stack-resources --stack-name canteengo-api').StackResources;
  for (const r of resources) line(r.ResourceType.replace('AWS::', ''), `${r.PhysicalResourceId} (${r.ResourceStatus})`);

  title('AWS Lambda (the CanteenGo API)');
  const fnName = resources.find((r) => r.ResourceType === 'AWS::Lambda::Function').PhysicalResourceId;
  const fn = json(`lambda get-function-configuration --function-name ${fnName}`);
  line('Function', fn.FunctionName);
  line('Runtime', fn.Runtime);
  line('Memory / timeout', `${fn.MemorySize} MB / ${fn.Timeout} s`);
  line('Handler', fn.Handler);
  line('Package size', `${(fn.CodeSize / 1048576).toFixed(1)} MB`);
  line('Last modified', fn.LastModified);
  line('Execution role', fn.Role.split('/').pop());
  const url = json(`lambda get-function-url-config --function-name ${fnName}`).FunctionUrl;
  line('Public API URL', url);

  const end = new Date();
  const start = new Date(end.getTime() - 24 * 3600 * 1000);
  const sum = (metric) => {
    const d = json(
      `cloudwatch get-metric-statistics --namespace AWS/Lambda --metric-name ${metric} --dimensions Name=FunctionName,Value=${fnName} ` +
        `--start-time ${start.toISOString()} --end-time ${end.toISOString()} --period 86400 --statistics Sum`
    );
    return d.Datapoints.reduce((s, p) => s + p.Sum, 0);
  };
  line('Invocations (24 h)', Math.round(sum('Invocations')));
  line('Errors (24 h)', Math.round(sum('Errors')));

  title('Amazon S3 (the website)');
  const bucket = `canteengo-web-${id.Account}`;
  const objs = json(`s3api list-objects-v2 --bucket ${bucket}`).Contents || [];
  line('Bucket', bucket);
  line('Files', `${objs.length} (${(objs.reduce((s, o) => s + o.Size, 0) / 1024).toFixed(0)} KB)`);
  line('Website URL', `http://${bucket}.s3-website-${REGION}.amazonaws.com`);

  title('Live health check');
  const t0 = Date.now();
  fetch(`${url}health`)
    .then(async (r) => {
      line('GET /health', `${r.status} ${await r.text()} in ${Date.now() - t0} ms`);
      if (process.argv.includes('--logs')) {
        console.log(`\nStreaming logs from /aws/lambda/${fnName} (Ctrl+C to stop)...\n`);
        spawn(`aws logs tail /aws/lambda/${fnName} --follow --format short`, { shell: true, stdio: 'inherit', env });
      }
    })
    .catch((e) => line('GET /health', `failed: ${e.message}`));
} catch (e) {
  console.error('\nCould not read AWS resources:', e.message);
  console.error('If the credentials expired, start the lab again and refresh C:\\Users\\Tanmay\\.aws\\credentials');
  process.exit(1);
}
