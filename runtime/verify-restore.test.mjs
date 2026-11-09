import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyRestore } from './verify-restore.mjs';

test('restore drill verifies a private copy and never changes source backup',async()=>{
  const root=await mkdtemp(join(tmpdir(),'ad507-restore-test-'));
  const source=join(root,'backup.sqlite');
  try{
    const db=new DatabaseSync(source);
    try{
      db.exec("CREATE TABLE tasks (id TEXT); CREATE TABLE sessions (id TEXT); INSERT INTO tasks VALUES ('one')");
    }finally{db.close();}
    const before=(await stat(source)).size;
    assert.deepEqual(await verifyRestore(source,{temporaryRoot:root}),{verified:true,taskCount:1});
    assert.equal((await stat(source)).size,before);
    await assert.rejects(stat(join(root,'ad507-restore-drill-')), {code:'ENOENT'});
  }finally{await rm(root,{recursive:true,force:true});}
});

test('restore drill refuses backups without expected application schema',async()=>{
  const root=await mkdtemp(join(tmpdir(),'ad507-invalid-restore-'));
  try{
    const source=join(root,'backup.sqlite');
    const db=new DatabaseSync(source);db.exec('CREATE TABLE unrelated (id TEXT)');db.close();
    await assert.rejects(verifyRestore(source,{temporaryRoot:root}),/RESTORE_SCHEMA_MISMATCH/);
  }finally{await rm(root,{recursive:true,force:true});}
});
