// Tests the exact deployable image and a fresh persistent Docker volume on an ephemeral CI runner.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
import { passwordHash } from './auth.mjs';
const exec=promisify(execFile);const id=randomUUID();const name=`ad507-controller-${id}`,volume=`ad507-ci-volume-${id}`;
const docker=async args=>(await exec('docker',args,{timeout:60000,maxBuffer:1000000})).stdout;
const reserve=createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(r=>reserve.close(r));
const origin=`http://127.0.0.1:${port}`,password='ephemeral-controller-fixture-password';
async function healthy(){for(let i=0;i<100;i++){try{if((await fetch(origin+'/health')).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('CONTROLLER_HEALTH_FAILED');}
async function delivery(task,cookie){for(let i=0;i<100;i++){const t=await fetch(origin+`/api/tasks/${task}`,{headers:{Cookie:cookie}}).then(r=>r.json());if(t.state==='awaiting_approval')return t;if(t.state==='failed')throw Error(t.reason);await new Promise(r=>setTimeout(r,100));}throw Error('CONTROLLER_TASK_TIMEOUT');}
try{
 await docker(['volume','create',volume]);
 await docker(['run','-d','--name',name,'--network=host','--read-only','--tmpfs','/tmp:rw,nosuid,size=64m','--volume',`${volume}:/data`,
  '--env',`PORT=${port}`,'--env','AD507_HOST=127.0.0.1','--env',`AD507_ORIGIN=${origin}`,'--env',`AD507_OWNER_PASSWORD_HASH=${passwordHash(password)}`,'--env','AD507_PROVIDER=simulation','--env','AD507_CHECK_BACKEND=local-docker','ad507-controller:ci']);
 await healthy();const login=await fetch(origin+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password})});assert.equal(login.status,200);
 const {csrf}=await login.json(),cookie=login.headers.get('set-cookie').split(';')[0];
 const headers={Origin:origin,'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf};
 const task=await fetch(origin+'/api/tasks',{method:'POST',headers,body:JSON.stringify({project:'junta-comunal-santiago',instructions:'Preparar documentación, sin construir la web'})}).then(r=>r.json());
 const before=await delivery(task.id,cookie);assert.deepEqual(before.files,['docs/ad507-simulation.md']);
 const proc=await docker(['exec',name,'cat','/proc/1/status']);assert.match(proc,/Uid:\s+1000\s+1000/);
 assert.match((await docker(['exec',name,'stat','-c','%u:%g %a','/data/ad507'])).trim(),/^1000:1000 700$/);
 await docker(['restart',name]);await healthy();
 const restored=await fetch(origin+`/api/tasks/${task.id}`,{headers:{Cookie:cookie}}).then(r=>r.json());assert.equal(restored.state,'awaiting_approval');assert.equal(restored.branch,before.branch);
 const file=await fetch(origin+`/api/tasks/${task.id}/file?path=docs%2Fad507-simulation.md`,{headers:{Cookie:cookie}}).then(r=>r.json());assert.match(file.content,/AD507 Developer/);
 assert.equal((await fetch(origin+'/api/tasks')).status,401);
 const result=await fetch(origin+`/api/tasks/${task.id}/control`,{method:'POST',headers,body:JSON.stringify({action:'approve'})}).then(r=>r.json());assert.equal(result.state,'completed');
 console.log('PASS controller image: root-mounted private volume -> UID1000 -> task -> Docker restart -> SQLite/session/workspace survive -> approval');
}catch(error){console.error('CONTROLLER_IMAGE_TEST_FAILED',error.message);try{console.error((await docker(['logs',name])).slice(-3000));}catch{}throw error;}
finally{await docker(['rm','-f',name]).catch(()=>{});await docker(['volume','rm',volume]).catch(()=>{});}
