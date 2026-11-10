import test from 'node:test';
import assert from 'node:assert/strict';
import {tools,toolsForProject,Provider} from './provider.mjs';

test('DeepSeek sees only project-authorized checks',()=>{
 const original=tools.find(t=>t.function.name==='run_safe_check').function.parameters.properties.check.enum;
 const scoped=toolsForProject({checks:['project-syntax','project-test']});
 assert.deepEqual(scoped.find(t=>t.function.name==='run_safe_check').function.parameters.properties.check.enum,['project-syntax','project-test']);
 assert.ok(original.includes('api-build'));
 assert.equal(scoped.length,tools.length);
 assert.deepEqual(toolsForProject({checks:[]}).find(t=>t.function.name==='run_safe_check').function.parameters.properties.check.enum,[]);
});
test('provider sends scoped tool schema without making a real paid request',async()=>{
 let request;
 const config={live:true,apiKey:'fake-test-key',model:'test',provider:'deepseek',maxOutput:128};
 const provider=new Provider(config,async(_url,options)=>{
  request=JSON.parse(options.body);
  return {ok:true,body:new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:'ok'}}]})));controller.close();}})};
 });
 await provider.next([{role:'user',content:'test'}],new AbortController().signal,64,{checks:['project-test']});
 assert.deepEqual(request.tools.find(t=>t.function.name==='run_safe_check').function.parameters.properties.check.enum,['project-test']);
 assert.equal(request.max_tokens,64);
});
