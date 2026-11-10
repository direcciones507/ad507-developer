import test from 'node:test';
import assert from 'node:assert/strict';
import { assessCutover } from './production-preflight.mjs';

const config={ownerHash:'scrypt:'+ 'a'.repeat(32)+':'+ 'b'.repeat(128),ownerEmail:'owner@example.com',origin:'https://agent.example.com',provider:'deepseek',live:true,model:'deepseek-chat',apiKey:'private',inputRate:1,outputRate:1};
const flags={volumePresent:true,backupVerified:true,executorVerified:true};
test('cutover requires every independent safety gate',()=>{
  assert.equal(assessCutover(config,flags).ready,true);
  for(const flag of Object.keys(flags)){
    const result=assessCutover(config,{...flags,[flag]:false});
    assert.equal(result.ready,false,flag);
  }
});
test('cutover blocks missing authentication, HTTPS and provider credentials',()=>{
  for(const patch of [{ownerHash:''},{ownerEmail:'invalid-email'},{live:false},{model:''},{origin:'http://localhost:8787'},{apiKey:''},{provider:'simulation'},{inputRate:0},{outputRate:0}]){
    assert.equal(assessCutover({...config,...patch},flags).ready,false,JSON.stringify(Object.keys(patch)));
  }
});
test('cutover never returns secret values in diagnostics',()=>{
  const result=assessCutover({...config,apiKey:'sensitive-api-key'},flags);
  assert.doesNotMatch(JSON.stringify(result),/sensitive-api-key|scrypt:aaaaaaaa/);
});
