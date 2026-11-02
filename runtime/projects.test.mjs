import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {loadConfig,projectFor} from './config.mjs';
import {ProjectRegistry,normalizeProject,projectToken} from './projects.mjs';
import {Store} from './store.mjs';
import {Workspace,git} from './workspace.mjs';
import {Engine} from './engine.mjs';
import {Publisher} from './publisher.mjs';
import {SimulationProvider} from './provider.mjs';
import {createApp} from './server.mjs';
import {passwordHash} from './auth.mjs';
import {requireCheck} from './checks-policy.mjs';
async function setup(t,env={}){const root=await mkdtemp(join(tmpdir(),'ad507-projects-'));const c=loadConfig({AD507_DATA_DIR:root,AD507_PROVIDER:'simulation',...env});const s=new Store(root);c.registry=new ProjectRegistry(c,s);const w=new Workspace(c),e=new Engine(c,s,w,new SimulationProvider(),new Publisher(c,w));t.after(async()=>{await e.stop();try{s.close();}catch{}await rm(root,{recursive:true,force:true});});return {root,c,s,w,e};}
const input={id:'future-project',name:'Proyecto futuro',mode:'preparation',authorize:true};
test('owner registry persists additions without overwriting projects or duplicating registration on restart',async t=>{
 const {root,c,s}=await setup(t);const seedCount=Object.keys(loadConfig({}).projects).length;assert.equal(Object.keys(c.projects).length,seedCount);c.registry.register(input);assert.equal(c.projects['future-project'].repository,null);
 assert.throws(()=>c.registry.register(input),/ALREADY_REGISTERED/);s.close();const next=new Store(root);try{const c2=loadConfig({AD507_DATA_DIR:root});new ProjectRegistry(c2,next);assert.equal(c2.projects['future-project'].name,input.name);assert.equal(Object.keys(c2.projects).length,seedCount+1);assert.equal(next.events(null).length,0);assert.equal(next.db.prepare("SELECT COUNT(*) n FROM events WHERE kind='owner_project_authorized'").get().n,1);}finally{next.close();}
});
test('registration requires explicit authorization and rejects credential fields, invalid paths and protected permissions',async t=>{
 const {c}=await setup(t);assert.throws(()=>c.registry.register({...input,authorize:false}),/AUTHORIZATION/);
 for(const value of [{...input,tokenEnv:'DEEPSEEK_API_KEY'},{...input,source:'/etc'},{...input,mergeMain:true},{...input,repository:'https://github.com/evil/repo'},{...input,id:'../escape'},{...input,baseBranch:'main:refs/heads/main'},{...input,projectCap:1}])assert.throws(()=>c.registry.register(value));
 assert.throws(()=>c.registry.register({...input,repository:'direcciones507/Reportapa'}),/ALREADY_REGISTERED/);assert.throws(()=>projectFor(c,'radar'),/NOT_AUTHORIZED/);
});
test('project tokens never inherit another repository credential and checks are assigned per project',async t=>{
 const {c}=await setup(t,{AD507_GITHUB_TOKEN:'leveia-secret',AD507_PROJECT_REPORTAPA_GITHUB_TOKEN:'reportapa-secret'});
 assert.equal(projectToken(c,c.projects.leveia),'leveia-secret');assert.equal(projectToken(c,c.projects.reportapa),'reportapa-secret');assert.equal(projectToken(c,c.projects['empleos-pa']),undefined);
 assert.throws(()=>projectToken(c,{...c.projects.leveia,repository:'other/repository'}),/NOT_AUTHORIZED/);
 assert.throws(()=>requireCheck(c.projects.reportapa,'api-build'),/NOT_AUTHORIZED/);assert.deepEqual(requireCheck(c.projects.reportapa,'project-syntax'),['node','/opt/ad507-project-check.mjs']);assert.throws(()=>requireCheck(c.projects['junta-comunal-santiago'],'project-syntax'),/NOT_AUTHORIZED/);
});
test('two authorized repository checkouts and PR publishers keep origins, credentials and task files isolated',async t=>{
 const {root,c,s,w,e}=await setup(t,{AD507_PROJECT_REPORTAPA_GITHUB_TOKEN:'report-token',AD507_PROJECT_EMPLEOS_PA_GITHUB_TOKEN:'jobs-token'});c.publishing=true;
 const tasks=[];for(const id of ['reportapa','empleos-pa']){const p=c.projects[id],dir=join(root,id);await mkdir(dir);await git(dir,['init','-b','main']);await git(dir,['remote','add','origin',`https://github.com/${p.repository}.git`]);await writeFile(join(dir,'README.md'),id);await git(dir,['add','.']);await git(dir,['-c','user.name=test','-c','user.email=test@example.com','commit','-m','fixture']);p.source=dir;
  const task=e.create({project:id,instructions:'Prepare isolated test document'});await e.tick();const ready=s.get(task.id);assert.equal(ready.gate,'delivery');tasks.push(ready);
  const publisher=new Publisher(c,w,async(url,opts={})=>{assert.ok(url.startsWith(`https://api.github.com/repos/${p.repository}/`));assert.equal(opts.headers.Authorization,`Bearer ${id==='reportapa'?'report-token':'jobs-token'}`);if(url.includes('pulls?'))return Response.json([{state:'open',base:{ref:'main'},head:{ref:ready.branch,sha:'fixture'},html_url:`https://github.com/${p.repository}/pull/1`}]);throw Error('Unexpected write');});assert.match((await publisher.publish(ready,p,()=>{})).url,new RegExp(p.repository));
 }
 assert.notEqual(w.root(tasks[0]),w.root(tasks[1]));await w.write(tasks[0],c.projects.reportapa,'docs/only-report.md','private');await assert.rejects(w.read(tasks[1],'docs/only-report.md'));await assert.rejects(new Publisher(c,w).publish(tasks[0],c.projects['empleos-pa'],()=>{}),/NOT_AUTHORIZED/);
});
test('DeepSeek is the only live provider and global reservations cap combined project spend',async t=>{
 assert.throws(()=>loadConfig({AD507_PROVIDER:'openai'}),/DEEPSEEK_ONLY/);const defaults=loadConfig({});assert.equal(defaults.provider,'deepseek');assert.equal(defaults.live,false);assert.equal(defaults.model,'deepseek-flash');
 const {c,s}=await setup(t);c.registry.register(input);const a=s.create('junta-comunal-santiago','one',100,'simulation'),b=s.create('future-project','two',100,'simulation');s.reserve(a,2,100,3);s.reserve(b,1,100,3);assert.throws(()=>s.reserve(b,1,100,3),/BUDGET_EXHAUSTED/);assert.equal(s.globalUsage(),3);assert.equal(s.projectUsage('future-project'),1);
});
test('registry API is owner authenticated and CSRF protected; new projects immediately appear in selector data',async t=>{
 const {c,s,e}=await setup(t);c.ownerHash=passwordHash('fixture-owner-password-long');c.origin='http://127.0.0.1:8787';let app=createApp(c,s,e);app.listen(0,'127.0.0.1');await once(app,'listening');c.origin=`http://127.0.0.1:${app.address().port}`;await new Promise(r=>app.close(r));app=createApp(c,s,e);app.listen(Number(new URL(c.origin).port),'127.0.0.1');await once(app,'listening');t.after(()=>new Promise(r=>app.close(r)));
 const base={Origin:c.origin,'Content-Type':'application/json'};const post=(path,body,headers={})=>fetch(c.origin+path,{method:'POST',headers:{...base,...headers},body:JSON.stringify(body)});
 assert.equal((await post('/api/projects',input)).status,401);const login=await post('/api/login',{password:'fixture-owner-password-long'});const {csrf}=await login.json();const headers={Cookie:login.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':csrf};
 assert.equal((await post('/api/projects',input,{...headers,'X-CSRF-Token':'invalid'})).status,403);assert.equal((await post('/api/projects',{...input,authorize:false},headers)).status,400);assert.equal((await post('/api/projects',input,headers)).status,201);
 const status=await fetch(c.origin+'/api/status',{headers}).then(r=>r.json());assert.equal(status.projects.length,Object.keys(loadConfig({}).projects).length+1);assert.ok(status.projects.some(p=>p.id===input.id));assert.equal(JSON.stringify(status).includes('tokenEnv'),false);
 const task=await post('/api/tasks',{project:input.id,instructions:'Prepare a document'},headers);assert.equal(task.status,201);await e.tick();assert.equal(s.get((await task.json()).id).gate,'delivery');
});
