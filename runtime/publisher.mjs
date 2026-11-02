import { TASK_BRANCH } from './config.mjs';
import { validatePath, git } from './workspace.mjs';
import { readLimited } from './provider.mjs';
import { registeredProject } from './projects.mjs';
export class Publisher {
  constructor(config,workspace,fetchImpl=fetch){this.c=config;this.w=workspace;this.fetch=fetchImpl;}
  async publish(t,p,checkpoint){
    p=registeredProject(this.c,p);if(t.project!==p.id)throw Error('PROJECT_NOT_AUTHORIZED');
    const credential=this.c.env?.[p.tokenEnv]||(p.id==='leveia'?this.c.env?.AD507_GITHUB_TOKEN:undefined);
    if(!this.c.publishing||!p.repository||!credential)throw Error('PUBLISH_NOT_CONFIGURED');
    await this.w.branch(t);if(!TASK_BRANCH.test(t.branch))throw Error('PROTECTED_BRANCH');
    const token=credential;const baseBranch=p.baseBranch||'main',owner=p.repository.split('/')[0];
    const api=async(path,method='GET',body)=>{
      const r=await this.fetch(`https://api.github.com/repos/${p.repository}/${path}`,{method,redirect:'error',
        signal:AbortSignal.timeout(30000),headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},body:body?JSON.stringify(body):undefined});
      if(!r.ok)throw Error(`PUBLISH_HTTP_${r.status}`);return JSON.parse(await readLimited(r,512000));};
    // Deterministic branch/PR identity: a retry inspects effects rather than creating duplicates.
    const prs=await api(`pulls?state=all&head=${owner}:${encodeURIComponent(t.branch)}`);
    if(prs.length){const pr=prs[0];if(pr.base.ref!==baseBranch||pr.head.ref!==t.branch||pr.state!=='open')throw Error('REMOTE_DELIVERY_REQUIRES_REVIEW');return {url:pr.html_url,sha:pr.head.sha};}
    const base=await api(`git/commits/${t.base}`);
    const files=await this.w.diff(t);if(!files.length)throw Error('NO_DELIVERABLE_FILES');
    const tree=[];for(const path of files){validatePath(path,true,p);tree.push({path,mode:'100644',type:'blob',content:await this.w.read(t,path)});}
    const newTree=await api('git/trees','POST',{base_tree:base.tree.sha,tree});
    const commit=await api('git/commits','POST',{message:`AD507 Developer: task ${t.id}`,tree:newTree.sha,parents:[t.base]});
    t.publishSha=commit.sha;checkpoint();
    // Creating a new non-main ref only. Existing refs are NEVER moved or force-pushed.
    const refResponse=await this.fetch(`https://api.github.com/repos/${p.repository}/git/ref/heads/${t.branch}`,{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(30000)});
    if(refResponse.ok){const existing=JSON.parse(await readLimited(refResponse,16000));
      // Recover branch creation after a crash by comparing its exact file tree.
      const existingCommit=await api(`git/commits/${existing.object.sha}`);
      if(existingCommit.tree.sha!==newTree.sha)throw Error('REMOTE_BRANCH_CONFLICT');t.publishSha=existing.object.sha;checkpoint();
    }else if(refResponse.status===404){await api('git/refs','POST',{ref:`refs/heads/${t.branch}`,sha:commit.sha});}
    else throw Error('REMOTE_BRANCH_LOOKUP_FAILED');
    const body=`Task ${t.id}\n\n${t.summary||'Prepared for human review.'}\n\nFiles: ${files.join(', ')}\nChecks: ${t.checks.map(c=>`${c.check}: ${c.passed?'PASS':'FAIL'}`).join(', ')}\n\nNo production deployment. Human review required. Base ${t.base}.`;
    const pr=await api('pulls','POST',{title:`AD507 Developer: ${t.project} · ${t.id.slice(0,8)}`,head:t.branch,base:baseBranch,body,draft:true});
    return {url:pr.html_url,sha:t.publishSha};
  }
}
