export const tools = [
  ['list_repository_files','List allowed files in this task checkout. query is a case-sensitive literal substring, NOT a glob. Use empty string to list ALL files; *, **/* and . also mean all. Result distinguishes no_matches, empty_workspace and read errors. Do not repeat an unchanged search.',{query:{type:'string'}}],
  ['read_repository_file','Read a relative UTF-8 file.',{path:{type:'string'}}],
  ['write_repository_file','Write one file on the task branch.',{path:{type:'string'},content:{type:'string'}}],
  ['replace_repository_text','Replace exactly one literal occurrence without rewriting the rest of a file.',{path:{type:'string'},oldText:{type:'string'},newText:{type:'string'}}],
  ['run_safe_check','Run an allowlisted check in a network-disabled sandbox.',{check:{type:'string',enum:['agent-test','agent-typecheck','api-typecheck','api-build','project-syntax','project-test','standalone-agent-test']}}],
  ['inspect_diff','Inspect changed file names on the task branch.',{}]
].map(([name,description,properties])=>({type:'function',function:{name,description,parameters:{type:'object',properties,required:Object.keys(properties),additionalProperties:false}}}));
export function toolsForProject(project){
  const allowed=project?.checks;
  if(!Array.isArray(allowed))return tools;
  return tools.map(tool=>tool.function.name!=='run_safe_check'?tool:{...tool,function:{...tool.function,parameters:{...tool.function.parameters,properties:{...tool.function.parameters.properties,check:{...tool.function.parameters.properties.check,enum:[...allowed]}}}}});
}
const endpoint='https://api.deepseek.com/chat/completions';
export class Provider {
  constructor(config,fetchImpl=fetch){this.c=config;this.fetch=fetchImpl;}
  estimate(messages,maxOutput=this.c.maxOutput){
    // Reserve a bounded output allowance; never reserve more than the configured per-call output ceiling.
    validateToolSequence(messages);
    const bytes=Buffer.byteLength(JSON.stringify({messages,tools}),'utf8')+4096;
    const amount=Math.ceil(bytes*this.c.inputRate+maxOutput*this.c.outputRate);
    if(!Number.isSafeInteger(amount)||amount<=0)throw Error('PRICING_REQUIRED');return amount;
  }
  async next(messages,signal,maxOutput=this.c.maxOutput,project=null){
    if(!Number.isSafeInteger(maxOutput)||maxOutput<1||maxOutput>this.c.maxOutput)throw Error('INVALID_OUTPUT_LIMIT');
    if(!this.c.live||!this.c.apiKey||!this.c.model)throw Error('PROVIDER_NOT_CONFIGURED');
    if(this.c.provider!=='deepseek')throw Error('DEEPSEEK_ONLY');
    validateToolSequence(messages);
    const res=await this.fetch(endpoint,{method:'POST',redirect:'error',signal,
      headers:{Authorization:`Bearer ${this.c.apiKey}`,'Content-Type':'application/json'},
      body:JSON.stringify({model:this.c.model,messages,tools:toolsForProject(project),max_tokens:maxOutput})});
    // Never persist provider error bodies: they can include sensitive request details.
    if(!res.ok){
      // Log only a bounded, allowlisted error classification; never log provider messages or request bodies.
      let category='UNKNOWN';
      try{
        const payload=JSON.parse(await readLimited(res,8192));
        const code=String(payload?.error?.code??'').toLowerCase();
        const type=String(payload?.error?.type??'').toLowerCase();
        const message=String(payload?.error?.message??'').toLowerCase();
        const label=code+' '+type;
        // Match only fixed keywords. Never store, display, or log the provider's raw message.
        if(/tool_call_id|tool.calls|tool message|tool response|function call/.test(message))category='TOOL_SEQUENCE';
        else if(/message.*content|content.*null|content.*type/.test(message))category='MESSAGE_CONTENT';
        else if(/max_tokens|token.*parameter/.test(message))category='TOKEN_PARAMETER';
        else if(/model.*not found|model.*invalid/.test(message))category='INVALID_MODEL';
        else if(/tools.*invalid|tools.*schema|function.*parameters/.test(message))category='TOOL_SCHEMA';
        else if(/messages.*invalid|messages.*format/.test(message))category='MESSAGES_FORMAT';
        if(category==='UNKNOWN'&&/invalid_request|invalid_parameter|invalid_format/.test(label))category='INVALID_REQUEST';
        else if(category==='UNKNOWN'&&/model_not_found|invalid_model/.test(label))category='INVALID_MODEL';
        else if(/context_length|token_limit/.test(label))category='CONTEXT_LIMIT';
        else if(/insufficient_balance|quota/.test(label))category='QUOTA';
        else if(/authentication|invalid_api_key/.test(label))category='AUTH';
      }catch{}
      throw Error(`PROVIDER_HTTP_${res.status}_${category}`);
    }
    const text=await readLimited(res,256000);let json;try{json=JSON.parse(text);}catch{throw Error('INVALID_PROVIDER_JSON');}
    const choice=json.choices?.[0];
    if(choice?.finish_reason&&!['stop','tool_calls'].includes(choice.finish_reason))throw Error('PROVIDER_INCOMPLETE_RESPONSE');
    const message=choice?.message;
    if(!message||message.role!=='assistant'||(!message.tool_calls&&!message.content))throw Error('INVALID_PROVIDER_RESPONSE');
    if(message.tool_calls!==undefined&&(!Array.isArray(message.tool_calls)||message.tool_calls.length===0))throw Error('INVALID_PROVIDER_RESPONSE');
    if(choice.finish_reason==='tool_calls'&&!message.tool_calls?.length)throw Error('INVALID_PROVIDER_RESPONSE');
    if(choice.finish_reason==='stop'&&message.tool_calls?.length)throw Error('INVALID_PROVIDER_RESPONSE');
    if(message.tool_calls?.length>8)throw Error('TOO_MANY_TOOL_CALLS');
    if(message.tool_calls?.length)validateToolSequence([...messages,{role:'assistant',...message}],true);
    return {message:{role:'assistant',content:message.content??null,...(message.tool_calls?{tool_calls:message.tool_calls}:{})},usage:json.usage??{}};
  }
}
export async function readLimited(res,max){
  const reader=res.body.getReader();let size=0;const chunks=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max)throw Error('RESPONSE_TOO_LARGE');chunks.push(Buffer.from(value));}}
  finally{await reader.cancel().catch(()=>{});}return Buffer.concat(chunks).toString('utf8');
}
export class SimulationProvider {
  estimate(){return 1;}
  async next(messages,signal){
    signal?.throwIfAborted(); const n=messages.filter(m=>m.role==='assistant').length;
    const calls=[['list_repository_files',{query:''}],['write_repository_file',{path:'docs/ad507-simulation.md',content:'# AS Developer\nPrueba simulada: archivo creado en rama aislada.\n'}],['inspect_diff',{}]];
    return n<calls.length?{message:{role:'assistant',content:null,tool_calls:[{id:`sim-${n}`,type:'function',function:{name:calls[n][0],arguments:JSON.stringify(calls[n][1])}}]},usage:{prompt_tokens:0,completion_tokens:0}}:
      {message:{role:'assistant',content:'Simulación terminada. Archivo preparado para revisión humana. No se ejecutó DeepSeek ni se validó el producto.'},usage:{prompt_tokens:0,completion_tokens:0}};
  }
}

// Validate the transcript without logging request contents. Partial batches are
// permitted only when validating a newly received assistant message.
export function validateToolSequence(messages,allowPending=false){
  if(!Array.isArray(messages))throw Error('INVALID_TOOL_SEQUENCE');
  let pending=[];const seen=new Set();
  for(const message of messages){
    if(!message||typeof message!=='object')throw Error('INVALID_TOOL_SEQUENCE');
    if(message.role==='tool'){
      if(!pending.length||message.tool_call_id!==pending[0]||typeof message.content!=='string')throw Error('INVALID_TOOL_SEQUENCE');
      pending.shift();continue;
    }
    if(pending.length)throw Error('INVALID_TOOL_SEQUENCE');
    if(message.tool_calls!==undefined){
      if(message.role!=='assistant'||!Array.isArray(message.tool_calls)||!message.tool_calls.length||message.tool_calls.length>8)throw Error('INVALID_TOOL_SEQUENCE');
      for(const call of message.tool_calls){
        if(!call||typeof call.id!=='string'||!call.id||seen.has(call.id)||call.type!=='function'||typeof call.function?.name!=='string'||typeof call.function?.arguments!=='string')throw Error('INVALID_TOOL_SEQUENCE');
        seen.add(call.id);pending.push(call.id);
      }
    }
  }
  if(pending.length&&!allowPending)throw Error('INVALID_TOOL_SEQUENCE');
}
