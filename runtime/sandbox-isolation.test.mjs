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
    const result=await workspace.runSnapshot(snapshot,'12345678-1234-1234-1234-123456789abc','typecheck',new AbortController().signal);
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
