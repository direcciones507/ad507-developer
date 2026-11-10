import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareRemote, executeRemote } from './remote-runner.mjs';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

test('remote runner rejects mismatched execution identity before Docker or network',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'as-developer-identity-'));
  let calls=0;
  try{
    await writeFile(join(directory,'context.json'),JSON.stringify({
      origin:'https://controller.example',id,identity,snapshot:join(directory,'snapshot'),
      check:'typecheck',snapshotHash:'c'.repeat(64)
    }));
    await assert.rejects(executeRemote({
      directory,ticket,identity:{...identity,runId:'another-run'},
      fetchImpl:async()=>{calls++;throw Error('NETWORK_MUST_NOT_BE_CALLED');},
      execute:async()=>{calls++;throw Error('DOCKER_MUST_NOT_BE_CALLED');}
    }),/RUNNER_IDENTITY_REJECTED/);
    assert.equal(calls,0);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('remote runner rejects corrupted compressed snapshot before writing files',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'as-developer-corrupt-'));
  let calls=0;
  try{
    const fetchImpl=async url=>{
      calls++;
      if(url.endsWith('/claim'))return new Response(JSON.stringify({expectedSHA:identity.sha,snapshotHash:'c'.repeat(64),check:'typecheck'}),{status:200});
      if(url.endsWith('/snapshot'))return new Response(Buffer.from('not-a-gzip-snapshot'),{status:200});
      throw Error('UNEXPECTED_NETWORK_CALL');
    };
    await assert.rejects(prepareRemote({origin:'https://controller.example',id,ticket,identity,directory,fetchImpl}));
    assert.equal(calls,2);
    await assert.rejects(readFile(join(directory,'context.json')),{code:'ENOENT'});
  }finally{await rm(directory,{recursive:true,force:true});}
});
