import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareRemote } from './remote-runner.mjs';

const id='12345678-1234-1234-1234-123456789abc';
const ticket='a'.repeat(64);
const identity={runId:'123',attempt:1,sha:'b'.repeat(40)};
test('remote runner rejects insecure or credential-bearing controller origins before network',async()=>{
  let calls=0;const fetchImpl=async()=>{calls++;throw Error('NETWORK_MUST_NOT_BE_CALLED');};
  for(const origin of ['http://example.com','https://user:pass@example.com','https://example.com/path','https://example.com/','https://example.com?x=1']){
    await assert.rejects(prepareRemote({origin,id,ticket,identity,directory:'/tmp/not-used',fetchImpl}),/RUNNER_HTTPS_ORIGIN_REQUIRED/);
  }
  assert.equal(calls,0);
});
test('remote runner rejects invalid capability and job id before network',async()=>{
  let calls=0;const fetchImpl=async()=>{calls++;throw Error('NETWORK_MUST_NOT_BE_CALLED');};
  for(const inputs of [{id:'../escape',ticket},{id,ticket:'bad'}]){
    await assert.rejects(prepareRemote({origin:'https://controller.example',...inputs,identity,directory:'/tmp/not-used',fetchImpl}),/RUNNER_INPUT_INVALID/);
  }
  assert.equal(calls,0);
});
