import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, providerReady } from './config.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './store.mjs';
import { Workspace } from './workspace.mjs';
import { Publisher } from './publisher.mjs';
import { Engine } from './engine.mjs';

test('safe staging defaults do not activate paid model calls or publishing',()=>{
  const c=loadConfig({AD507_DATA_DIR:'./tmp-as-staging',AD507_PROVIDER:'deepseek'});
  assert.equal(c.live,false);
  assert.equal(c.publishing,false);
  assert.equal(providerReady(c),false);
  assert.equal(c.checkBackend,'local-docker');
});

test('production activation needs explicit flags, credentials and rates',()=>{
  const base={AD507_DATA_DIR:'./tmp-as-staging',AD507_PROVIDER:'deepseek',AD507_LIVE_ENABLED:'true',DEEPSEEK_API_KEY:'test-placeholder',AD507_INPUT_MICROUSD_PER_TOKEN:'1',AD507_OUTPUT_MICROUSD_PER_TOKEN:'1'};
  assert.equal(providerReady(loadConfig({...base,AD507_LIVE_ENABLED:'false'})),false);
  assert.equal(providerReady(loadConfig({...base,DEEPSEEK_API_KEY:''})),false);
  assert.equal(providerReady(loadConfig({...base,AD507_INPUT_MICROUSD_PER_TOKEN:'0'})),false);
  assert.equal(providerReady(loadConfig(base)),true);
  assert.equal(loadConfig(base).publishing,false);
});

test('unreviewed execution backends and providers are rejected',()=>{
  assert.throws(()=>loadConfig({AD507_PROVIDER:'untrusted'}),/DEEPSEEK_ONLY/);
  assert.equal(loadConfig({AD507_PROVIDER:'simulation',AD507_CHECK_BACKEND:'github-actions'}).checkBackend,'github-actions');
  assert.throws(()=>loadConfig({AD507_CHECK_BACKEND:'unsafe-host'}),/INVALID_CHECK_BACKEND/);
});

test('disabled live inference never invokes paid provider or reserves a charge',async t=>{
  const root=await mkdtemp(join(tmpdir(),'as-developer-no-charge-'));
  const config=loadConfig({AD507_DATA_DIR:root,AD507_PROVIDER:'deepseek',AD507_LIVE_ENABLED:'false'});
  const store=new Store(root);
  const workspace=new Workspace(config);
  let calls=0;
  const provider={estimate:()=>{calls++;return 1;},next:async()=>{calls++;throw Error('UNEXPECTED_PAID_CALL');}};
  const engine=new Engine(config,store,workspace,provider,new Publisher(config,workspace));
  t.after(async()=>{await engine.stop();store.close();await rm(root,{recursive:true,force:true});});
  const job=engine.create({project:'junta-comunal-santiago',instructions:'Preparar documentación institucional sin construir la web.'});
  await engine.tick();
  const result=store.get(job.id);
  assert.equal(result.state,'failed');
  assert.equal(result.reason,'PROVIDER_NOT_CONFIGURED');
  assert.equal(result.reserved,0);
  assert.equal(calls,0);
});
