import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { createServer as reserveServer } from 'node:net';
import { Store } from './store.mjs';
import { Workspace, git } from './workspace.mjs';
import { loadConfig } from './config.mjs';
import { ActionsChecks } from './actions-checks.mjs';
import { createApp } from './server.mjs';
import { passwordHash } from './auth.mjs';
import { prepareRemote, executeRemote } from './remote-runner.mjs';
const sha='a'.repeat(40);
async function fixture(t, overrides={}){
  const root=await mkdtemp(join(tmpdir(),'ad507-actions-'));const source=join(root,'source');await mkdir(source);
  await git(source,['init','-b','main']);await git(source,['remote','add','origin','https://github.com/direcciones507/leveia.git']);await writeFile(join(source,'README.md'),'before\n');await git(source,['add','.']);await git(source,['-c','user.name=test','-c','user.email=test@example.com','commit','-m','fixture']);
  const c={...loadConfig({AD507_DATA_DIR:join(root,'data'),AD507_PROVIDER:'simulation',AD507_LEVEIA_SOURCE:source}),checkBackend:'github-actions',actionsToken:'fixture-token',actionsIncludedOnly:true,actionsSHA:sha,actionsRef:'ad507/task-developer-runtime',actionsMonthlyMinutes:60,actionsProjectMinutes:60,actionsTaskMinutes:30,...overrides};
  const s=new Store(c.root),w=new Workspace(c);const job=s.create('leveia','Remote fixture',250000,'simulation');await w.prepare(job,c.projects.leveia);job.state='running';s.save(job);
  const calls=[];const fetchImpl=async(url,options={})=>{calls.push({url,options});if(url.endsWith('/dispatches'))return Response.json({workflow_run_id:123});if(url.endsWith('/cancel'))return new Response(null,{status:204});
    if(url.endsWith('/actions/runs/123')){const record=JSON.parse(s.db.prepare('SELECT data FROM remote_checks ORDER BY rowid DESC LIMIT 1').get().data);return Response.json({head_sha:sha,head_branch:c.actionsRef,event:'workflow_dispatch',name:`AD507 check ${record.id}`,path:'.github/workflows/ad507-technology-agent-ci.yml',display_title:`AD507 check ${record.id}`,repository:{full_name:'direcciones507/leveia'}});}throw Error('unexpected URL');};
  let remote=new ActionsChecks(c,s,w,{fetchImpl,pollMs:5});w.remote=remote;
  t.after(async()=>{try{s.close();}catch{}await rm(root,{recursive:true,force:true});});
  return {root,c,s,w,job,remote,calls,fetchImpl};
}
async function dispatched(f){for(let i=0;i<200;i++){const rows=f.s.db.prepare('SELECT data FROM remote_checks').all();if(rows.length&&JSON.parse(rows[0].data).state==='queued')return JSON.parse(rows[0].data);await new Promise(r=>setTimeout(r,5));}throw Error('dispatch not observed');}
const identity={runId:'123',attempt:1,sha};
function receipt(j,passed=true){return {check:j.check,snapshotHash:j.snapshotHash,passed,output:'fixture check output'};}
test('remote check reserves minutes, validates GitHub identity and delivers a durable idempotent receipt',async t=>{
  const f=await fixture(t);const ac=new AbortController();const running=f.remote.run(f.job,f.c.projects.leveia,'agent-test',ac.signal);const j=await dispatched(f);
  assert.equal(f.remote.usage(),10);assert.equal(f.calls.filter(c=>c.url.endsWith('/dispatches')).length,1);
  await f.remote.claim(j.id,f.remote.ticket(j),identity);f.remote.complete(j.id,f.remote.ticket(j),identity,receipt(j));assert.equal((await running).passed,true);
  assert.equal(f.remote.complete(j.id,f.remote.ticket(j),identity,receipt(j)).duplicate,true);
  await f.remote.run(f.job,f.c.projects.leveia,'agent-test',new AbortController().signal);assert.equal(f.remote.usage(),10);assert.equal(f.calls.filter(c=>c.url.endsWith('/dispatches')).length,1);
  assert.throws(()=>f.remote.complete(j.id,f.remote.ticket(j),identity,{...receipt(j),passed:false}),/CONFLICT/);
});
test('pause/restart reuses remote job and persisted key, without another dispatch or reservation',async t=>{
  const f=await fixture(t);const abort=new AbortController();const running=f.remote.run(f.job,f.c.projects.leveia,'agent-test',abort.signal);const j=await dispatched(f);
  f.job.state='paused';f.s.save(f.job);abort.abort();await assert.rejects(running);
  const restarted=new ActionsChecks(f.c,f.s,f.w,{fetchImpl:f.fetchImpl,pollMs:5});assert.equal(restarted.ticket(j),f.remote.ticket(j));
  f.job.state='running';f.s.save(f.job);const resumed=restarted.run(f.job,f.c.projects.leveia,'agent-test',new AbortController().signal);
  await restarted.claim(j.id,restarted.ticket(j),identity);restarted.complete(j.id,restarted.ticket(j),identity,receipt(j));await resumed;
  assert.equal(f.calls.filter(c=>c.url.endsWith('/dispatches')).length,1);assert.equal(restarted.usage(),10);
});
test('cancel revokes callback ticket and only cancels the recorded run',async t=>{
  const f=await fixture(t);const ac=new AbortController();const running=f.remote.run(f.job,f.c.projects.leveia,'agent-test',ac.signal);const j=await dispatched(f);
  f.job.state='cancelled';f.s.save(f.job);ac.abort();await assert.rejects(running);
  assert.equal(f.remote.get(j.id).state,'cancelled');assert.throws(()=>f.remote.authenticate(j.id,f.remote.ticket(j)),/REVOKED/);
  assert.equal(f.calls.filter(c=>c.url.endsWith('/actions/runs/123/cancel')).length,1);
});
test('unconfirmed billing, missing tokens and exhausted minute caps prevent dispatch',async t=>{
  const f=await fixture(t,{actionsIncludedOnly:false});await assert.rejects(f.remote.run(f.job,f.c.projects.leveia,'agent-test',new AbortController().signal),/NOT_CONFIGURED/);assert.equal(f.calls.length,0);
  f.c.actionsIncludedOnly=true;f.c.actionsMonthlyMinutes=9;await assert.rejects(f.remote.run(f.job,f.c.projects.leveia,'agent-test',new AbortController().signal),/NOT_CONFIGURED/);
  f.c.actionsMonthlyMinutes=60;f.c.actionsProjectMinutes=9;await assert.rejects(f.remote.run(f.job,f.c.projects.leveia,'agent-test',new AbortController().signal),/MINUTES_EXHAUSTED/);assert.equal(f.remote.usage(),0);assert.equal(f.calls.length,0);
});
test('unknown dispatch outcome is quarantined, never automatically sent twice',async t=>{
  const f=await fixture(t);f.remote.fetch=async()=>{throw Error('network uncertainty');};
  await assert.rejects(f.remote.run(f.job,f.c.projects.leveia,'agent-test',new AbortController().signal),/DISPATCH_UNCERTAIN/);
  assert.equal(f.remote.taskJobs(f.job.id)[0].state,'unknown');assert.equal(f.remote.usage(),10);
  f.remote.fetch=f.fetchImpl;await assert.rejects(f.remote.run(f.job,f.c.projects.leveia,'agent-test',new AbortController().signal),/DISPATCH_UNCERTAIN/);assert.equal(f.calls.length,0);
});
test('expired, wrong-job, wrong-run, changed-SHA and rerun-attempt tickets are rejected',async t=>{
  const f=await fixture(t);const ac=new AbortController();const running=f.remote.run(f.job,f.c.projects.leveia,'agent-test',ac.signal);const j=await dispatched(f),ticket=f.remote.ticket(j);
  assert.throws(()=>f.remote.authenticate(j.id,'f'.repeat(64)),/UNAUTHORIZED/);
  await assert.rejects(f.remote.claim(j.id,ticket,{...identity,runId:'999'}),/REJECTED/);await assert.rejects(f.remote.claim(j.id,ticket,{...identity,attempt:2}),/REJECTED/);await assert.rejects(f.remote.claim(j.id,ticket,{...identity,sha:'b'.repeat(40)}),/REJECTED/);
  j.expires=Date.now()-1;f.remote.put(j);assert.throws(()=>f.remote.authenticate(j.id,ticket),/REVOKED/);ac.abort();await assert.rejects(running);
});
test('HTTP runner endpoints enforce ticket and preserve normal panel authentication',async t=>{
  const f=await fixture(t);f.c.ownerHash=passwordHash('private-http-fixture-password');
  const reserve=reserveServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(r=>reserve.close(r));f.c.origin=`http://127.0.0.1:${port}`;
  const app=createApp(f.c,f.s,{w:f.w});app.listen(port,'127.0.0.1');await once(app,'listening');t.after(()=>new Promise(r=>app.close(r)));
  const run=f.remote.run(f.job,f.c.projects.leveia,'agent-test',new AbortController().signal);const j=await dispatched(f);const ticket=f.remote.ticket(j);
  assert.equal((await fetch(`${f.c.origin}/api/runner/checks/${j.id}/snapshot`)).status,400);assert.equal((await fetch(`${f.c.origin}/api/tasks`)).status,401);
  const directory=join(f.root,'runner');const context=await prepareRemote({origin:f.c.origin,id:j.id,ticket,identity,directory,allowLocal:true});assert.equal(context.snapshotHash,j.snapshotHash);
  assert.equal(await readFile(join(context.snapshot,'README.md'),'utf8'),'before\n');
  let executions=0;const result=await executeRemote({directory,ticket,identity,allowLocal:true,execute:async(command,args)=>{assert.equal(command,'docker');if(args[0]==='run'){executions++;assert.ok(args.includes('--network=none'));assert.ok(args.includes('--read-only'));return {stdout:'simulated container receipt',stderr:''};}return {stdout:'',stderr:''};}});
  assert.equal(result.passed,true);assert.equal(executions,1);assert.equal((await run).passed,true);
});
test('remote receipt and minute ledger survive closing and reopening the actual SQLite database',async t=>{
 const f=await fixture(t);const ac=new AbortController();const waiting=f.remote.run(f.job,f.c.projects.leveia,'agent-test',ac.signal);const j=await dispatched(f),ticket=f.remote.ticket(j);
 f.job.state='paused';f.s.save(f.job);ac.abort();await assert.rejects(waiting);f.s.close();
 const reopened=new Store(f.c.root);try{
  const restored=new ActionsChecks(f.c,reopened,f.w,{pollMs:5,fetchImpl:async()=>Response.json({head_sha:sha,head_branch:f.c.actionsRef,event:'workflow_dispatch',name:`AD507 check ${j.id}`,path:'.github/workflows/ad507-technology-agent-ci.yml',display_title:`AD507 check ${j.id}`,repository:{full_name:'direcciones507/leveia'}})});
  assert.equal(restored.ticket(j),ticket);assert.equal(restored.usage(),10);await restored.claim(j.id,ticket,identity);restored.complete(j.id,ticket,identity,receipt(j));
  const task=reopened.get(f.job.id);task.state='running';reopened.save(task);assert.equal((await restored.run(task,f.c.projects.leveia,'agent-test',new AbortController().signal)).passed,true);assert.equal(restored.usage(),10);
 }finally{reopened.close();}
});
test('runner rejects a compressed traversal payload even when its supplied digest matches',async t=>{
 const {gzipSync}=await import('node:zlib');const {createHash}=await import('node:crypto');const root=await mkdtemp(join(tmpdir(),'ad507-traversal-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const id='12345678-1234-1234-1234-123456789012';const manifest={version:1,task:id,project:'leveia',check:'agent-test',revision:0,base:sha,files:[{path:'../escape.txt',content:Buffer.from('blocked').toString('base64')}]};
 const digest=createHash('sha256').update(JSON.stringify(manifest)).digest('hex');const payload={...manifest,job:id,snapshotHash:digest,expectedSHA:sha};
 await assert.rejects(prepareRemote({origin:'https://controller.invalid',id,ticket:'a'.repeat(64),identity,directory:root,fetchImpl:async url=>url.endsWith('/claim')?Response.json({snapshotHash:digest,expectedSHA:sha,check:'agent-test'}):new Response(gzipSync(Buffer.from(JSON.stringify(payload))))}),/PATH_NOT_AUTHORIZED/);
});

test('non-LEVEIA checks fail closed without reserving minutes or dispatching',async t=>{
  const f=await fixture(t);
  const project={...f.c.projects.leveia,id:'junta-comunal-santiago-web',repository:'direcciones507/Junta-Comunal-Santiago',checks:['project-syntax']};
  await assert.rejects(f.remote.run(f.job,project,'project-syntax',new AbortController().signal),/PROJECT_ACTIONS_RUNNER_NOT_CONFIGURED/);
  assert.equal(f.remote.usage(),0);
  assert.equal(f.calls.length,0);
  assert.equal(f.s.db.prepare('SELECT COUNT(*) AS n FROM remote_checks').get().n,0);
});
