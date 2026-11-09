import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './store.mjs';
import { loadConfig } from './config.mjs';
import { createApp } from './server.mjs';
import { passwordHash } from './auth.mjs';

test('owner email binding accepts case-insensitive email and rejects wrong or absent email', async t => {
  const root=await mkdtemp(join(tmpdir(),'asdev-email-'));
  const password='fixture-long-secret-password';
  const c={...loadConfig({AD507_DATA_DIR:root,AD507_PROVIDER:'simulation'}),ownerHash:passwordHash(password),ownerEmail:'owner@example.test'};
  const store=new Store(root);
  t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
  // Reserve an ephemeral port, then recreate with its origin for strict host validation.
  const stub=createApp(c,store,{w:{remote:null}});
  stub.listen(0,'127.0.0.1');await once(stub,'listening');
  const port=stub.address().port;await new Promise(resolve=>stub.close(resolve));
  c.origin=`http://127.0.0.1:${port}`;
  const server=createApp(c,store,{w:{remote:null}});
  server.listen(port,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const login=(email)=>fetch(c.origin+'/api/login',{method:'POST',headers:{Origin:c.origin,'Content-Type':'application/json'},body:JSON.stringify({email,password})});
  assert.equal((await login(undefined)).status,401);
  assert.equal((await login('attacker@example.test')).status,401);
  assert.equal((await login('OWNER@EXAMPLE.TEST')).status,200);
});
test('invalid configured owner email fails closed at startup', async t => {
  const root=await mkdtemp(join(tmpdir(),'asdev-invalid-'));
  const store=new Store(root);t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
  const c={...loadConfig({AD507_DATA_DIR:root,AD507_PROVIDER:'simulation'}),ownerHash:passwordHash('long-fixture-password-2026'),ownerEmail:'invalid'};
  assert.throws(()=>createApp(c,store,{w:{remote:null}}),/OWNER_EMAIL_INVALID/);
});
