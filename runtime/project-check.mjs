// Trusted dependency-free syntax check. This does not claim build, type or behavior coverage.
import {readdir,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
let checked=0;
async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){
  if(['node_modules','.git'].includes(entry.name)||entry.isSymbolicLink())continue;
  const path=join(dir,entry.name);
  if(entry.isDirectory())await walk(path);
  else if(/\.json$/.test(path)){JSON.parse(await readFile(path,'utf8'));checked++;}
  else if(/\.(?:js|mjs|cjs)$/.test(path)){const r=spawnSync(process.execPath,['--check',path],{encoding:'utf8',timeout:5000,maxBuffer:16000});if(r.status!==0)throw Error('SYNTAX_CHECK_FAILED '+path+' '+String(r.stderr||''));checked++;}
}}
await walk(process.cwd());if(!checked)throw Error('NO_SUPPORTED_SYNTAX_FILES');console.log(`PASS syntax of ${checked} JS/JSON files; build/type/behavior tests not performed.`);
