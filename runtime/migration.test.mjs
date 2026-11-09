import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadConfig} from './config.mjs';
import {ProjectRegistry} from './projects.mjs';
import {Store} from './store.mjs';
import {Workspace,git} from './workspace.mjs';
import {Engine,readOnlyTask} from './engine.mjs';
import {SimulationProvider} from './provider.mjs';

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'ad507-migrated-'));
 const c=loadConfig({AD507_DATA_DIR:root,AD507_PROVIDER:'simulation'});
 const s=new Store(root);new ProjectRegistry(c,s);const w=new Workspace(c),e=new Engine(c,s,w,new SimulationProvider());
 t.after(async()=>{await e.stop();try{s.close();}catch{}await rm(root,{recursive:true,force:true});});
 return {root,c,s,w,e};
}
const call=(name,args)=>({function:{name,arguments:JSON.stringify(args)}});

test('standalone config keeps all seeds and recovered Mi Contacto ref; Actions require explicit setup',()=>{
 const c=loadConfig({});assert.equal(c.live,false);assert.equal(c.checkBackend,'local-docker');
 assert.equal(c.projects['mi-contacto'].repository,'direcciones507/mi-contacto');
 assert.equal(c.projects['mi-contacto'].baseBranch,'recovery/mi-contacto-existing-20261101');
 for(const id of ['leveia','direcciones507','empleos-pa','reportapa','junta-comunal-santiago'])assert.ok(c.projects[id]);
 assert.equal(loadConfig({AD507_CHECK_BACKEND:'github-actions'}).checkBackend,'github-actions');
});
test('selection mismatch is rejected before a task or reservation exists',async t=>{
 const {e,s}=await fixture(t);
 assert.throws(()=>e.create({project:'mi-contacto',instructions:'Corregir direcciones507/Empleos-pa'}),/PROJECT_SELECTION_MISMATCH/);
 assert.equal(s.list().length,0);assert.equal(s.globalUsage(),0);
});
test('repeated read returns a reference without copying content and persists stop across checkpoints',async t=>{
 const {e,s,w,c}=await fixture(t);const task=e.create({project:'junta-comunal-santiago',instructions:'Preparar documentación institucional'});
 await e.tick();const j=s.get(task.id),p=c.projects[j.project];
 const tool=call('read_repository_file',{path:'docs/ad507-simulation.md'});
 let reads=0;const original=w.read.bind(w);w.read=async(...args)=>{reads++;return original(...args);};
 const first=await e.execute(j,p,tool,AbortSignal.timeout(1000));assert.match(first,/AS Developer/);s.save(j);
 const restored=s.get(j.id);const second=await e.execute(restored,p,tool,AbortSignal.timeout(1000));
 assert.equal(second.status,'already_read');assert.equal(reads,1);assert.equal(restored.noProgress,true);
 await e.execute(restored,p,call('write_repository_file',{path:'docs/ad507-simulation.md',content:'New revision'}),AbortSignal.timeout(1000));
 assert.equal(await e.execute(restored,p,tool,AbortSignal.timeout(1000)),'New revision');assert.equal(reads,2);
});
test('read-only task cannot mutate, skips checks, and production exclusions do not prevent valid local editing',async t=>{
 const {e,s,w,c}=await fixture(t);const task=e.create({project:'junta-comunal-santiago',instructions:'Preparar una nota'});await e.tick();
 const j=s.get(task.id),p=c.projects[j.project];j.instructions='Solo lectura: revisar archivos.';
 await assert.rejects(e.execute(j,p,call('write_repository_file',{path:'docs/blocked.md',content:'blocked'}),AbortSignal.timeout(1000)),/READ_ONLY_TASK/);
 await assert.rejects(e.execute(j,p,call('replace_repository_text',{path:'docs/ad507-simulation.md',oldText:'AD507',newText:'x'}),AbortSignal.timeout(1000)),/READ_ONLY_TASK/);
 w.diff=async()=>[];w.run=async()=>{throw Error('must not run');};
 assert.equal((await e.execute(j,p,call('run_safe_check',{check:'project-syntax'}),AbortSignal.timeout(1000))).reason,'READ_ONLY_DIAGNOSTIC_NO_CHECKS');
 assert.equal(readOnlyTask('Corregir el formulario. No modificar producción.'),false);
});
test('missing Docker stops a live edit before source fetch, provider call or budget reservation',async t=>{
 const {e,s,w,c}=await fixture(t);Object.assign(c,{provider:'deepseek',live:true,apiKey:'synthetic-test-value',inputRate:1,outputRate:1});
 let calls=0;e.provider={estimate:()=>{calls++;return 1;},next:async()=>{calls++;throw Error('must not call');}};
 w.containerExec=async()=>{const error=Error('missing');error.code='ENOENT';throw error;};
 const j=e.create({project:'mi-contacto',instructions:'Corregir un formulario local'});await e.tick();
 assert.equal(s.get(j.id).reason,'SANDBOX_NOT_AVAILABLE');assert.equal(calls,0);assert.equal(s.get(j.id).reserved,0);assert.equal(s.get(j.id).branch,null);
});
test('correct project Docker runner fails closed with security flags and never calls a host shell',async t=>{
 const {root,e,s,w,c}=await fixture(t);const p=c.projects['mi-contacto'],source=join(root,'source');await mkdir(source);
 await git(source,['init','-b','main']);await git(source,['remote','add','origin',`https://github.com/${p.repository}.git`]);
 await writeFile(join(source,'index.js'),'export const ok=true;');await git(source,['add','.']);await git(source,['-c','user.name=test','-c','user.email=test@example.com','commit','-m','fixture']);
 p.source=source;p.baseBranch='main';const task=s.create(p.id,'Test controlled code',100,'simulation');await w.prepare(task,p);
 let invocations=0;w.containerExec=async(command,args,options)=>{invocations++;assert.equal(command,'docker');assert.deepEqual(Object.keys(options.env),['PATH']);
  if(args[0]==='run'){for(const flag of ['--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--user=1000:1000'])assert.ok(args.includes(flag));}
  const error=Error('missing');error.code='ENOENT';throw error;};
 await assert.rejects(w.run(task,p,'project-test',AbortSignal.timeout(1000)),/SANDBOX_NOT_AVAILABLE/);assert.equal(invocations,2);
});
test('persisted custom projects, budgets, sessions and tasks survive independent config reload',async t=>{
 const {root,c,s}=await fixture(t);const registry=new ProjectRegistry(c,s);
 registry.register({id:'existing-custom',name:'Existing custom',repository:'direcciones507/Junta-Comunal-Santiago',mode:'development',authorize:true,taskCap:100,projectCap:300});
 const task=s.create('existing-custom','Persist fixture',100,'simulation');s.reserve(task,7,300,1000);
 s.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('synthetic-session','synthetic-csrf',Date.now()+10000);
 s.close();const next=new Store(root);try{const fresh=loadConfig({AD507_DATA_DIR:root});new ProjectRegistry(fresh,next);
  assert.equal(fresh.projects['existing-custom'].projectCap,300);assert.equal(next.get(task.id).reserved,7);assert.equal(next.globalUsage(),7);
  assert.equal(next.db.prepare('SELECT COUNT(*) n FROM sessions').get().n,1);
 }finally{next.close();}
});
