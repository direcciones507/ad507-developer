import { projectFor, providerReady } from './config.mjs';
import { classifyTask } from '../src/policy.ts';
import { actionablePolicyText } from '../src/actionable-policy-text.ts';
import { tools, validateToolSequence } from './provider.mjs';
import { engineeringInstructions } from '../src/agents.ts';
const terminal=new Set(['completed','failed','cancelled']);
export const readOnlyTask = instructions => /\b(?:solo lectura|read.only|sin modificar archivos|sin modificar el c[oó]digo|do not modify (?:any )?(?:files|code))\b/i.test(instructions)
  || /(?:^|[.;\n])\s*(?:no modifi(?:ques|car)(?: (?:archivos|el c[oó]digo))?|no ejecutes pruebas|no ejecutar pruebas|no remote tests)\s*(?:[.;\n]|$)/i.test(instructions);
export class Engine {
  constructor(config,store,workspace,provider,publisher){Object.assign(this,{c:config,s:store,w:workspace,provider,publisher});this.active=new Map();}
  create({project,instructions,budget,provider}){
    const p=projectFor(this.c,project);
    if(typeof instructions!=='string'||instructions.trim().length<5||instructions.length>16000)throw Error('INVALID_INSTRUCTIONS');
    if(/(?:sk-[a-zA-Z0-9_-]{16,}|-----BEGIN .*PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{20,})/.test(instructions))throw Error('DO_NOT_SUBMIT_SECRETS');
    if(provider&&provider!==this.c.provider)throw Error('PROVIDER_CHANGE_REQUIRES_CONFIGURATION');
    if(p.mode==='preparation'&&!p.repository&&Object.values(this.c.projects).some(other=>other.enabled&&other.repository&&instructions.includes(other.repository)))throw Error('PROJECT_SELECTION_MISMATCH');
    if(Object.values(this.c.projects).some(other=>other.id!==p.id&&other.repository&&other.repository!==p.repository&&instructions.toLowerCase().includes(other.repository.toLowerCase())))throw Error('PROJECT_SELECTION_MISMATCH');
    const cap=budget??Math.min(p.taskCap,p.projectCap);
    if(!Number.isSafeInteger(cap)||cap<=0||cap>p.taskCap||cap>p.projectCap)throw Error('INVALID_BUDGET');
    if(this.s.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE state NOT IN ('completed','failed','cancelled')").get().n>=100)throw Error('QUEUE_FULL');
    const t=this.s.create(project,instructions.trim(),cap,this.c.provider);
    if(classifyTask(actionablePolicyText(instructions)).approvalRequired){t.state='awaiting_approval';t.gate='scope';t.reason='La instrucción cruza una acción protegida. Rechazar y crear una tarea de desarrollo sin esa operación.';this.s.save(t);this.s.event(t.id,'scope_blocked');}
    return t;
  }
  control(id,action){
    const t=this.s.get(id);if(terminal.has(t.state))throw Error('TERMINAL_TASK');
    if(action==='pause'){
      if(!['pending','running'].includes(t.state))throw Error('INVALID_TRANSITION');
      t.state='paused';this.s.save(t);this.active.get(id)?.abort();
    }else if(action==='resume'){
      if(t.state!=='paused')throw Error('INVALID_TRANSITION');
      if(this.active.has(id))throw Error('STEP_STILL_STOPPING');
      if(t.inflight){t.state='awaiting_approval';t.gate='recovery';t.reason='Paso interrumpido: revisar efectos antes de reanudar.';}else t.state='pending';this.s.save(t);
    }else if(action==='cancel'||action==='reject'){
      t.state='cancelled';this.s.save(t);this.active.get(id)?.abort();
    }else if(action==='approve'){
      if(t.state!=='awaiting_approval')throw Error('INVALID_TRANSITION');
      if(t.gate==='scope')throw Error('PROTECTED_OPERATION_NOT_IMPLEMENTED');
      if(t.gate==='delivery'){
        if(t.provider==='simulation'||!projectFor(this.c,t.project).repository){t.state='completed';t.reason='Entregable local aprobado; no publicado.';}
        else {if(!this.c.publishing)throw Error('PUBLISH_NOT_CONFIGURED');t.phase='publish';t.state='pending';}
      }else if(t.gate==='recovery'){
        // Interrupted LLM calls keep their full reservation. Tool mutation is never replayed.
        // For uncertain tools drop remaining calls and re-inspect the workspace on a fresh model turn.
        if(t.inflight?.kind==='tool'){const index=t.messages.findIndex(m=>m.role==='assistant'&&m.tool_calls?.some(c=>!t.messages.some(r=>r.tool_call_id===c.id)));if(index>=0)t.messages=t.messages.slice(0,index);}
        t.pendingCalls=[];t.inflight=null;
        if(t.phase==='workspace'){t.state='failed';t.reason='Workspace interrumpido. Conservar para inspección y crear otra tarea; no repetir inicialización.';}
        else {t.state='pending';t.messages.push({role:'user',content:'Operator reviewed interruption. Re-inspect files and diff before further edits. Do not assume previous tool succeeded.'});}
      }else throw Error('UNKNOWN_APPROVAL_GATE');this.s.save(t);
    }else throw Error('INVALID_ACTION');
    this.s.event(id,'owner_'+action,{state:t.state,gate:t.gate});return t;
  }
  async tick(){
    if(this.active.size)return;
    const t=this.s.list().reverse().find(t=>t.state==='pending');if(!t)return;
    const controller=new AbortController();this.active.set(t.id,controller);
    const started=Date.now();const remaining=this.c.maxTaskMs-(t.elapsedMs||0);
    const timeout=setTimeout(()=>controller.abort(),Math.max(1,remaining));
    try{
      const p=projectFor(this.c,t.project);if(t.provider!==this.c.provider)throw Error('PROVIDER_CONFIGURATION_CHANGED');
      if(t.phase!=='publish'&&!providerReady(this.c))throw Error('PROVIDER_NOT_CONFIGURED');
      // Do not spend model budget on edits that cannot be verified. No host fallback.
      if(t.phase!=='publish'&&t.provider!=='simulation'&&p.mode==='development'&&!readOnlyTask(t.instructions))await this.w.checkAvailability();
      t.state='running';this.s.save(t);this.s.event(t.id,'worker_started',{phase:t.phase});
      if(t.phase==='workspace'){
        t.inflight={kind:'workspace'};this.s.save(t);await this.w.prepare(t,p);t.inflight=null;t.phase='model';
        t.messages=[{role:'system',content:engineeringInstructions(t.project,p.mode)},{role:'user',content:t.instructions}];this.checkpoint(t);
        this.s.event(t.id,'repository_snapshot',{repository:p.repository,baseBranch:p.baseBranch,base:t.base,branch:t.branch,workspace:`workspaces/${t.project}/${t.id}`});
      }
      if(t.phase==='publish'){
        t.inflight={kind:'publish'};this.checkpoint(t);t.delivery=await this.publisher.publish(t,p,()=>this.checkpoint(t));
        t.inflight=null;const current=this.s.get(t.id);t.state=['cancelled','paused','awaiting_approval'].includes(current.state)?current.state:'completed';t.gate=current.gate;t.reason=current.reason;this.s.save(t);this.s.event(t.id,'pr_created',t.delivery);return;
      }
      while(this.s.get(t.id).state==='running'){
        controller.signal.throwIfAborted();if(Date.now()-started>remaining)throw Error('TASK_TIMEOUT');
        if(t.steps>=this.c.maxSteps)throw Error('STEP_LIMIT');
        if(t.pendingCalls?.length){
          const call=t.pendingCalls[0];t.inflight={kind:'tool',id:call.id,name:call.function?.name};this.checkpoint(t);
          let result;try{result=await this.execute(t,p,call,controller.signal);}catch(e){
            if(controller.signal.aborted)throw e;
            // Validation failures are critical; do not let a model keep probing permissions.
            this.s.event(t.id,'tool_failed',{tool:call.function?.name,code:['FILE_NOT_FOUND','REPOSITORY_READ_FAILED'].includes(e.message)?e.message:'TOOL_BLOCKED_OR_FAILED'});
            throw Error(['REPOSITORY_READ_FAILED','SANDBOX_NOT_AVAILABLE','REMOTE_DISPATCH_UNCERTAIN','ACTIONS_NOT_CONFIGURED_OR_BUDGET_UNCONFIRMED','ACTIONS_MINUTES_EXHAUSTED'].includes(e.message)?e.message:'TOOL_BLOCKED_OR_FAILED');
          }
          t.messages.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(result)});t.pendingCalls.shift();t.inflight=null;t.steps++;t.files=await this.w.diff(t);
          this.checkpoint(t);this.s.event(t.id,'tool_completed',{tool:call.function.name,files:t.files,...(call.function.name==='list_repository_files'?{listing:{status:result.status,totalFiles:result.totalFiles,matchedCount:result.matchedCount,paths:result.files.slice(0,50)}}:{})});continue;
        }
        if(t.noProgress)throw Error('NO_PROGRESS');
        if(Buffer.byteLength(JSON.stringify(t.messages))>160000)throw Error('CONTEXT_LIMIT');
        validateToolSequence(t.messages);
        const amount=this.provider.estimate(t.messages);const reservationId=this.s.reserve(t,amount,p.projectCap,this.c.globalCap);
        t.inflight={kind:'provider'};this.checkpoint(t);
        const response=await this.provider.next(t.messages,controller.signal);
        controller.signal.throwIfAborted();
        const promptTokens=Number(response.usage?.prompt_tokens),completionTokens=Number(response.usage?.completion_tokens);
        if(Number.isSafeInteger(promptTokens)&&promptTokens>=0&&Number.isSafeInteger(completionTokens)&&completionTokens>=0){const actual=Math.ceil(promptTokens*this.c.inputRate+completionTokens*this.c.outputRate);if(actual<=amount)this.s.settle(t,reservationId,actual);}
        // Missing or inconsistent usage is never assumed free; retain the full reservation.
        t.usage.input+=Number(response.usage?.prompt_tokens||0);t.usage.output+=Number(response.usage?.completion_tokens||0);
        t.messages.push(response.message);t.inflight=null;t.steps++;
        if(response.message.tool_calls?.length){t.pendingCalls=structuredClone(response.message.tool_calls);this.checkpoint(t);}
        else{
          t.summary=(response.message.content||'').slice(0,16000);t.files=await this.w.diff(t);t.state='awaiting_approval';t.gate='delivery';
          t.reason=t.provider==='simulation'?'Simulación, sin inferencia pagada. Revisar entregable.':'Revisar cambios y pruebas antes de preparar PR.';
          // Read-only diagnostics cannot change code and must not require a paid remote check.
          // Keep the passing-check gate for every task that modified files.
          if(t.provider!=='simulation'&&p.mode!=='preparation'&&t.files.length>0&&!t.checks.some(c=>c.passed&&c.revision===(t.revision||0)))throw Error('PASSING_CHECK_REQUIRED');
          this.s.save(t);this.s.event(t.id,'delivery_ready',{files:t.files,checks:t.checks.map(c=>({check:c.check,passed:c.passed}))});return;
        }
      }
    }catch(e){
      const current=this.s.get(t.id);
      if(['paused','cancelled','awaiting_approval'].includes(current.state)){
        // Finish an in-flight atomic step, retaining requested control state and its recovery marker.
        t.state=current.state;t.gate=current.gate;t.reason=current.reason;this.s.save(t);this.s.event(t.id,'worker_stopped',{state:t.state,inflight:t.inflight??null});
      }else if(e.message==='REMOTE_DISPATCH_UNCERTAIN'){t.state='awaiting_approval';t.gate='recovery';t.reason='Resultado del envío remoto incierto. No se reintenta automáticamente; revisar el job antes de continuar.';this.s.save(t);this.s.event(t.id,'remote_dispatch_review_required');}
      else{t.state='failed';t.reason=controller.signal.aborted?'TASK_TIMEOUT':/^[A-Z_0-9]+$/.test(e.message)?e.message:'EXECUTION_FAILED';this.s.save(t);this.s.event(t.id,'worker_failed',{reason:t.reason});}
    }finally{clearTimeout(timeout);const latest=this.s.get(t.id);latest.elapsedMs=(latest.elapsedMs||0)+Date.now()-started;this.s.save(latest);this.active.delete(t.id);}
  }
  checkpoint(t){const current=this.s.get(t.id);if(['paused','cancelled','awaiting_approval'].includes(current.state)){t.state=current.state;t.gate=current.gate;t.reason=current.reason;}this.s.save(t);}
  async execute(t,p,call,signal){
    if(t.project!==p.id||projectFor(this.c,t.project).repository!==p.repository)throw Error('PROJECT_NOT_AUTHORIZED');
    const name=call.function?.name;const definition=tools.find(t=>t.function.name===name);if(!definition)throw Error('TOOL_NOT_AUTHORIZED');
    const args=JSON.parse(call.function.arguments);if(!args||typeof args!=='object'||Array.isArray(args))throw Error('INVALID_ARGUMENTS');
    const schema=definition.function.parameters;
    if(Object.keys(args).some(k=>!Object.hasOwn(schema.properties,k))||schema.required.some(k=>!(k in args))||Object.values(args).some(v=>typeof v!=='string'))throw Error('INVALID_ARGUMENTS');
    if(name==='list_repository_files'){
      const query=['*','**/*','.'].includes(args.query)?'':args.query;
      const inventory=await this.w.list(t,'');
      const files=query?inventory.filter(path=>path.includes(query)):inventory;
      const result={status:files.length?'ok':query?'no_matches':'empty_workspace',queryMode:'literal_substring',totalFiles:inventory.length,matchedCount:files.length,inventoryLimit:3000,possiblyTruncated:inventory.length===3000,files,
        ...(files.length?{}:{hint:'Use query empty string for inventory. Do not guess files or repeat empty searches.'})};
      this.observe(t,'list:'+query,files.length===0);return result;
    }
    if(name==='read_repository_file'){
      if(t.observationRevision===(t.revision||0)&&t.observationCounts?.['read:'+args.path]){
        this.observe(t,'read:'+args.path,false);
        return {status:'already_read',path:args.path,revision:t.revision||0,hint:'Use the earlier tool result. The file has not changed; do not request it again.'};
      }
      try{const content=await this.w.read(t,args.path);this.observe(t,'read:'+args.path,false);return content;}
      catch(error){if(error.message!=='FILE_NOT_FOUND')throw error;this.observe(t,'missing:'+args.path,true);return {status:'not_found',hint:'File does not exist in this task checkout. List files with query empty string; do not guess paths.'};}
    }
    if(['write_repository_file','replace_repository_text'].includes(name)&&readOnlyTask(t.instructions))throw Error('READ_ONLY_TASK');
    if(name==='write_repository_file'){const result=await this.w.write(t,p,args.path,args.content);t.revision=(t.revision||0)+1;t.noProgress=false;return result;}
    if(name==='replace_repository_text'){const result=await this.w.replace(t,p,args.path,args.oldText,args.newText);if(!result?.error){t.revision=(t.revision||0)+1;t.noProgress=false;}return result;}
    if(name==='inspect_diff')return this.w.diff(t);
    if(name==='run_safe_check'){
      // A read-only diagnostic must not dispatch CI or sandbox checks, even if the model asks.
      const readOnly=readOnlyTask(t.instructions);
      if(readOnly){const changed=await this.w.diff(t);if(changed.length===0)return {check:args.check,passed:false,skipped:true,reason:'READ_ONLY_DIAGNOSTIC_NO_CHECKS',hint:'Complete the diagnostic from repository evidence; do not request further checks.'};}
      let result;
      try { result=await this.w.run(t,p,args.check,signal); }
      catch(error){
        if(error.message!=='SANDBOX_NOT_AVAILABLE')throw error;
        const changed=await this.w.diff(t);
        if(changed.length>0)throw error; // Never waive the check gate for modified code.
        return {check:args.check,passed:false,skipped:true,reason:'SANDBOX_NOT_AVAILABLE_READ_ONLY',hint:'Sandbox is unavailable and no files changed. Finish with a read-only report; code edits require isolated checks.'};
      }
      t.checks.push({...result,revision:t.revision||0,at:new Date().toISOString()});return result;
    }
    throw Error('TOOL_NOT_AUTHORIZED');
  }
  observe(t,key,empty){
    if(t.observationRevision!==(t.revision||0)){t.observationRevision=t.revision||0;t.observationCounts={};t.emptyObservations=0;t.noProgress=false;}
    t.observationCounts??={};const count=(t.observationCounts[key]||0)+1;t.observationCounts[key]=count;
    t.emptyObservations=empty?(t.emptyObservations||0)+1:0;
    // Persisted with the tool checkpoint. Stop before reserving another model call.
    if(count>=2||t.emptyObservations>=3)t.noProgress=true;
  }
  async stop(){for(const [id,controller] of this.active){const t=this.s.get(id);if(t.state==='running'){t.state='awaiting_approval';t.gate='recovery';t.reason='Servidor detenido. Revisar el último paso antes de continuar.';this.s.save(t);this.s.event(id,'graceful_recovery_required');}controller.abort();}while(this.active.size)await new Promise(r=>setTimeout(r,10));}
}
