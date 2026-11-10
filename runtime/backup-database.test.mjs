import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupDatabase } from './backup-database.mjs';

test('operator backup copies committed SQLite data and passes integrity verification',async()=>{
  const root=await mkdtemp(join(tmpdir(),'as-developer-backup-'));
  try{
    const live=join(root,'live'),external=join(root,'external');
    await mkdir(live);await mkdir(external);
    const source=join(live,'developer.sqlite'),dest=join(external,'backup.sqlite');
    const db=new DatabaseSync(source);
    try{
      db.exec('PRAGMA journal_mode=WAL; CREATE TABLE records (value TEXT); INSERT INTO records VALUES (\'preserved\')');
      await backupDatabase(source,dest);
      const copy=new DatabaseSync(dest,{readOnly:true});
      try{assert.equal(copy.prepare('SELECT value FROM records').get().value,'preserved');}
      finally{copy.close();}
      assert.equal((await stat(dest)).mode&0o777,0o600);
      await assert.rejects(backupDatabase(source,dest),/BACKUP_ALREADY_EXISTS/);
      await assert.rejects(backupDatabase(source,join(live,'backup.sqlite')),/BACKUP_DESTINATION_MUST_BE_EXTERNAL/);
    }finally{db.close();}
  }finally{await rm(root,{recursive:true,force:true});}
});
