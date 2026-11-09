import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { normalizeProject } from './projects.mjs';
export const TASK_BRANCH = /^ad507\/task-[a-z0-9][a-z0-9-]{2,80}$/;
export const registryPath = fileURLToPath(new URL('../config/projects.json', import.meta.url));
export function loadConfig(env=process.env) {
  const seeds=JSON.parse(readFileSync(registryPath,'utf8')).projects;
  const projects=Object.create(null);for(const [id,p] of Object.entries(seeds))projects[id]=normalizeProject(id,p,env);
  const root=resolve(env.AD507_DATA_DIR || './ad507-data');
  const provider=env.AD507_PROVIDER||'deepseek';
  if(!['deepseek','simulation'].includes(provider))throw Error('DEEPSEEK_ONLY');
  const globalCap=Number(env.AD507_BUDGET_MICROUSD||1000000);
  if(!Number.isSafeInteger(globalCap)||globalCap<1)throw Error('INVALID_GLOBAL_BUDGET');
  const checkBackend=env.AD507_CHECK_BACKEND||'local-docker';
  if(checkBackend==='github-actions')throw Error('GITHUB_ACTIONS_DISABLED');
  if(checkBackend!=='local-docker')throw Error('INVALID_CHECK_BACKEND');
  return {root,projects,provider,globalCap,checkBackend,sourceMode:env.AD507_SOURCE_MODE||'manual',
    sourceToken:env.AD507_SOURCE_GITHUB_TOKEN||env.AD507_GITHUB_TOKEN||env.AD507_ACTIONS_GITHUB_TOKEN,
    actionsToken:env.AD507_ACTIONS_GITHUB_TOKEN||env.AD507_GITHUB_TOKEN,
    actionsRef:env.AD507_ACTIONS_REF||env.RAILWAY_GIT_BRANCH,actionsSHA:env.AD507_ACTIONS_SHA||env.RAILWAY_GIT_COMMIT_SHA,
    actionsIncludedOnly:env.AD507_ACTIONS_INCLUDED_ONLY_CONFIRMED==='true',
    actionsMonthlyMinutes:Number(env.AD507_ACTIONS_MONTHLY_MINUTES||0),
    actionsProjectMinutes:Number(env.AD507_ACTIONS_PROJECT_MINUTES||30),actionsTaskMinutes:Number(env.AD507_ACTIONS_TASK_MINUTES||30),live:env.AD507_LIVE_ENABLED==='true',
    ownerHash:env.AD507_OWNER_PASSWORD_HASH,ownerEmail:(env.AD507_OWNER_EMAIL||'').trim().toLowerCase(),origin:env.AD507_ORIGIN||'http://127.0.0.1:8787',
    port:Number(env.PORT||8787),host:env.AD507_HOST||'127.0.0.1',
    model:env.AD507_MODEL||env.DEEPSEEK_MODEL||'deepseek-flash',apiKey:env.DEEPSEEK_API_KEY,
    inputRate:Number(env.AD507_INPUT_MICROUSD_PER_TOKEN||0),outputRate:Number(env.AD507_OUTPUT_MICROUSD_PER_TOKEN||0),
    maxOutput:2048,maxSteps:40,maxTaskMs:30*60*1000,
    sandboxImage:env.AD507_SANDBOX_IMAGE||'ad507-checks:reviewed',
    publishing:env.AD507_PUBLISH_ENABLED==='true',env};
}
export function projectFor(config,id){const p=config.projects[id];if(!p?.enabled)throw Error('PROJECT_NOT_AUTHORIZED');return p;}
export function providerReady(c){return c.provider==='simulation'||Boolean(c.live&&c.apiKey&&c.model&&c.inputRate>0&&c.outputRate>0);}
