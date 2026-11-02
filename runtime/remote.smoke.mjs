// HISTORICAL OFFLINE PROTOCOL TEST ONLY; operational GitHub Actions backend is disabled.
// Ephemeral CI: real HTTP controller and Docker runner. GitHub dispatch/identity API is a fixture;
// no real provider key, public controller, long-lived token, billable Railway service or production access.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { Store } from './store.mjs';
import { Workspace, git } from './workspace.mjs';
import { loadConfig } from './config.mjs';
import { ActionsChecks } from './actions-checks.mjs';
import { createApp } from './server.mjs';
import { passwordHash } from './auth.mjs';
import { prepareRemote, executeRemote } from './remote-runner.mjs';
const root=await mkdtemp(join(tmpdir(),'ad507-remote-ci-'));const source=join(root,'source');await mkdir(source);
const repository=fileURLToPath(new URL('../',import.meta.url));
for(const path of ['runtime','src','config/projects.json','package.json','tsconfig.json']){await mkdir(dirname(join(source,path)),{recursive:true});await cp(join(repository,path),join(source,path),{recursive:true});}
await writeFile(join(source,'runtime/remote-boundary.test.mjs'),`
import test from 'node:test';import assert from 'node:assert/strict';import {readFile,access,writeFile} from 'node:fs/promises';import {networkInterfaces} from 'node:os';
test('remote snapshot revision is tested without controller secrets/network/host write access',async()=>{
 assert.equal(await readFile('/source/docs/remote-change.md','utf8'),'remote snapshot revision');assert.equal(process.getuid(),1000);
 assert.equal(Object.values(networkInterfaces()).flat().filter(x=>!x.internal).length,0);assert.equal(process.env.DEEPSEEK_API_KEY,undefined);assert.equal(process.env.AD507_GITHUB_TOKEN,undefined);
 await assert.rejects(access('/var/run/docker.sock'));await assert.rejects(access('/source/.git'));await assert.rejects(writeFile('/source/forbidden','x'));await assert.rejects(writeFile('/root-forbidden','x'));
});`);
await git(source,['init','-b','main']);await git(source,['remote','add','origin','https://github.com/direcciones507/leveia.git']);await git(source,['add','.']);await git(source,['-c','user.name=AD507 CI','-c','user.email=ad507-agent@users.noreply.github.com','commit','-m','Remote protocol fixture']);
const reserve=createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(r=>reserve.close(r));
const sha='a'.repeat(40);const c={...loadConfig({AD507_DATA_DIR:join(root,'data'),AD507_PROVIDER:'simulation',AD507_LEVEIA_SOURCE:source}),origin:`http://127.0.0.1:${port}`,ownerHash:passwordHash('ephemeral-ci-owner-password'),checkBackend:'github-actions',actionsToken:'fixture-only-token',actionsIncludedOnly:true,actionsMonthlyMinutes:10,actionsProjectMinutes:10,actionsTaskMinutes:10,actionsSHA:sha,actionsRef:'ad507/task-developer-runtime'};
const s=new Store(c.root),w=new Workspace(c);let dispatches=0;
const remote=new ActionsChecks(c,s,w,{pollMs:10,fetchImpl:async(url)=>{if(url.endsWith('/dispatches')){dispatches++;return Response.json({workflow_run_id:123});}
 const j=JSON.parse(s.db.prepare('SELECT data FROM remote_checks LIMIT 1').get().data);return Response.json({head_sha:sha,head_branch:c.actionsRef,event:'workflow_dispatch',name:`AD507 check ${j.id}`,path:'.github/workflows/ad507-technology-agent-ci.yml',display_title:`AD507 check ${j.id}`,repository:{full_name:'direcciones507/leveia'}});}});w.remote=remote;
const app=createApp(c,s,{w});app.listen(port,'127.0.0.1');await once(app,'listening');
try{
 const task=s.create('leveia','Remote CI fixture',100,'simulation');await w.prepare(task,c.projects.leveia);task.state='running';s.save(task);await w.write(task,c.projects.leveia,'docs/remote-change.md','remote snapshot revision');task.revision=1;s.save(task);
 const pending=w.run(task,c.projects.leveia,'agent-test',new AbortController().signal);
 let job;for(let i=0;i<200;i++){const rows=s.db.prepare('SELECT data FROM remote_checks LIMIT 1').all();if(rows.length&&JSON.parse(rows[0].data).state==='queued'){job=JSON.parse(rows[0].data);break;}await new Promise(r=>setTimeout(r,10));}assert.ok(job);
 const identity={runId:'123',attempt:1,sha};const directory=join(root,'runner');
 await prepareRemote({origin:c.origin,id:job.id,ticket:remote.ticket(job),identity,directory,allowLocal:true});
 const image=process.env.AD507_CI_CHECK_IMAGE||'ad507-checks:ci';
 const result=await executeRemote({directory,ticket:remote.ticket(job),identity,image,allowLocal:true});console.log(result.output);
 assert.equal((await pending).passed,true);assert.equal(remote.get(job.id).state,'completed');assert.equal(dispatches,1);
 await w.run(task,c.projects.leveia,'agent-test',new AbortController().signal);assert.equal(dispatches,1);assert.equal(remote.usage(),10);
 if(process.env.AD507_CI_CHECK_IMAGE){const local=new Workspace({...c,checkBackend:'local-docker',sandboxImage:image});const typed=await local.run(task,c.projects.leveia,'agent-typecheck',new AbortController().signal);console.log(typed.output);assert.equal(typed.passed,true);console.log('PASS reviewed full dependency image: agent typecheck with snapshot workspace links');
 const generic=await local.snapshot(task);await writeFile(join(generic,'fixture.mjs'),'export const value=1;');const checked=await local.runSnapshot(generic,'22222222-2222-4222-8222-222222222222','project-syntax',new AbortController().signal);assert.equal(checked.passed,true);console.log('PASS generic project syntax check in real isolated Docker');}
 console.log('PASS real HTTP -> immutable snapshot -> real isolated Docker -> callback -> durable receipt reuse');
}finally{await new Promise(r=>app.close(r));s.close();await rm(root,{recursive:true,force:true});}
