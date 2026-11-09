// Read-only production cutover gate. Never prints secret values or changes Railway.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';

export function assessCutover(c, {volumePresent=false, backupVerified=false, executorVerified=false}={}) {
  const checks=[
    ['persistent-volume',volumePresent,'Existing persistent data directory must be mounted'],
    ['backup',backupVerified,'Restore-tested private backup of current volume required'],
    ['owner-login',Boolean(c.ownerHash&&c.ownerEmail),'Owner email and password hash must be configured'],
    ['public-origin',/^https:\/\//.test(c.origin),'HTTPS public origin required'],
    ['provider',Boolean(c.apiKey&&c.provider==='deepseek'&&c.inputRate>0&&c.outputRate>0),'DeepSeek and positive token prices required'],
    ['isolated-executor',executorVerified,'Real sandbox execution must be independently verified'],
  ];
  return {ready:checks.every(([,ok])=>ok),checks:checks.map(([id,passed,reason])=>({id,passed,reason}))};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const c=loadConfig();
  const result=assessCutover(c,{volumePresent:existsSync(c.root)});
  for(const check of result.checks)console.log((check.passed?'PASS ':'BLOCK ')+check.id+': '+check.reason);
  console.log(result.ready?'CUTOVER_READY':'CUTOVER_BLOCKED');
  if(!result.ready)process.exitCode=1;
}
