// Operator-only restore drill. Never writes to the production data directory.
import { DatabaseSync, backup } from 'node:sqlite';
import { mkdtemp, rm, lstat, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

export async function verifyRestore(backupPath,{temporaryRoot=tmpdir()}={}){
  const source=resolve(backupPath);
  const info=await lstat(source);
  if(!info.isFile()||info.isSymbolicLink())throw Error('RESTORE_SOURCE_INVALID');
  const parent=await realpath(temporaryRoot);
  const directory=await mkdtemp(join(parent,'ad507-restore-drill-'));
  try{
    const original=new DatabaseSync(source,{readOnly:true});
    try{
      if(original.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('RESTORE_SOURCE_CORRUPT');
      await backup(original,join(directory,'restored.sqlite'),{rate:16});
    }finally{original.close();}
    const restored=new DatabaseSync(join(directory,'restored.sqlite'),{readOnly:true});
    try{
      if(restored.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('RESTORE_INTEGRITY_FAILED');
      // The expected application tables must be present after restore.
      const tables=new Set(restored.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name));
      if(!tables.has('tasks')||!tables.has('sessions'))throw Error('RESTORE_SCHEMA_MISMATCH');
      const taskCount=restored.prepare('SELECT COUNT(*) AS n FROM tasks').get().n;
      return {verified:true,taskCount};
    }finally{restored.close();}
  }finally{await rm(directory,{recursive:true,force:true});}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==3){console.error('Usage: node runtime/verify-restore.mjs BACKUP_DB');process.exitCode=2;}
  else verifyRestore(process.argv[2]).then(()=>console.log('RESTORE_DRILL_VERIFIED')).catch(e=>{console.error(e.message);process.exitCode=1;});
}
