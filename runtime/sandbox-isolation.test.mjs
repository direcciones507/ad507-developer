import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace } from './workspace.mjs';

test('untrusted check runs only in restricted Docker and cleans its snapshot',async()=>{
  const root=await mkdtemp(join(tmpdir(),'as-developer-sandbox-'));
  const snapshot=join(root,'snapshot');
  await mkdir(snapshot);
  const calls=[];
  const containerExec=async (program,args,options)=>{
    calls.push({program,args,options});
    return {stdout:'OK',stderr:''};
  };
  try{
    const workspace=new Workspace({root,sandboxImage:'ad507-checks:remote',env:{},checkBackend:'local-docker'}, {containerExec});
    const result=await workspace.runSnapshot(snapshot,'12345678-1234-1234-1234-123456789abc','project-syntax',new AbortController().signal);
    assert.equal(result.passed,true);
    const run=calls.find(call=>call.args[0]==='run');
    assert.ok(run);
    assert.equal(run.program,'docker');
    for(const flag of ['--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--pids-limit=64','--memory=512m','--cpus=1','--user=1000:1000','--pull=never'])assert.ok(run.args.includes(flag),flag);
    assert.ok(run.args.includes('type=bind,src='+snapshot+',dst=/source,readonly'));
    assert.ok(!run.args.includes('--privileged'));
    assert.deepEqual(Object.keys(run.options.env),['PATH']);
    assert.ok(calls.some(call=>call.args[0]==='rm'&&call.args[1]==='-f'));
    await assert.rejects(import('node:fs/promises').then(fs=>fs.stat(snapshot)),{code:'ENOENT'});
  }finally{await rm(root,{recursive:true,force:true});}
});

test('failed isolated check stays failed, without host fallback, and removes snapshot',async()=>{
  const root=await mkdtemp(join(tmpdir(),'as-developer-failed-check-'));
  const snapshot=join(root,'snapshot');
  await mkdir(snapshot);
  const calls=[];
  const containerExec=async(program,args)=>{
    calls.push({program,args});
    if(args[0]==='run')throw Object.assign(Error('sandbox check failed'),{stdout:'',stderr:'TEST_FAILURE'});
    return {stdout:'',stderr:''};
  };
  try{
    const workspace=new Workspace({root,sandboxImage:'ad507-checks:remote',env:{},checkBackend:'local-docker'},{containerExec});
    const result=await workspace.runSnapshot(snapshot,'12345678-1234-1234-1234-123456789abc','project-syntax',new AbortController().signal);
    assert.equal(result.passed,false);
    assert.match(result.output,/TEST_FAILURE/);
    assert.deepEqual(calls.map(c=>c.program),['docker','docker']);
    assert.deepEqual(calls.map(c=>c.args[0]),['run','rm']);
    await assert.rejects(import('node:fs/promises').then(fs=>fs.stat(snapshot)),{code:'ENOENT'});
  }finally{await rm(root,{recursive:true,force:true});}
});

test('cancelled sandbox check never launches Docker and cleans its snapshot',async()=>{
  const root=await mkdtemp(join(tmpdir(),'as-developer-cancelled-'));
  const snapshot=join(root,'snapshot');
  await mkdir(snapshot);
  const calls=[];
  const workspace=new Workspace({root,sandboxImage:'ad507-checks:reviewed',env:{},checkBackend:'local-docker'},{
    containerExec:async(program,args)=>{calls.push([program,...args]);return {stdout:'',stderr:''};}
  });
  const controller=new AbortController();
  controller.abort();
  try{
    await assert.rejects(workspace.runSnapshot(snapshot,'12345678-1234-1234-1234-123456789abc','project-syntax',controller.signal),/CHECK_ABORTED/);
    assert.deepEqual(calls.map(c=>c[1]),['rm']);
    await assert.rejects(import('node:fs/promises').then(fs=>fs.stat(snapshot)),{code:'ENOENT'});
  }finally{await rm(root,{recursive:true,force:true});}
});

test('invalid check identity or name cleans snapshot without launching Docker',async()=>{
  const root=await mkdtemp(join(tmpdir(),'as-developer-invalid-check-'));
  const calls=[];
  try{
    const workspace=new Workspace({root,sandboxImage:'ad507-checks:reviewed',env:{},checkBackend:'local-docker'},{
      containerExec:async()=>{calls.push('docker');return {stdout:'',stderr:''};}
    });
    for(const [id,name] of [['invalid-id','project-syntax'],['12345678-1234-1234-1234-123456789abc','unknown-check']]){
      const snapshot=join(root,'snapshot-'+calls.length+'-'+name);await mkdir(snapshot);
      await assert.rejects(workspace.runSnapshot(snapshot,id,name),/INVALID_CHECK_ID|CHECK_NOT_ALLOWED|UNKNOWN_CHECK|CHECK_/);
      await assert.rejects(import('node:fs/promises').then(fs=>fs.stat(snapshot)),{code:'ENOENT'});
    }
    assert.deepEqual(calls,[]);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('sandbox runs without an AbortSignal and cleans up on failure',async()=>{
  const root=await mkdtemp(join(tmpdir(),'as-developer-no-signal-'));
  const snapshot=join(root,'snapshot');await mkdir(snapshot);
  const calls=[];
  try{
    const workspace=new Workspace({root,sandboxImage:'ad507-checks:reviewed',env:{},checkBackend:'local-docker'},{
      containerExec:async(_program,args)=>{calls.push(args[0]);if(args[0]==='run')throw Error('Docker unavailable');return {stdout:'',stderr:''};}
    });
    const result=await workspace.runSnapshot(snapshot,'12345678-1234-1234-1234-123456789abc','project-syntax');
    assert.equal(result.passed,false);
    assert.deepEqual(calls,['run','rm']);
    await assert.rejects(import('node:fs/promises').then(fs=>fs.stat(snapshot)),{code:'ENOENT'});
  }finally{await rm(root,{recursive:true,force:true});}
});
