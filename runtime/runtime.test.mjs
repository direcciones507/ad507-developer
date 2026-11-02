import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,mkdir,writeFile,symlink,readFile,link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { Store } from './store.mjs';
import { loadConfig } from './config.mjs';
import { Workspace,git } from './workspace.mjs';
import { SimulationProvider,Provider,validateToolSequence } from './provider.mjs';
import { Publisher } from './publisher.mjs';
import { Engine } from './engine.mjs';
import { createApp } from './server.mjs';
import { passwordHash } from './auth.mjs';
async function fixture(t,overrides={}){
  const root=await mkdtemp(join(tmpdir(),'ad507-test-'));const c={...loadConfig({AD507_DATA_DIR:root,AD507_PROVIDER:'simulation'}),...overrides};
  const s=new Store(root),w=new Workspace(c),provider=new SimulationProvider();const e=new Engine(c,s,w,provider,new Publisher(c,w));
  t.after(async()=>{await e.stop();try{s.close();}catch{}await rm(root,{recursive:true,force:true});});return {c,s,w,e,root};
}
const task=e=>e.create({project:'junta-comunal-santiago',instructions:'Preparar documentación institucional sin construir la web.'});
test('task simulation creates real isolated Git branch and file, then awaits human review',async t=>{
  const {e,s,w}=await fixture(t);const job=task(e);assert.equal(job.state,'pending');await e.tick();const result=s.get(job.id);
  assert.equal(result.state,'awaiting_approval');assert.equal(result.gate,'delivery');assert.match(result.branch,/^ad507\/task-/);
  assert.deepEqual(result.files,['docs/ad507-simulation.md']);assert.match(await w.read(result,'docs/ad507-simulation.md'),/AD507 Developer/);
  assert.equal(await git(w.root(result),['branch','--show-current']),result.branch);
  assert.equal((await git(w.root(result),['show','main:docs/ad507-simulation.md']).catch(()=>'')),'');
  assert.equal(e.control(result.id,'approve').state,'completed');assert.equal(s.events(job.id).some(v=>v.kind==='owner_approve'),true);
});
test('SQLite survives real child process SIGKILL; interrupted mutation requires review and is not replayed',async t=>{
  const root=await mkdtemp(join(tmpdir(),'ad507-restart-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const moduleUrl=new URL('./store.mjs',import.meta.url).href;
  const child=spawn(process.execPath,['--input-type=module','-e',`import {Store} from ${JSON.stringify(moduleUrl)};const s=new Store(process.argv[1]);const t=s.create('leveia','persist',100,'simulation');t.state='running';t.phase='model';t.inflight={kind:'tool',name:'write_repository_file'};s.save(t);console.log(t.id);setInterval(()=>{},1000);`,root],{stdio:['ignore','pipe','pipe']});
  const id=await new Promise((resolve,reject)=>{child.stdout.once('data',v=>resolve(v.toString().trim()));child.once('error',reject);child.once('exit',code=>reject(Error('Child exited before checkpoint: '+code)));});child.kill('SIGKILL');await once(child,'exit');
  const s=new Store(root);try{const recovered=s.get(id);assert.equal(recovered.state,'awaiting_approval');assert.equal(recovered.gate,'recovery');assert.equal(recovered.inflight.kind,'tool');assert.equal(s.events(id).at(-1).kind,'recovery_required');}finally{s.close();}
});
test('single instance lock rejects a second runtime',async t=>{const {root}=await fixture(t);assert.throws(()=>new Store(root),/SINGLE_INSTANCE/);});
test('pause/resume pending task, then cancellation stops before model request',async t=>{
  const {e,s}=await fixture(t);const job=task(e);e.control(job.id,'pause');await e.tick();assert.equal(s.get(job.id).state,'paused');
  e.control(job.id,'resume');e.control(job.id,'cancel');await e.tick();assert.equal(s.get(job.id).state,'cancelled');assert.equal(s.get(job.id).reserved,0);
});
test('pause in-flight request aborts, keeps reservation and requires reviewed recovery',async t=>{
  const {e,s}=await fixture(t);let started;const begun=new Promise(r=>started=r);
  e.provider={estimate:()=>10,next:(_messages,signal)=>new Promise((resolve,reject)=>{started();signal.addEventListener('abort',()=>reject(Error('INTERRUPTED')),{once:true});})};
  const job=task(e);const running=e.tick();await begun;e.control(job.id,'pause');await running;
  assert.equal(s.get(job.id).state,'paused');assert.equal(s.get(job.id).reserved,10);e.control(job.id,'resume');assert.equal(s.get(job.id).gate,'recovery');
  e.control(job.id,'approve');e.provider=new SimulationProvider();await e.tick();assert.equal(s.get(job.id).gate,'delivery');
});
test('cancel in-flight request is durable and never auto-resumes',async t=>{
  const {e,s}=await fixture(t);let started;const begun=new Promise(r=>started=r);
  e.provider={estimate:()=>1,next:(_m,signal)=>new Promise((_,reject)=>{started();signal.addEventListener('abort',()=>reject(Error('CANCELLED')),{once:true});})};
  const job=task(e),running=e.tick();await begun;e.control(job.id,'cancel');await running;assert.equal(s.get(job.id).state,'cancelled');await e.tick();assert.equal(s.get(job.id).reserved,1);
});
test('task and lifetime project caps are reserved transactionally before calls',async t=>{
  const {e,s,c}=await fixture(t);c.projects['junta-comunal-santiago'].projectCap=3;
  const first=e.create({project:'junta-comunal-santiago',instructions:'Prepare docs',budget:2});await e.tick();assert.equal(s.get(first.id).reason,'BUDGET_EXHAUSTED');assert.equal(s.get(first.id).reserved,2);
  const second=e.create({project:'junta-comunal-santiago',instructions:'Prepare docs',budget:3});await e.tick();assert.equal(s.get(second.id).reserved,1);assert.equal(s.projectUsage(second.project),3);
});
test('protected instructions cannot be approved into production and other projects are denied',async t=>{
  const {e}=await fixture(t);for(const project of ['radar','jedidias','anything'])assert.throws(()=>e.create({project,instructions:'Build a page'}),/PROJECT_NOT_AUTHORIZED/);
  const job=e.create({project:'leveia',instructions:'Merge this PR to main and deploy production'});assert.equal(job.gate,'scope');assert.throws(()=>e.control(job.id,'approve'),/PROTECTED_OPERATION/);
  assert.throws(()=>e.create({project:'leveia',instructions:'Use sk-abcdefghijklmnopqrstuvwxyz123456'}),/SECRETS/);
});
test('path traversal, symlinks, hardlinks, control files, main writes and Junta construction blocked',async t=>{
  const {e,s,w,c,root}=await fixture(t);const job=task(e);await e.tick();const j=s.get(job.id),p=c.projects[j.project];
  for(const path of ['../outside','/etc/passwd','.git/config','.env','docs/../a','src/page.html','.github/workflows/deploy.yml'])await assert.rejects(w.write(j,p,path,'x'));
  await writeFile(join(root,'external.txt'),'outside');await link(join(root,'external.txt'),join(w.root(j),'docs','hardlink.txt'));await assert.rejects(w.read(j,'docs/hardlink.txt'),/LINK/);
  await symlink(root,join(w.root(j),'docs','escape'));await assert.rejects(w.write(j,p,'docs/escape/out','x'),/LINK/);
  await git(w.root(j),['switch','main']);await assert.rejects(w.write(j,p,'docs/x.md','x'),/PROTECTED_BRANCH/);
});
test('projects have independent workspace roots and data cannot be traversed between jobs',async t=>{
  const {e,s,w,c,root}=await fixture(t);const one=task(e);await e.tick();const two=task(e);await e.tick();
  assert.notEqual(w.root(one),w.root(two));const j=s.get(one.id);await w.write(j,c.projects[j.project],'docs/private.md','one');
  await assert.rejects(w.read(s.get(two.id),'docs/private.md'));await assert.rejects(w.read(j,`../../${two.id}/docs/private.md`));
  // LEVEIA source must match allowlisted origin, and clones never mutate source/main.
  const source=join(root,'source');await mkdir(source);await git(source,['init','-b','main']);await git(source,['remote','add','origin','https://github.com/direcciones507/leveia.git']);
  await writeFile(join(source,'README.md'),'original');await git(source,['add','README.md']);await git(source,['-c','user.name=test','-c','user.email=test@example.com','commit','-m','fixture']);
  c.projects.leveia.source=source;const leveia=e.create({project:'leveia',instructions:'Prepare test documentation'});await e.tick();const l=s.get(leveia.id);
  assert.equal(await readFile(join(source,'README.md'),'utf8'),'original');assert.equal(await git(source,['branch','--show-current']),'main');assert.notEqual(w.root(l),w.root(j));
});
test('unknown model tools are critical failures, not executed shell commands',async t=>{
  const {e,s}=await fixture(t);e.provider={estimate:()=>1,next:async()=>({message:{role:'assistant',tool_calls:[{id:'x',function:{name:'exec_shell',arguments:'{"command":"rm -rf /"}'}}]}})};
  const j=task(e);await e.tick();assert.equal(s.get(j.id).reason,'TOOL_BLOCKED_OR_FAILED');
});
test('DeepSeek adapter uses configured provider only, validates output and never retries paid calls',async()=>{
  let n=0;const config={provider:'deepseek',live:true,apiKey:'test-private-key',model:'fixture-model',inputRate:1,outputRate:2,maxOutput:128};
  const provider=new Provider(config,async(url,opts)=>{n++;assert.equal(url,'https://api.deepseek.com/chat/completions');assert.equal(opts.headers.Authorization,'Bearer test-private-key');assert.equal(JSON.parse(opts.body).model,'fixture-model');assert.equal(JSON.parse(opts.body).thinking,undefined);return new Response(JSON.stringify({choices:[{message:{role:'assistant',content:'OK'}}],usage:{prompt_tokens:1,completion_tokens:1}}));});
  assert.ok(provider.estimate([{role:'user',content:'hello'}])>256);const r=await provider.next([],AbortSignal.timeout(1000));assert.equal(r.message.content,'OK');assert.equal(n,1);
  const denied=new Provider(config,async()=>new Response('private body',{status:401}));await assert.rejects(denied.next([],AbortSignal.timeout(1000)),/PROVIDER_HTTP_401/);
  const missing=new Provider({...config,apiKey:undefined},()=>{throw Error('MUST_NOT_CALL');});await assert.rejects(missing.next([],AbortSignal.timeout(1000)),/NOT_CONFIGURED/);
  const openai=new Provider({...config,provider:'openai'},async()=>{throw Error('MUST_NOT_CALL');});await assert.rejects(openai.next([],AbortSignal.timeout(1000)),/DEEPSEEK_ONLY/);
});
test('PR preparation uses allowlisted repo, task ref and draft; retry reuses existing PR',async t=>{
  const {e,s,w,c,root}=await fixture(t);const source=join(root,'publish-source');await mkdir(source);await git(source,['init','-b','main']);await git(source,['remote','add','origin','https://github.com/direcciones507/leveia.git']);await git(source,['-c','user.name=test','-c','user.email=test@example.com','commit','--allow-empty','-m','fixture']);c.projects.leveia.source=source;
  const job=e.create({project:'leveia',instructions:'Prepare a test document'});await e.tick();const j=s.get(job.id);const p=c.projects.leveia;c.publishing=true;c.env={AD507_LEVEIA_GITHUB_TOKEN:'fixture-only'};
  const calls=[];const fake=async(url,opts={})=>{const body=opts.body?JSON.parse(opts.body):null;calls.push({url,method:opts.method||'GET',body});
    if(url.includes('/pulls?'))return Response.json([]);if(url.includes('/git/ref/heads/'))return new Response('',{status:404});
    if(url.includes('/git/commits/')&&(!opts.method||opts.method==='GET'))return Response.json({tree:{sha:'base-tree'}});
    if(url.endsWith('/git/trees'))return Response.json({sha:'new-tree'});if(url.endsWith('/git/commits'))return Response.json({sha:'new-commit'});
    if(url.endsWith('/git/refs'))return Response.json({ref:body.ref});if(url.endsWith('/pulls'))return Response.json({html_url:'https://github.com/direcciones507/leveia/pull/999'});throw Error(url);};
  const publisher=new Publisher(c,w,fake);const delivery=await publisher.publish(j,p,()=>{});assert.match(delivery.url,/999/);
  const ref=calls.find(c=>c.url.endsWith('/git/refs'));assert.equal(ref.body.ref,`refs/heads/${j.branch}`);assert.equal(calls.find(c=>c.url.endsWith('/pulls')).body.draft,true);
  assert.equal(calls.some(c=>c.method==='PATCH'),false);let writes=0;
  const retry=new Publisher(c,w,async(_url,opts={})=>{if(opts.method&&opts.method!=='GET')writes++;return Response.json([{state:'open',base:{ref:'main'},head:{ref:j.branch,sha:'saved'},html_url:delivery.url}]);});
  assert.equal((await retry.publish(j,p,()=>{})).sha,'saved');assert.equal(writes,0);
});
test('private API login, CSRF, task creation, file delivery and persistence',async t=>{
  const password='fixture-password-very-long';const {e,s,c}=await fixture(t,{ownerHash:passwordHash(password)});
  const app=createApp(c,s,e);app.listen(0,'127.0.0.1');await once(app,'listening');c.origin=`http://127.0.0.1:${app.address().port}`;
  // createApp validates Host against its configured origin: use a fresh server on reserved port.
  await new Promise(r=>app.close(r));const server=createApp(c,s,e);server.listen(Number(new URL(c.origin).port),'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
  const get=path=>fetch(c.origin+path);assert.equal((await get('/api/tasks')).status,401);
  const headers={'Content-Type':'application/json',Origin:c.origin};const login=await fetch(c.origin+'/api/login',{method:'POST',headers,body:JSON.stringify({password})});assert.equal(login.status,200);
  const {csrf}=await login.json();const cookie=login.headers.get('set-cookie').split(';')[0];assert.match(login.headers.get('set-cookie'),/HttpOnly/);assert.match(login.headers.get('set-cookie'),/SameSite=Strict/);
  const request=(path,data,extra={})=>fetch(c.origin+path,{method:'POST',headers:{...headers,Cookie:cookie,'X-CSRF-Token':csrf,...extra},body:JSON.stringify(data)});
  assert.equal((await request('/api/tasks',{},{'X-CSRF-Token':'bad'})).status,403);
  assert.equal((await request('/api/tasks',{}, {Origin:'https://evil.example'})).status,403);
  const response=await request('/api/tasks',{project:'junta-comunal-santiago',instructions:'Prepare a documentation fixture'});assert.equal(response.status,201);const job=await response.json();await e.tick();
  const list=await fetch(c.origin+'/api/tasks',{headers:{Cookie:cookie}}).then(r=>r.json());assert.equal(list.length,1);assert.equal('messages' in list[0],false);
  assert.equal((await request(`/api/tasks/${job.id}/control`,{action:'approve'})).status,200);assert.equal(s.get(job.id).state,'completed');
});
test('Docker checks cannot be assigned a different project registry identity',async t=>{
  const {e,w,s,c}=await fixture(t);const job=task(e);await e.tick();const j=s.get(job.id);const project={...c.projects.leveia};
  w.containerExec=async(command,args)=>{assert.equal(command,'docker');if(args[0]==='run'){assert.ok(args.includes('--network=none'));assert.ok(args.includes('--cap-drop=ALL'));assert.equal(args.some(a=>a.includes('DEEPSEEK_API_KEY')),false);}const error=Error('missing');error.code='ENOENT';throw error;};
  await assert.rejects(w.run(j,project,'agent-test',new AbortController().signal),/PROJECT_NOT_AUTHORIZED/);
});
test('missing live credentials do not create workspaces or spend',async t=>{
  const {e,s,c}=await fixture(t);c.provider='deepseek';c.live=true;c.model='fixture';c.inputRate=1;c.outputRate=1;
  const j=e.create({project:'junta-comunal-santiago',instructions:'Prepare documentation'});await e.tick();assert.equal(s.get(j.id).reason,'PROVIDER_NOT_CONFIGURED');assert.equal(s.get(j.id).reserved,0);assert.equal(s.get(j.id).branch,null);
});
test('standalone server persists authenticated tasks across a real restart and works without an open browser',async t=>{
  const root=await mkdtemp(join(tmpdir(),'ad507-server-'));const net=await import('node:net');const reserve=net.createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(r=>reserve.close(r));
  const origin=`http://127.0.0.1:${port}`,password='standalone-fixture-password';let child;
  const start=async()=>{child=spawn(process.execPath,[new URL('./main.mjs',import.meta.url).pathname],{env:{...process.env,AD507_DATA_DIR:root,AD507_PROVIDER:'simulation',AD507_OWNER_PASSWORD_HASH:passwordHash(password),AD507_ORIGIN:origin,PORT:String(port)},stdio:['ignore','pipe','pipe']});
    await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('exit',code=>reject(Error('server exited '+code)));child.once('error',reject);});};
  const stop=async()=>{if(child&&child.exitCode===null){child.kill('SIGKILL');await once(child,'exit');}};
  t.after(async()=>{await stop();await rm(root,{recursive:true,force:true});});await start();
  const login=await fetch(origin+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password})});const {csrf}=await login.json();const cookie=login.headers.get('set-cookie').split(';')[0];
  const headers={Origin:origin,'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf};
  const response=await fetch(origin+'/api/tasks',{method:'POST',headers,body:JSON.stringify({project:'junta-comunal-santiago',instructions:'Prepare persistent server documentation'})});const job=await response.json();assert.equal(response.status,201);
  await fetch(origin+`/api/tasks/${job.id}/control`,{method:'POST',headers,body:JSON.stringify({action:'pause'})});await stop();await start();
  const restored=await fetch(origin+`/api/tasks/${job.id}`,{headers:{Cookie:cookie}}).then(r=>r.json());assert.equal(restored.state,'paused');
  await fetch(origin+`/api/tasks/${job.id}/control`,{method:'POST',headers,body:JSON.stringify({action:'resume'})});
  let final;for(let i=0;i<40;i++){final=await fetch(origin+`/api/tasks/${job.id}`,{headers:{Cookie:cookie}}).then(r=>r.json());if(final.state==='awaiting_approval')break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(final.state,'awaiting_approval');assert.deepEqual(final.files,['docs/ad507-simulation.md']);
});
test('literal patch preserves surrounding code and refuses ambiguous replacement',async t=>{
  const {e,w,s,c}=await fixture(t);const job=task(e);await e.tick();const j=s.get(job.id),p=c.projects[j.project];
  await w.write(j,p,'docs/patch.md','before\nunique old\nafter\n');await w.replace(j,p,'docs/patch.md','unique old','new');assert.equal(await w.read(j,'docs/patch.md'),'before\nnew\nafter\n');
  assert.equal((await w.replace(j,p,'docs/patch.md','missing','new')).error,'MATCH_MUST_BE_UNIQUE');
});
test('graceful server stop also preserves an approval-required recovery point',async t=>{
  const {e,s}=await fixture(t);let start;const begun=new Promise(r=>start=r);
  e.provider={estimate:()=>1,next:(_m,signal)=>new Promise((_,reject)=>{start();signal.addEventListener('abort',()=>reject(Error('STOP')),{once:true});})};
  const j=task(e),run=e.tick();await begun;await e.stop();await run;assert.equal(s.get(j.id).state,'awaiting_approval');assert.equal(s.get(j.id).gate,'recovery');
});
test('late provider response cannot overwrite a cancellation',async t=>{
  const {e,s}=await fixture(t);let begin,finish;const begun=new Promise(r=>begin=r);
  e.provider={estimate:()=>1,next:async()=>{begin();return new Promise(resolve=>finish=resolve);}};
  const j=task(e),run=e.tick();await begun;e.control(j.id,'cancel');finish({message:{role:'assistant',content:'late final'},usage:{}});await run;
  assert.equal(s.get(j.id).state,'cancelled');assert.equal(s.events(j.id).some(e=>e.kind==='delivery_ready'),false);
});

test('multiple tools retain the original assistant calls through execution and SQLite checkpoints',async t=>{
  const {e,s}=await fixture(t);let turn=0;
  const calls=['list_repository_files','inspect_diff'].map((name,i)=>({id:`batch-${i}`,type:'function',function:{name,arguments:JSON.stringify(i===0?{query:''}:{})}}));
  e.provider={estimate:()=>1,next:async messages=>{
    if(turn++===0)return {message:{role:'assistant',content:null,tool_calls:structuredClone(calls)}};
    assert.deepEqual(messages.at(-3).tool_calls,calls);
    assert.deepEqual(messages.slice(-2).map(m=>m.tool_call_id),calls.map(c=>c.id));
    return {message:{role:'assistant',content:'Verified batch.'}};
  }};
  const job=task(e);await e.tick();const saved=s.get(job.id);
  assert.equal(saved.state,'awaiting_approval',saved.reason);
  assert.deepEqual(saved.messages.find(m=>m.tool_calls).tool_calls,calls);
  assert.equal(s.events(job.id).filter(e=>e.kind==='tool_completed').length,2);
});

test('tool sequence rejects orphan, missing, duplicate and out-of-order responses before HTTP',async()=>{
  const calls=['a','b'].map(id=>({id,type:'function',function:{name:'inspect_diff',arguments:'{}'}}));
  const assistant={role:'assistant',content:null,tool_calls:calls};
  const result=id=>({role:'tool',tool_call_id:id,content:'[]'});
  const valid=[assistant,result('a'),result('b')];
  assert.doesNotThrow(()=>validateToolSequence(valid));
  for(const messages of [[result('a')],[assistant,result('a')],[assistant,result('b'),result('a')],[...valid,result('b')],[assistant,{role:'user',content:'continue'}],[{...assistant,tool_calls:[calls[0],calls[0]]}]]){
    assert.throws(()=>validateToolSequence(messages),/INVALID_TOOL_SEQUENCE/);
    const p=new Provider({provider:'deepseek',live:true,apiKey:'fixture',model:'deepseek-chat'},()=>{throw Error('HTTP_MUST_NOT_RUN');});
    await assert.rejects(p.next(messages),/INVALID_TOOL_SEQUENCE/);
  }
});
test('corrupt persisted history stops before reserving budget or sending a request',async t=>{
  const {e,s}=await fixture(t);const job=task(e);job.phase='model';job.messages=[{role:'assistant',content:null,tool_calls:[]},{role:'tool',tool_call_id:'lost',content:'[]'}];s.save(job);
  e.provider={estimate:()=>{throw Error('MUST_NOT_RESERVE');},next:()=>{throw Error('MUST_NOT_SEND');}};
  await e.tick();assert.equal(s.get(job.id).reason,'INVALID_TOOL_SEQUENCE');assert.equal(s.get(job.id).reserved,0);
});
test('a paused multi-tool batch resumes from SQLite without repeating the completed call',async t=>{
  const {e,s,c,w,root}=await fixture(t);let completed=0;
  const original=e.execute.bind(e);e.execute=async(...args)=>{const result=await original(...args);if(++completed===1)e.control(args[0].id,'pause');return result;};
  const calls=['list_repository_files','inspect_diff'].map((name,i)=>({id:`persist-${i}`,type:'function',function:{name,arguments:JSON.stringify(i===0?{query:''}:{})}}));
  e.provider={estimate:()=>1,next:async()=>({message:{role:'assistant',content:null,tool_calls:calls}})};
  const job=task(e);await e.tick();assert.equal(s.get(job.id).state,'paused');assert.equal(s.get(job.id).pendingCalls.length,1);s.close();
  const reopened=new Store(root);t.after(()=>reopened.close());
  const resumed=new Engine(c,reopened,w,{estimate:()=>1,next:async messages=>{
    validateToolSequence(messages);assert.deepEqual(messages.find(m=>m.tool_calls).tool_calls,calls);
    return {message:{role:'assistant',content:'Recovered batch.'}};
  }},e.publisher);
  resumed.control(job.id,'resume');await resumed.tick();assert.equal(reopened.get(job.id).gate,'delivery');
  assert.deepEqual(reopened.events(job.id).filter(x=>x.kind==='tool_completed').map(x=>x.detail.tool),['list_repository_files','inspect_diff']);
});
test('listing inventory, wildcard aliases and unmatched filters differ from the modified-file audit',async t=>{
  const {e,s,w,c}=await fixture(t);const job=task(e);await e.tick();const j=s.get(job.id),p=c.projects[j.project];
  for(const query of ['', '*','**/*','.'])assert.deepEqual(await w.list(j,query),['docs/ad507-simulation.md']);
  const result=await e.execute(j,p,{function:{name:'list_repository_files',arguments:'{"query":"does-not-exist"}'}},new AbortController().signal);
  assert.equal(result.status,'no_matches');assert.equal(result.totalFiles,1);assert.equal(result.matchedCount,0);
  const listing=s.events(job.id).find(e=>e.kind==='tool_completed'&&e.detail.tool==='list_repository_files');
  assert.equal(listing.detail.listing.status,'empty_workspace');assert.equal(listing.detail.listing.totalFiles,0);
  assert.ok(s.events(job.id).some(e=>e.kind==='repository_snapshot'&&e.detail.branch===j.branch));
});
test('missing file is recoverable but missing checkout is a read error, never an empty inventory',async t=>{
  const {e,s,w,c}=await fixture(t);const job=task(e);await e.tick();const j=s.get(job.id);
  const result=await e.execute(j,c.projects[j.project],{function:{name:'read_repository_file',arguments:'{"path":"absent.md"}'}},new AbortController().signal);
  assert.equal(result.status,'not_found');
  await rm(w.root(j),{recursive:true,force:true});await assert.rejects(w.list(j),/REPOSITORY_READ_FAILED/);await assert.rejects(w.read(j,'README.md'),/REPOSITORY_READ_FAILED/);
});
test('unchanged repeated inventory stops before a third paid reservation, including after SQLite checkpoint',async t=>{
  const {e,s}=await fixture(t);let turns=0;
  e.provider={estimate:()=>1,next:async()=>({message:{role:'assistant',content:null,tool_calls:[{id:'repeat-'+(++turns),type:'function',function:{name:'list_repository_files',arguments:'{"query":""}'}}]}})};
  const job=task(e);await e.tick();const j=s.get(job.id);assert.equal(j.reason,'NO_PROGRESS');assert.equal(j.reserved,2);assert.equal(turns,2);assert.equal(j.noProgress,true);
});
test('three distinct empty filters stop the model loop without a fourth reservation',async t=>{
  const {e,s}=await fixture(t);let turns=0;
  e.provider={estimate:()=>1,next:async()=>({message:{role:'assistant',content:null,tool_calls:[{id:'empty-'+(++turns),type:'function',function:{name:'list_repository_files',arguments:JSON.stringify({query:'absent-'+turns})}}]}})};
  const job=task(e);await e.tick();assert.equal(s.get(job.id).reason,'NO_PROGRESS');assert.equal(s.get(job.id).reserved,3);assert.equal(turns,3);
});
test('a local preparation project cannot silently execute instructions targeting an authorized GitHub repository',async t=>{
  const {e,s,c}=await fixture(t);c.projects['junta-web']={...c.projects.leveia,id:'junta-web',name:'Junta Comunal de Santiago · repositorio',repository:'direcciones507/Junta-Comunal-Santiago',enabled:true};
  assert.throws(()=>e.create({project:'junta-comunal-santiago',instructions:'Desarrollar direcciones507/Junta-Comunal-Santiago en main como base.'}),/PROJECT_SELECTION_MISMATCH/);
  assert.equal(s.list().length,0);assert.equal(s.globalUsage(),0);
});
