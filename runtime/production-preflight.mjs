// Read-only production cutover gate. Never prints secret values or changes Railway.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';

export function assessCutover(c, {volumePresent=false, backupVerified=false, executorVerified=false}={}) {
  const checks=[
    ['persistent-volume',volumePresent,'Existing persistent data directory must be mounted'],
    ['backup',backupVerified,'Restore-tested private backup of current volume required'],
    ['owner-login',/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(c.ownerHash||'')&&(!c.ownerEmail||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.ownerEmail)),'Valid owner password hash required; email optional'],
    ['public-origin',/^https:\/\//.test(c.origin),'HTTPS public origin required'],
    ['provider',Boolean(c.live&&c.apiKey&&c.model&&c.provider==='deepseek'&&c.inputRate>0&&c.outputRate>0),'Live DeepSeek, model and positive token prices required'],
    ['isolated-executor',executorVerified,'Real sandbox execution must be independently verified'],
  ];
  return {ready:checks.every(([,ok])=>ok),checks:checks.map(([id,passed,reason])=>({id,passed,reason}))};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const c=loadConfig();
  // An explicit operator-reviewed evidence file is required. Existence of a
  // local directory is NOT evidence that a Railway volume or backup is safe.
  const evidenceFile=process.argv[2];
  let evidence={};
  if(evidenceFile){
    try{
      const raw=JSON.parse(readFileSync(resolve(evidenceFile),'utf8'));
      if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('INVALID_EVIDENCE');
      evidence={
        volumePresent:raw.volumePresent===true,
        backupVerified:raw.backupVerified===true,
        executorVerified:raw.executorVerified===true
      };
    }catch{console.error('EVIDENCE_FILE_INVALID');process.exit(2);}
  }
  const result=assessCutover(c,evidence);
  for(const check of result.checks)console.log((check.passed?'PASS ':'BLOCK ')+check.id+': '+check.reason);
  console.log(result.ready?'CUTOVER_READY':'CUTOVER_BLOCKED');
  if(!result.ready)process.exitCode=1;
}
