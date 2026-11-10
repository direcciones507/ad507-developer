import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createSession,getSession,verify,digest } from './auth.mjs';
import { projectFor,providerReady } from './config.mjs';
import { projectToken } from './projects.mjs';
const assets={'/':'panel.html','/panel.js':'panel.js','/panel.css':'panel.css'};
export function publicTask(t){const {messages,inflight,...safe}=t;return {...safe,interrupted:inflight?{kind:inflight.kind,name:inflight.name}:null};}
export function createApp(c,s,e){
  if(!/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(c.ownerHash||''))throw Error('OWNER_PASSWORD_HASH_REQUIRED');
  if(c.ownerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.ownerEmail))throw Error('OWNER_EMAIL_INVALID');
  const origin=new URL(c.origin);if(origin.protocol!=='https:'&&!(origin.protocol==='http:'&&['127.0.0.1','localhost'].includes(origin.hostname)&&['127.0.0.1','localhost'].includes(c.host)))throw Error('HTTPS_REQUIRED');
  const secure=origin.protocol==='https:';const cookieName=secure?'__Host-ad507':'ad507';const attempts=new Map();
  const cookie=(token,maxAge=43200)=>`${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure?'; Secure':''}`;
  return createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
    try{
      if(req.method==='GET'&&req.url==='/health')return send(200,{status:'ok'});
      if(req.headers.host!==origin.host)return send(403,{error:'INVALID_HOST'});
      const url=new URL(req.url,c.origin),path=url.pathname;
      if(req.method==='GET'&&path==='/health')return send(200,{status:'ok'});
      const runner=path.match(/^\/api\/runner\/checks\/([a-f0-9-]{36})\/(claim|snapshot|complete)$/);
      if(runner){
        if(!e.w.remote)return send(503,{error:'REMOTE_RUNNER_NOT_CONFIGURED'});
        const token=req.headers.authorization?.startsWith('Bearer ')?req.headers.authorization.slice(7):'';
        const id=runner[1],operation=runner[2];e.w.remote.authenticate(id,token);
        if(req.method==='GET'&&operation==='snapshot'){
          const data=await e.w.remote.payload(id,token,req.headers['x-ad507-run-id']);
          res.writeHead(200,{'Content-Type':'application/gzip','Content-Length':data.length});res.end(data);return;
        }
        if(req.method!=='POST'||operation==='snapshot')return send(405,{error:'METHOD_NOT_ALLOWED'});
        if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'JSON_REQUIRED'});
        let raw='';for await(const chunk of req){raw+=chunk.toString('utf8');if(Buffer.byteLength(raw)>128000)return send(413,{error:'BODY_TOO_LARGE'});}
        const body=JSON.parse(raw||'{}');
        if(operation==='claim')return send(200,await e.w.remote.claim(id,token,body));
        return send(200,e.w.remote.complete(id,token,body.identity,body.result));
      }

      if(req.method==='GET'&&assets[path]){const data=await readFile(new URL(assets[path],import.meta.url));res.writeHead(200,{'Content-Type':path.endsWith('.js')?'text/javascript; charset=utf-8':path.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8'});res.end(data);return;}
      if(!path.startsWith('/api/'))return send(404,{error:'NOT_FOUND'});
      if(!['GET','POST'].includes(req.method))return send(405,{error:'METHOD_NOT_ALLOWED'});
      if(req.method==='POST'&&req.headers.origin!==c.origin)return send(403,{error:'ORIGIN_REQUIRED'});
      let body={};if(req.method==='POST'){
        if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'JSON_REQUIRED'});
        let raw='';for await(const chunk of req){raw+=chunk.toString('utf8');if(Buffer.byteLength(raw)>32000)return send(413,{error:'BODY_TOO_LARGE'});}body=JSON.parse(raw||'{}');
      }
      if(req.method==='POST'&&path==='/api/auth/hash-check'){
        const ip=req.socket.remoteAddress,now=Date.now(),key='hash-check:'+ip;
        const rate=attempts.get(key)||{count:0,until:now+15*60*1000};
        if(now>=rate.until){rate.count=0;rate.until=now+15*60*1000;}
        if(rate.count>=5)return send(429,{error:'CHECK_RATE_LIMIT'});
        rate.count++;attempts.set(key,rate);
        const candidate=body.hash;
        if(typeof candidate!=='string'||!/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(candidate))return send(400,{error:'HASH_FORMAT_INVALID'});
        const matches=timingSafeEqual(Buffer.from(candidate,'utf8'),Buffer.from(c.ownerHash,'utf8'));
        return send(200,{matches});
      }
      if(req.method==='POST'&&path==='/api/login'){
        const ip=req.socket.remoteAddress;const now=Date.now();for(const [key,a] of attempts)if(a.until<now)attempts.delete(key);
        const rate=attempts.get(ip)||{count:0,until:now+15*60*1000};
        if(rate.count>=5)return send(429,{error:'LOGIN_RATE_LIMIT'});
        const validEmail=!c.ownerEmail||(typeof body.email==='string'&&body.email.trim().toLowerCase()===c.ownerEmail);
        // Always perform password verification, including when the email is wrong.
        const validPassword=verify(body.password,c.ownerHash);
        if(!validEmail||!validPassword){rate.count++;attempts.set(ip,rate);s.event(null,'login_failed');return send(401,{error:'INVALID_LOGIN'});}
        attempts.delete(ip);const session=createSession(s);res.setHeader('Set-Cookie',cookie(session.token));s.event(null,'login_success');return send(200,{csrf:session.csrf});
      }
      const session=getSession(s,req.headers.cookie,cookieName);if(!session)return send(401,{error:'AUTHENTICATION_REQUIRED'});
      if(req.method==='POST'&&req.headers['x-csrf-token']!==session.csrf)return send(403,{error:'CSRF_REQUIRED'});
      if(req.method==='POST'&&path==='/api/logout'){s.db.prepare('DELETE FROM sessions WHERE hash=?').run(session.hash);res.setHeader('Set-Cookie',cookie('',0));return send(200,{ok:true});}
      if(req.method==='GET'&&path==='/api/executor/github-access'){
        if(c.checkBackend!=='github-actions'||!e.w.remote)return send(200,{ready:false,reason:'GITHUB_ACTIONS_NOT_SELECTED'});
        try{
          const workflow=await e.w.remote.api('actions/workflows/remote-check.yml');
          return send(200,{ready:true,workflowState:workflow.state,workflowId:workflow.id,workflowPath:workflow.path,dispatchPermission:'NOT_VERIFIED_BY_READ'});
        }catch(error){
          const code=/^ACTIONS_HTTP_\\d{3}$/.test(error.message)?error.message:'GITHUB_ACCESS_CHECK_FAILED';
          return send(200,{ready:false,reason:code});
        }
      }
      if(req.method==='GET'&&path==='/api/executor/preflight'){
        const details=c.checkBackend==='github-actions'?{
          tokenConfigured:Boolean(c.actionsToken),
          includedMinutesConfirmed:Boolean(c.actionsIncludedOnly),
          monthlyMinutesValid:Number.isSafeInteger(c.actionsMonthlyMinutes)&&c.actionsMonthlyMinutes>=10,
          workflowSHAValid:/^[a-f0-9]{40}$/.test(c.actionsSHA||''),
          workflowRefConfigured:Boolean(c.actionsRef),
          monthlyMinutesRemaining:Math.max(0,c.actionsMonthlyMinutes-(e.w.remote?.usage()||0)),
          projectChecksConfigured:Object.values(c.projects).filter(p=>p.enabled&&p.mode==='development').map(p=>({project:p.id,checks:p.checks}))
        }:null;
        try{await e.w.checkAvailability();return send(200,{ready:true,backend:c.checkBackend,details});}
        catch(error){return send(200,{ready:false,backend:c.checkBackend,reason:error.message==='ACTIONS_NOT_CONFIGURED_OR_BUDGET_UNCONFIRMED'?'ACTIONS_NOT_CONFIGURED_OR_BUDGET_UNCONFIRMED':'ISOLATED_EXECUTOR_UNAVAILABLE',details});}
      }
      if(req.method==='POST'&&path==='/api/budget/limit'){
        const usd=body.usd,amount=typeof usd==='number'?Math.round(usd*1000000):NaN;
        if(!Number.isFinite(usd)||!Number.isSafeInteger(amount)||Math.abs(amount/1000000-usd)>0.0000001||body.confirm!=='AUTORIZO')return send(400,{error:'BUDGET_CONFIRMATION_REQUIRED'});
        return send(200,s.setGlobalBudgetLimit(amount,c.globalCap));
      }
      if(req.method==='POST'&&path==='/api/budget/reset-old'){
        if(body.confirm!=='BORRAR HISTORIAL ANTIGUO')return send(400,{error:'RESET_CONFIRMATION_REQUIRED'});
        return send(200,s.resetOldWork());
      }
      if(req.method==='GET'&&path==='/api/budget/audit')return send(200,s.budgetAudit());
      if(req.method==='GET'&&path==='/api/status')return send(200,{csrf:session.csrf,provider:c.provider,ready:providerReady(c),live:c.live,publishing:c.publishing,checkBackend:c.checkBackend||'local-docker',sourceMode:c.sourceMode||'manual',
        remote:e.w.remote?{ready:e.w.remote.ready(),minutesReserved:e.w.remote.usage(),minutesLimit:c.actionsMonthlyMinutes}:null,
        budget:{reserved:s.globalUsage(),limit:s.globalBudgetLimit(c.globalCap),breakdown:s.budgetBreakdown()},projects:Object.values(c.projects).filter(p=>p.enabled).map(p=>({id:p.id,name:p.name,mode:p.mode,repository:p.repository,baseBranch:p.baseBranch,checks:p.checks,sourceReady:!!p.source||p.mode==='preparation'||Boolean(c.sourceMode==='github'&&projectToken(c,p)),budget:p.projectCap,reserved:s.projectUsage(p.id),taskCap:p.taskCap}))});
      if(path==='/api/projects'&&req.method==='POST'){if(!c.registry)throw Error('PROJECT_REGISTRY_UNAVAILABLE');const p=c.registry.register(body);return send(201,{id:p.id,name:p.name,repository:p.repository,mode:p.mode,baseBranch:p.baseBranch});}
      if(path==='/api/tasks'&&req.method==='GET')return send(200,s.list().map(publicTask));
      if(path==='/api/tasks'&&req.method==='POST')return send(201,publicTask(e.create(body)));
      const match=path.match(/^\/api\/tasks\/([a-f0-9-]{36})(?:\/(events|file|control))?$/);
      if(match){const id=match[1],t=s.get(id);projectFor(c,t.project);
        if(t.branch){try{t.files=await e.w.diff(t);}catch{/* Incomplete workspace remains quarantined. */}}
        if(req.method==='GET'&&!match[2])return send(200,{...publicTask(t),remoteChecks:e.w.remote?.taskJobs(id)||[]});
        if(req.method==='GET'&&match[2]==='events')return send(200,s.events(id));
        if(req.method==='GET'&&match[2]==='file'){const file=url.searchParams.get('path');if(!t.files.includes(file))throw Error('FILE_NOT_IN_DELIVERABLE');return send(200,{path:file,content:await e.w.read(t,file)});}
        if(req.method==='POST'&&match[2]==='control'){
          if(body.action==='recover'){
            if(t.state!=='failed'||t.reason!=='BUDGET_EXHAUSTED'||t.phase!=='model'||!t.branch)throw Error('RECOVERY_NOT_ELIGIBLE');
            const changed=await e.w.diff(t);
            if(!changed.length)throw Error('NO_RECOVERABLE_CHANGES');
            t.files=changed;t.pendingCalls=[];t.inflight=null;t.state='awaiting_approval';t.gate='delivery';
            t.summary='Se recuperaron '+changed.length+' archivos de una tarea detenida por presupuesto. Entrega parcial sin pruebas y sin publicación. Revisar los cambios antes de aprobar.';
            t.reason='Recuperación de archivos tras BUDGET_EXHAUSTED. Trabajo incompleto y no verificado.';
            s.save(t);s.event(id,'delivery_unverified',{files:changed,reason:'RECOVERED_BUDGET_EXHAUSTED'});
            s.event(id,'delivery_ready',{files:changed,partial:true,stopReason:'BUDGET_EXHAUSTED'});
            return send(200,publicTask(t));
          }
          return send(200,publicTask(e.control(id,body.action)));
        }
      }
      return send(404,{error:'NOT_FOUND'});
    }catch(err){const error=/^[A-Z_0-9]+$/.test(err.message)?err.message:'REQUEST_FAILED';send(error==='TASK_NOT_FOUND'?404:400,{error});}
  });
}
