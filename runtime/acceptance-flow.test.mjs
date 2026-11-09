import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './store.mjs';
import { loadConfig } from './config.mjs';
import { Workspace } from './workspace.mjs';
import { SimulationProvider } from './provider.mjs';
import { Publisher } from './publisher.mjs';
import { Engine } from './engine.mjs';

test('authorized simulated job produces a review gate and never publishes automatically',async t=>{
  const root=await mkdtemp(join(tmpdir(),'as-developer-acceptance-'));
  const config=loadConfig({AD507_DATA_DIR:root,AD507_PROVIDER:'simulation'});
  const store=new Store(root);
  const workspace=new Workspace(config);
  const engine=new Engine(config,store,workspace,new SimulationProvider(),new Publisher(config,workspace));
  t.after(async()=>{await engine.stop();store.close();await rm(root,{recursive:true,force:true});});
  const job=engine.create({project:'junta-comunal-santiago',instructions:'Preparar documentación institucional sin construir la web.'});
  assert.equal(job.state,'pending');
  await engine.tick();
  const delivered=store.get(job.id);
  assert.equal(delivered.state,'awaiting_approval');
  assert.equal(delivered.gate,'delivery');
  assert.match(delivered.branch,/^ad507\/task-/);
  assert.deepEqual(delivered.files,['docs/ad507-simulation.md']);
  assert.equal(store.events(job.id).some(event=>event.kind==='owner_approve'),false);
});
