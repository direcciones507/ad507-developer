import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Workspace, validatePath } from './workspace.mjs';
import { requireCheck } from './checks-policy.mjs';
const fingerprint = value => createHash('sha256').update(value).digest('hex');
function controllerOrigin(origin, allowLocal) {
  const url = new URL(origin);
  if (url.origin !== origin || url.username || url.password || (url.protocol !== 'https:' && !(allowLocal && url.protocol === 'http:' && ['127.0.0.1','localhost'].includes(url.hostname)))) throw Error('RUNNER_HTTPS_ORIGIN_REQUIRED');
  return url.origin;
}
async function bytes(response, limit) {
  let size=0;const output=[];const reader=response.body.getReader();
  try { for (;;) {const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw Error('RUNNER_RESPONSE_LIMIT');output.push(Buffer.from(value));} }
  finally {await reader.cancel().catch(()=>{});}return Buffer.concat(output);
}
function connection(origin, id, ticket, fetchImpl) {
  if (!/^[a-f0-9-]{36}$/.test(id) || !/^[a-f0-9]{64}$/.test(ticket)) throw Error('RUNNER_INPUT_INVALID');
  return async (operation, method, body, runId) => {
    const response = await fetchImpl(`${origin}/api/runner/checks/${id}/${operation}`, { method, redirect:'error',signal:AbortSignal.timeout(30000),
      headers:{Authorization:`Bearer ${ticket}`,'Content-Type':'application/json',...(runId?{'X-AD507-Run-ID':String(runId)}:{})},body:body?JSON.stringify(body):undefined});
    if(!response.ok){const e=Error(`RUNNER_HTTP_${response.status}`);e.status=response.status;throw e;}return response;
  };
}
export async function prepareRemote({origin,id,ticket,identity,directory,allowLocal=false,fetchImpl=fetch}) {
  origin=controllerOrigin(origin,allowLocal);
  const request=connection(origin,id,ticket,fetchImpl);
  const claim=await request('claim','POST',identity).then(async r=>JSON.parse((await bytes(r,16000)).toString('utf8')));
  const compressed=await request('snapshot','GET',undefined,identity.runId).then(r=>bytes(r,16000000));
  const payload=JSON.parse(gunzipSync(compressed,{maxOutputLength:24000000}).toString('utf8'));
  if(payload.version!==1||payload.job!==id||!/^[a-z][a-z0-9-]{1,63}$/.test(payload.project)||payload.expectedSHA!==identity.sha||claim.expectedSHA!==identity.sha||!Array.isArray(payload.files)||payload.files.length>3000||!Number.isSafeInteger(payload.revision)||payload.revision<0||!/^[a-f0-9]{40}$/.test(payload.base))throw Error('RUNNER_PAYLOAD_REJECTED');
  requireCheck({mode:'development'},payload.check);
  const manifest={version:payload.version,task:payload.task,project:payload.project,check:payload.check,revision:payload.revision,base:payload.base,files:payload.files};
  if(fingerprint(JSON.stringify(manifest))!==claim.snapshotHash||payload.snapshotHash!==claim.snapshotHash||claim.check!==payload.check)throw Error('RUNNER_SNAPSHOT_MISMATCH');
  await mkdir(directory,{recursive:true,mode:0o700});const snapshot=await mkdtemp(join(directory,'payload-'));
  // A bind-mounted snapshot must be readable by the container's unprivileged user.
  const {chmod}=await import('node:fs/promises');await chmod(snapshot,0o755);
  try {
    const seen=new Set();let total=0;
    for(const file of payload.files){validatePath(file.path);if(seen.has(file.path)||typeof file.content!=='string')throw Error('RUNNER_PAYLOAD_REJECTED');seen.add(file.path);
      const content=Buffer.from(file.content,'base64');if(content.toString('base64')!==file.content||content.length>8000000||(total+=content.length)>32000000)throw Error('RUNNER_PAYLOAD_REJECTED');
      const target=join(snapshot,file.path);await mkdir(dirname(target),{recursive:true,mode:0o755});await writeFile(target,content,{flag:'wx',mode:0o644});}
    const context={origin,id,identity,snapshot,check:payload.check,snapshotHash:payload.snapshotHash};
    await writeFile(join(directory,'context.json'),JSON.stringify(context),{mode:0o600});return context;
  }catch(error){await rm(snapshot,{recursive:true,force:true});throw error;}
}
export async function executeRemote({directory,ticket,identity,image='ad507-checks:remote',fetchImpl=fetch,execute,allowLocal=false}) {
  const context=JSON.parse(await readFile(join(directory,'context.json'),'utf8'));
  controllerOrigin(context.origin,allowLocal);
  if(JSON.stringify(context.identity)!==JSON.stringify(identity))throw Error('RUNNER_IDENTITY_REJECTED');
  const request=connection(context.origin,context.id,ticket,fetchImpl);
  const workspace=new Workspace({root:directory,sandboxImage:image,env:{}},execute?{containerExec:execute}:{});
  const result=await workspace.runSnapshot(context.snapshot,context.id,context.check,AbortSignal.timeout(150000));
  // Docker is run exactly once. Only delivery of the same bounded receipt can retry after controller restart.
  const body={identity,result:{check:context.check,snapshotHash:context.snapshotHash,passed:result.passed,output:result.output}};
  await writeFile(join(directory,'result.json'),JSON.stringify(body),{mode:0o600});
  for(let attempt=0;;attempt++){
    try{await request('complete','POST',body);break;}catch(error){if(attempt>=7||(error.status&&error.status<500))throw error;await new Promise(r=>setTimeout(r,Math.min(500*2**attempt,10000)));}
  }
  return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const event=JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH,'utf8'));
  const ticket=event.inputs?.remote_ticket;const id=event.inputs?.remote_job;
  if(typeof ticket!=='string'||!/^[a-f0-9]{64}$/.test(ticket))throw Error('RUNNER_INPUT_INVALID');
  // Read the capability from the event file, not a step env value that the runner would print before masking.
  console.log('::add-mask::'+ticket);
  const identity={runId:String(process.env.GITHUB_RUN_ID||''),attempt:Number(process.env.GITHUB_RUN_ATTEMPT),sha:process.env.GITHUB_SHA};
  const directory=process.env.AD507_RUNNER_DIRECTORY;
  if(!directory)throw Error('RUNNER_DIRECTORY_REQUIRED');
  if(process.argv[2]==='prepare')await prepareRemote({origin:process.env.AD507_CONTROLLER_ORIGIN,id,ticket,identity,directory});
  else if(process.argv[2]==='execute'){const result=await executeRemote({directory,ticket,identity});console.log(`REMOTE_CHECK_COMPLETED: ${result.check} ${result.passed?'PASS':'FAIL'}`);if(!result.passed)process.exitCode=1;}
  else throw Error('RUNNER_COMMAND_REQUIRED');
}
