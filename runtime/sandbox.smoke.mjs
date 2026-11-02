// Runs on an ephemeral Docker-capable CI host. Never invokes a paid model or publishes a repo.
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,cp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';
import { Store } from './store.mjs';
import { Workspace,git } from './workspace.mjs';
const root=await mkdtemp(join(tmpdir(),'ad507-docker-ci-'));const source=join(root,'source');await mkdir(source);
const repository=fileURLToPath(new URL('../',import.meta.url));
for(const path of ['runtime','src','config/projects.json']){
  await mkdir(dirname(join(source,path)),{recursive:true});await cp(join(repository,path),join(source,path),{recursive:true});
}
// A real check proves that runtime secrets and writable source/host access are absent.
await writeFile(join(source,'runtime/sandbox-boundary.test.mjs'),`
import test from 'node:test';import assert from 'node:assert/strict';import {writeFile,access} from 'node:fs/promises';import {networkInterfaces} from 'node:os';
test('actual sandbox has no network, token, root user, git metadata or writable source',async()=>{
  assert.equal(process.getuid(),1000);assert.equal(Object.values(networkInterfaces()).flat().filter(x=>!x.internal).length,0);assert.equal(process.env.AD507_ISOLATION_MARKER,undefined);
  assert.equal(process.env.DEEPSEEK_API_KEY,undefined);assert.equal(process.env.GITHUB_TOKEN,undefined);
  await assert.rejects(access('/source/.git'));await assert.rejects(access('/var/run/docker.sock'));
  await assert.rejects(writeFile('/source/escape.txt','blocked'));await assert.rejects(writeFile('/root-escape.txt','blocked'));
  await assert.rejects(fetch('https://example.invalid',{signal:AbortSignal.timeout(2000)}));
});
`);
await git(source,['init','-b','main']);await git(source,['remote','add','origin','https://github.com/direcciones507/ad507-developer.git']);
await git(source,['add','.']);await git(source,['-c','user.name=AD507 CI','-c','user.email=ad507-agent@users.noreply.github.com','commit','-m','Isolated sandbox fixture']);
const c=loadConfig({AD507_DATA_DIR:join(root,'data'),AD507_PROVIDER:'simulation',AD507_SANDBOX_IMAGE:'ad507-checks:ci'});
c.projects['ad507-developer']={id:'ad507-developer',name:'AD507 Developer',enabled:true,mode:'development',repository:'direcciones507/ad507-developer',baseBranch:'main',checks:['standalone-agent-test'],source};
const store=new Store(c.root),workspace=new Workspace(c);
process.env.AD507_ISOLATION_MARKER='CONTROLLER_ONLY_NOT_A_SECRET';
try{
  const task=store.create('ad507-developer','Run isolated runtime checks',100,'simulation');await workspace.prepare(task,c.projects['ad507-developer']);
  const check=await workspace.run(task,c.projects['ad507-developer'],'standalone-agent-test',new AbortController().signal);
  console.log(check.output);assert.equal(check.passed,true,'Actual Docker check failed');console.log('PASS real Docker boundary + runtime checks; no provider or publication');
}finally{delete process.env.AD507_ISOLATION_MARKER;store.close();await rm(root,{recursive:true,force:true});}
