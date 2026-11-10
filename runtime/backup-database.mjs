// Operator-only SQLite backup. Never invoked by the web server or an agent task.
// Creates a consistent copy of the live database, including committed WAL changes.
import { DatabaseSync, backup } from 'node:sqlite';
import { chmod, mkdir, lstat, realpath } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function backupDatabase(sourcePath,destinationPath){
  const source=resolve(sourcePath),destination=resolve(destinationPath);
  if(source===destination||destination.startsWith(dirname(source)+sep))throw Error('BACKUP_DESTINATION_MUST_BE_EXTERNAL');
  const sourceInfo=await lstat(source);
  if(!sourceInfo.isFile()||sourceInfo.isSymbolicLink())throw Error('INVALID_DATABASE_SOURCE');
  await mkdir(dirname(destination),{recursive:true,mode:0o700});
  const destinationDir=await realpath(dirname(destination));
  if(destinationDir===dirname(source)||destinationDir.startsWith(dirname(source)+sep))throw Error('BACKUP_DESTINATION_MUST_BE_EXTERNAL');
  try{await lstat(destination);throw Error('BACKUP_ALREADY_EXISTS');}catch(error){if(error.code!=='ENOENT')throw error;}
  const db=new DatabaseSync(source,{readOnly:true});
  try{
    await backup(db,destination,{rate:16});
    await chmod(destination,0o600);
    const verify=new DatabaseSync(destination,{readOnly:true});
    try{if(verify.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('BACKUP_INTEGRITY_FAILED');}
    finally{verify.close();}
  }finally{db.close();}
  return {created:true}; // Never expose paths or database contents in operational logs.
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [source,destination]=process.argv.slice(2);
  if(!source||!destination){console.error('Usage: node runtime/backup-database.mjs SOURCE_DB EXTERNAL_DESTINATION_DB');process.exitCode=2;}
  else backupDatabase(source,destination).then(()=>console.log('BACKUP_VERIFIED')).catch(e=>{console.error(e.message);process.exitCode=1;});
}
