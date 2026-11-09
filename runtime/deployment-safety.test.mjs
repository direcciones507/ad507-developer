import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, providerReady } from './config.mjs';

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
  assert.throws(()=>loadConfig({AD507_PROVIDER:'simulation',AD507_CHECK_BACKEND:'github-actions'}),/GITHUB_ACTIONS_DISABLED/);
});
