import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, realpath, lstat, readdir, readFile, writeFile, mkdtemp, copyFile, rm, chmod } from 'node:fs/promises';
import { resolve, join, sep, dirname } from 'node:path';
import { TASK_BRANCH } from './config.mjs';
import { requireCheck } from './checks-policy.mjs';
import { SourceCache } from './source-cache.mjs';
import { registeredProject } from './projects.mjs';
const exec=promisify(execFile);
const gitEnv={PATH:process.env.PATH,HOME:'/nonexistent',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',LANG:'C.UTF-8'};
export async function git(root,args){return (await exec('git',['-c','core.hooksPath=/dev/null','-c','protocol.file.allow=always',...args],{cwd:root,env:gitEnv,timeout:30000,maxBuffer:1024*1024})).stdout.trim();}
const forbidden = /(^|\/)(\.git|node_modules|\.env[^/]*|[^/]*(?:secret|credential|private[-_]?key)[^/]*)(\/|$)|\.(pem|key|p12)$/i;
export function validatePath(path,write=false,project=null){
  if(typeof path!=='string'||!path||path.length>240||path.startsWith('/')||path.includes('\\')||path.includes('\0')||path.split('/').some(s=>!s||s==='.'||s==='..')||forbidden.test(path))throw Error('PATH_NOT_AUTHORIZED');
  // These control future CI, dependencies and runtime privileges. They require separate operator work.
  if(write&&(/(^|\/)(AGENTS\.md|Dockerfile|package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|\.npmrc|\.yarnrc.*)$|^\.github\//i.test(path)))throw Error('CONTROL_FILE_REQUIRES_REVIEW');
  if(write&&project?.mode==='preparation'&&!path.startsWith('docs/'))throw Error('PROJECT_PREPARATION_ONLY');
  return path;
}
async function safePath(root,path,write,project){
  validatePath(path,write,project);const base=await realpath(root);let cursor=base;
  const parts=path.split('/');for(let i=0;i<parts.length;i++){
    cursor=join(cursor,parts[i]);try{const s=await lstat(cursor);if(s.isSymbolicLink()||(!s.isDirectory()&&s.nlink!==1))throw Error('LINK_NOT_AUTHORIZED');if(i<parts.length-1&&!s.isDirectory())throw Error('INVALID_PARENT');}
    catch(e){if(e.code!=='ENOENT')throw e;if(!write)throw e;if(i<parts.length-1)await mkdir(cursor,{mode:0o700});}
  }
  if(!cursor.startsWith(base+sep))throw Error('PATH_NOT_AUTHORIZED');return cursor;
}
export class Workspace {
  constructor(config, {containerExec=exec}={}){this.c=config;this.containerExec=containerExec;this.sources=new SourceCache(config);}
  root(t){return join(this.c.root,'workspaces',t.project,t.id);}
  async prepare(t,p){
    registeredProject(this.c,p);if(t.project!==p.id)throw Error('PROJECT_NOT_AUTHORIZED');
    if(p.repository&&this.c.sourceMode==='github')p.source=await this.sources.ensure(p);
    const root=this.root(t);await mkdir(dirname(root),{recursive:true,mode:0o700});
    if(p.source){
      if(!p.source.startsWith('/'))throw Error('PROJECT_SOURCE_MUST_BE_ABSOLUTE');
      const source=await realpath(p.source);const origin=await git(source,['remote','get-url','origin']);
      if(origin!==`https://github.com/${p.repository}.git`)throw Error('PROJECT_SOURCE_REPOSITORY_MISMATCH');
      // No network/credential helper. Independent copy; no worktrees or shared object links.
      const sourceBase=await git(source,['rev-parse',`refs/heads/${p.baseBranch||'main'}`]);
      await git(dirname(root),['clone','--no-local','--no-hardlinks','--no-checkout',source,root]);
      await git(root,['remote','remove','origin']);
      await git(root,['checkout','--detach',sourceBase]);
    }else{
      if(p.mode!=='preparation')throw Error('PROJECT_SOURCE_REQUIRED');
      await mkdir(root,{mode:0o700});await git(root,['init','-b','main']);
      await git(root,['-c','user.name=AS Developer','-c','user.email=ad507-agent@users.noreply.github.com','commit','--allow-empty','-m','Initialize isolated preparation workspace']);
    }
    t.base=await git(root,['rev-parse','HEAD']);t.branch=`ad507/task-${t.id}`;
    if(!TASK_BRANCH.test(t.branch))throw Error('INVALID_TASK_BRANCH');
    await git(root,['switch','-c',t.branch]);return root;
  }
  async branch(t){if(!TASK_BRANCH.test(t.branch)||await git(this.root(t),['branch','--show-current'])!==t.branch)throw Error('PROTECTED_BRANCH');}
  async readable(t){try{await this.branch(t);}catch(error){if(error.message==='PROTECTED_BRANCH')throw error;throw Error('REPOSITORY_READ_FAILED');}}
  async list(t,query=''){
    if(typeof query!=='string'||query.length>240)throw Error('INVALID_QUERY');
    await this.readable(t);
    if(['*','**/*','.'].includes(query))query='';
    // Search the full tracked/untracked index BEFORE limiting the returned matches.
    // A capped directory walk made files beyond the first 3000 invisible.
    try {
      const root=this.root(t);
      const tracked=await exec('git',['-c','core.hooksPath=/dev/null','ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,env:gitEnv,timeout:30000,maxBuffer:16*1024*1024});
      return [...new Set(tracked.stdout.split(String.fromCharCode(0)).filter(Boolean))]
        .filter(path=>!forbidden.test(path)&&path.includes(query))
        .sort().slice(0,3000);
    }catch(error){throw Error('REPOSITORY_READ_FAILED');}
  }
  async read(t,path){await this.readable(t);try{const target=await safePath(this.root(t),path,false);const s=await lstat(target);if(!s.isFile()||s.size>100000)throw Error('FILE_TOO_LARGE');return await readFile(target,'utf8');}catch(error){if(error.code==='ENOENT')throw Error('FILE_NOT_FOUND');if(['EACCES','EPERM','ENOTDIR'].includes(error.code))throw Error('REPOSITORY_READ_FAILED');throw error;}}
  async write(t,p,path,content){
    await this.branch(t);if(typeof content!=='string'||Buffer.byteLength(content)>100000)throw Error('FILE_TOO_LARGE');
    const files=await this.list(t);if(files.length>3000||t.steps>this.c.maxSteps)throw Error('WORKSPACE_LIMIT');
    // Worker is single-threaded and sandbox execution is awaited, so no untrusted process races file operations.
    const target=await safePath(this.root(t),path,true,p);await writeFile(target,content,{mode:0o644});return `WROTE ${path}`;
  }
  async replace(t,p,path,oldText,newText){
    if(!oldText||oldText.length>100000||newText.length>100000)throw Error('INVALID_REPLACEMENT');
    const original=await this.read(t,path);if(original.split(oldText).length!==2)return {error:'MATCH_MUST_BE_UNIQUE',instruction:'Read the file and supply a unique literal context.'};
    return this.write(t,p,path,original.replace(oldText,()=>newText));
  }
  async diff(t){await this.branch(t);const root=this.root(t);
    const changed=(await git(root,['diff','--name-only',t.base])).split('\n').filter(Boolean);
    const untracked=(await git(root,['ls-files','--others','--exclude-standard'])).split('\n').filter(Boolean);
    return [...new Set([...changed,...untracked])].filter(p=>!forbidden.test(p));
  }
  async snapshot(t){
    await this.branch(t);const root=this.root(t);const snapshot=await mkdtemp(join(this.c.root,'sandbox-'));
    try{await chmod(snapshot,0o755);let bytes=0;
      for(const path of await this.list(t)){
        const source=await safePath(root,path,false);const size=(await lstat(source)).size;bytes+=size;
        if(size>4000000||bytes>16000000)throw Error('SANDBOX_SNAPSHOT_LIMIT');
        const dest=join(snapshot,path);await mkdir(dirname(dest),{recursive:true,mode:0o755});await copyFile(source,dest);await chmod(dest,0o644);
      }return snapshot;
    }catch(error){await rm(snapshot,{recursive:true,force:true});throw error;}
  }
  async checkAvailability(){
    if(this.c.checkBackend==='github-actions'){if(!this.remote?.ready())throw Error('ACTIONS_NOT_CONFIGURED_OR_BUDGET_UNCONFIRMED');return;}
    if(this.c.checkBackend!=='local-docker')throw Error('INVALID_CHECK_BACKEND');
    if(!/^[a-zA-Z0-9./:@_-]+$/.test(this.c.sandboxImage))throw Error('INVALID_SANDBOX_IMAGE');
    try{await this.containerExec('docker',['image','inspect',this.c.sandboxImage],{env:{PATH:process.env.PATH},timeout:10000,maxBuffer:16000});}
    catch{throw Error('SANDBOX_NOT_AVAILABLE');}
  }
  async run(t,p,name,signal){
    registeredProject(this.c,p);if(t.project!==p.id)throw Error('PROJECT_NOT_AUTHORIZED');
    await this.branch(t);
    const command=requireCheck(p,name);
    if(this.c.checkBackend==='github-actions'){if(!this.remote)throw Error('ACTIONS_NOT_CONFIGURED_OR_BUDGET_UNCONFIRMED');return this.remote.run(t,p,name,signal);}
    if(!/^[a-zA-Z0-9./:@_-]+$/.test(this.c.sandboxImage))throw Error('INVALID_SANDBOX_IMAGE');
    const root=this.root(t);const container=`ad507-${t.id}`;
    const snapshot=await this.snapshot(t);
    return this.runSnapshot(snapshot,t.id,name,signal);
  }
  async runSnapshot(snapshot,id,name,signal){
    let container=null;
    try {
    if(!/^[a-f0-9-]{36}$/.test(id))throw Error('INVALID_CHECK_ID');
    const command=requireCheck({mode:'development'},name);container=`ad507-${id}`;
    if(!/^[a-zA-Z0-9./:@_-]+$/.test(this.c.sandboxImage))throw Error('INVALID_SANDBOX_IMAGE');
    // Run untrusted tests with no host env, network, socket, capabilities or secrets; never fall back to host execution.
    const args=['run','--pull=never','--rm','--name',container,'--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges',
      '--pids-limit=64','--memory=512m','--cpus=1','--user=1000:1000','--tmpfs','/tmp:rw,noexec,nosuid,size=64m','--tmpfs','/work:rw,nosuid,size=256m,uid=1000,gid=1000',
      '--mount',`type=bind,src=${snapshot},dst=/source,readonly`,
      '--workdir','/work','--env','HOME=/tmp',this.c.sandboxImage,'timeout','--signal=KILL','120s','node','/opt/ad507-link-deps.mjs',...command];
    try {if(signal?.aborted)throw Error('CHECK_ABORTED');const r=await this.containerExec('docker',args,{env:{PATH:process.env.PATH},signal,timeout:120000,maxBuffer:256000});return {check:name,passed:true,output:sanitizeOutput(r.stdout+'\n'+r.stderr,this.c)};}
    catch(e){if(e.code==='ENOENT')throw Error('SANDBOX_NOT_AVAILABLE');if(signal?.aborted)throw Error('CHECK_ABORTED');return {check:name,passed:false,output:sanitizeOutput(String(e.stdout||'')+'\n'+String(e.stderr||'CHECK_FAILED'),this.c)};}
    finally{if(container)await this.containerExec('docker',['rm','-f',container],{env:{PATH:process.env.PATH},timeout:10000}).catch(()=>{});}
    } finally {await rm(snapshot,{recursive:true,force:true});}
  }
}
export function sanitizeOutput(value,c){
  let output=value.slice(0,20000);for(const secret of [c.apiKey,c.actionsToken,c.sourceToken,c.env?.AD507_GITHUB_TOKEN,c.env?.AD507_LEVEIA_GITHUB_TOKEN,...Object.entries(c.env||{}).filter(([key])=>/^AD507_PROJECT_.*_GITHUB_TOKEN$/.test(key)).map(([,value])=>value)])if(typeof secret==='string'&&secret.length>6)output=output.split(secret).join('[REDACTED]');
  return output.replace(/(?:sk-[a-zA-Z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g,'[REDACTED]').replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,'[REDACTED PRIVATE KEY]');
}

