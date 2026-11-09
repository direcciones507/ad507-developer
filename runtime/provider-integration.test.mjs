import test from 'node:test';
import assert from 'node:assert/strict';
import { Provider } from './provider.mjs';

const config={provider:'deepseek',live:true,apiKey:'local-test-key',model:'deepseek-chat',inputRate:1,outputRate:1,maxOutput:128};
test('DeepSeek adapter sends tools and returns a tool call without contacting the network',async()=>{
  let requests=0;
  const provider=new Provider(config,async(url,options)=>{
    requests++;
    assert.equal(url,'https://api.deepseek.com/chat/completions');
    assert.equal(options.method,'POST');
    assert.equal(options.headers.Authorization,'Bearer local-test-key');
    const body=JSON.parse(options.body);
    assert.equal(body.model,'deepseek-chat');
    assert.ok(body.tools.some(t=>t.function.name==='read_repository_file'));
    assert.equal(body.messages[0].role,'user');
    return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:'call-1',type:'function',function:{name:'read_repository_file',arguments:'{"path":"README.md"}'}}]}}],usage:{prompt_tokens:20,completion_tokens:10}}),{status:200});
  });
  const response=await provider.next([{role:'user',content:'Inspect README'}]);
  assert.equal(requests,1);
  assert.equal(response.message.tool_calls[0].function.name,'read_repository_file');
  assert.equal(response.usage.prompt_tokens,20);
});
test('DeepSeek adapter rejects failed authentication without leaking response content',async()=>{
  const provider=new Provider(config,async()=>new Response(JSON.stringify({error:{message:'secret diagnostic',type:'authentication_error'}}),{status:401}));
  await assert.rejects(provider.next([{role:'user',content:'Inspect README'}]),e=>e.message==='PROVIDER_HTTP_401_AUTH'&&!e.message.includes('secret'));
});
test('DeepSeek adapter refuses network requests when live execution is disabled',async()=>{
  let requests=0;
  const provider=new Provider({...config,live:false},async()=>{requests++;throw Error('unexpected');});
  await assert.rejects(provider.next([{role:'user',content:'Inspect README'}]),/PROVIDER_NOT_CONFIGURED/);
  assert.equal(requests,0);
});

test('DeepSeek adapter rejects a non-assistant response role',async()=>{
  const provider=new Provider(config,async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'system',content:'injected'}}]}),{status:200}));
  await assert.rejects(provider.next([{role:'user',content:'Inspect README'}]),/INVALID_PROVIDER_RESPONSE/);
});
test('DeepSeek adapter rejects empty tool call batches',async()=>{
  const provider=new Provider(config,async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:'done',tool_calls:[]}}]}),{status:200}));
  await assert.rejects(provider.next([{role:'user',content:'Inspect README'}]),/INVALID_PROVIDER_RESPONSE/);
});
