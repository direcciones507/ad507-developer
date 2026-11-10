'use strict';
const $=id=>document.getElementById(id);let csrf='',selected=null,status=null,busy=false,showAllTasks=false,lastBudgetProject=null,correctionSource=null,taskBudgetManual=false,lastGlobalBudget=null,lastDetailSignature='',lastTaskListSignature='';
const labels={pending:'Pendiente',running:'Ejecutando',paused:'Pausado',awaiting_approval:'Esperando aprobación',completed:'Completado',failed:'Fallido',cancelled:'Cancelado'};
// Budget validation preserves the owner's requested amount; deployment sync 2026-11-09.
const money=n=>'$'+(n/1000000).toFixed(4);
const taskState=(state,gate)=>state==='awaiting_approval'?(gate==='recovery'?'Revisión de recuperación':gate==='delivery'?'Entrega lista para revisión':'Requiere autorización'):labels[state]||state;
async function api(path,method='GET',data){const r=await fetch('/api/'+path,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:data?JSON.stringify(data):undefined});const json=await r.json();if(!r.ok){if(r.status===401){$('app').hidden=true;$('login').hidden=false;$('logout').hidden=true;}throw Error(json.error||'REQUEST_FAILED');}return json;}
function node(tag,text){const el=document.createElement(tag);el.textContent=text;return el;}
function showError(e){const message=$('message');message.hidden=false;message.textContent=e.message==='PROJECT_SELECTION_MISMATCH'?'El servidor detectó otro proyecto en el objetivo de la tarea. Proyecto seleccionado: '+(status?.projects?.find(p=>p.id===$('project').value)?.name||$('project').value)+'. Selecciona el proyecto correcto arriba o ajusta el encabezado PROYECTO/REPOSITORIO OBJETIVO de las instrucciones.':e.message==='INVALID_BUDGET'?'El servidor rechazó el límite de la tarea. Revisa el límite global y el importe introducido.':e.message;message.scrollIntoView({block:'center',behavior:'smooth'});}
function projectInfo(){const p=status.projects.find(p=>p.id===$('project').value);if(!p)return;const maximum=status.budget.limit;const remaining=Math.max(0,status.budget.limit-status.budget.reserved);const input=$('budget');input.removeAttribute('max');if(lastBudgetProject!==p.id||lastGlobalBudget!==maximum){lastBudgetProject=p.id;lastGlobalBudget=maximum;if(!taskBudgetManual){input.value=(Math.max(1,maximum-10000)/1000000).toFixed(2);}}const requested=Math.round(Number(input.value)*1000000);const valid=Number.isSafeInteger(requested)&&requested>=1&&requested<=maximum;input.setCustomValidity(valid?'':'El límite de la tarea debe ser entre US$0.000001 y '+money(maximum)+'.');$('scope').textContent=p.mode==='preparation'?'Preparación y documentación. La web aún no se construye.':`Repositorio ${p.repository}. Espacio aislado ${p.sourceReady?'configurado':'pendiente de aprovisionar'}.`;$('project-budget').textContent=`Contabilidad histórica del proyecto: ${money(p.reserved)} (referencia configurada: ${money(p.budget)}, no es un límite adicional de consumo). Total histórico registrado: ${money(status.budget.reserved)} / ${money(status.budget.limit)}. Liquidado con comprobante interno: ${money(status.budget.breakdown?.settledHistorical??0)}. Sin comprobante interno individual: ${money(status.budget.breakdown?.unattributedHistorical??0)}. Saldo autorizado por el control acumulativo: ${money(remaining)}. Este NO es el gasto de hoy ni el saldo de DeepSeek; se necesita conciliación externa antes de liberar importes. El límite de la tarea NO se reserva completo al crearla; cada llamada reserva su costo estimado y se bloquea si no alcanza el saldo. ${remaining<=0?'Sin saldo para llamadas nuevas.':''} Las reservas interrumpidas requieren conciliación verificable.`;}

async function refresh(){
  status=await api('status');csrf=status.csrf;$('login').hidden=true;$('app').hidden=false;$('logout').hidden=false;if(!$('task-form').contains($('message')))$('task-form').append($('message'));
  $('provider').textContent=`Proveedor: ${status.provider}${status.provider==='simulation'?' · SIMULACIÓN':''}`;$('readiness').textContent=status.provider==='simulation'?'Modo de prueba: sin llamadas a modelos externos.':status.ready?'Integración configurada; la prueba real debe verificarse.':'Inferencia detenida: faltan credencial o configuración autorizada.';
  $('runner-status').textContent=status.checkBackend==='github-actions'?`Ejecutor GitHub Actions: ${status.remote?.ready?'configurado':'pendiente de configuración'}. La cuota de minutos la administra GitHub; no hay un límite interno de minutos para la tarea.`:'Ejecutor Docker local: requiere un host e imagen revisados.';
  const previous=$('project').value;
  const successor=p=>p.mode==='preparation'&&!p.repository?status.projects.find(other=>other.mode==='development'&&other.repository&&other.name.startsWith(p.name)):null;
  const preferred=status.projects.find(p=>successor(p));
  $('project').replaceChildren();for(const p of status.projects){const archived=successor(p);const o=node('option',archived?`Histórico de preparación · ${p.name}`:p.name||p.id);o.value=p.id;o.disabled=Boolean(archived);$('project').append(o);}
  const previousProject=status.projects.find(p=>p.id===previous);
  if(previousProject)$('project').value=successor(previousProject)?.id||previous;
  else if(preferred)$('project').value=successor(preferred).id;
  projectInfo();
  const tasks=await api('tasks');const filter=$('task-filter').value;const filtered=tasks.filter(t=>filter==='all'||(filter==='active'&&['pending','running','paused'].includes(t.state))||(filter==='review'&&t.state==='awaiting_approval')||(filter==='completed'&&t.state==='completed')||(filter==='closed'&&['failed','cancelled'].includes(t.state)));const listSignature=JSON.stringify([filter,showAllTasks,filtered.map(t=>[t.id,t.state,t.instructions])]);const updateTaskList=listSignature!==lastTaskListSignature;if(updateTaskList){lastTaskListSignature=listSignature;$('tasks').replaceChildren();}if(updateTaskList&&!filtered.length)$('tasks').append(node('p','No hay trabajos en esta categoría.'));
  for(const t of (updateTaskList?(showAllTasks?filtered:filtered.slice(0,3)):[])){const b=node('button',`${labels[t.state]||t.state} · ${t.project}`);b.className='task';b.append(node('small',t.instructions.slice(0,100)));b.addEventListener('click',async()=>{try{await detail(t.id);$('detail').scrollIntoView({behavior:'smooth',block:'start'});}catch(error){showError(error);}});$('tasks').append(b);}
  if(updateTaskList&&filtered.length>3){const more=node('button',showAllTasks?'Mostrar menos':`Ver todos los trabajos (${filtered.length})`);more.type='button';more.className='secondary';more.addEventListener('click',()=>{showAllTasks=!showAllTasks;refresh().catch(showError);});$('tasks').append(more);}
  $('task-counts').textContent=`Mostrando ${Math.min(filtered.length,showAllTasks?filtered.length:3)} de ${filtered.length} trabajos${filter==='all'?'': ' filtrados'}.`;
  if(selected)await detail(selected);
}
async function detail(id){if(selected!==id){$('file-content').hidden=true;$('file-content').textContent='';}selected=id;const t=await api('tasks/'+id);const events=await api('tasks/'+id+'/events');const detailSignature=JSON.stringify([id,t,events]);if(detailSignature===lastDetailSignature)return;lastDetailSignature=detailSignature;$('detail').hidden=false;$('task-title').textContent=t.project+' · '+id.slice(0,8);$('task-state').textContent=labels[t.state];$('task-reason').textContent=t.reason||'';
  $('controls').replaceChildren();let actions=[];if(['pending','running'].includes(t.state))actions.push(['pause','Pausar']);if(t.state==='paused')actions.push(['resume','Reanudar']);if(t.state==='awaiting_approval'&&t.gate!=='scope'){if(t.gate==='delivery'&&!status.publishing){const msg=$('task-action-result');msg.hidden=false;msg.textContent='Publicación de Pull Requests desactivada en Railway (AD507_PUBLISH_ENABLED). Los cambios siguen seguros en el espacio de trabajo; no se han enviado a GitHub.';}else actions.push(['approve',t.gate==='recovery'?'Revisé la interrupción; continuar':'Aprobar entrega']);actions.push(['reject','Rechazar']);}if(!['completed','failed','cancelled'].includes(t.state))actions.push(['cancel','Cancelar']);
  if(t.state==='failed'&&t.reason==='TASK_TIMEOUT'&&t.phase==='model'&&t.branch){
    const resumeOriginal=node('button','Retomar tarea original sin crear otra');resumeOriginal.type='button';resumeOriginal.className='secondary';
    resumeOriginal.addEventListener('click',async()=>{
      resumeOriginal.disabled=true;
      try{
        const resumed=await api('tasks/'+id+'/control','POST',{action:'resume_failed'});
        await refresh();
        const out=$('task-action-result');out.hidden=false;
        out.textContent='Tarea original recuperada con el mismo presupuesto autorizado. Estado: '+(resumed.state||'pendiente')+'.';
      }catch(e){
        const out=$('task-action-result');out.hidden=false;
        out.textContent='No se recuperó el trabajo: '+e.message+'. No se creó otra tarea.';
      }finally{resumeOriginal.disabled=false;}
    });
    $('controls').append(resumeOriginal);
  }
  if(t.state==='failed'&&['BUDGET_EXHAUSTED','CHECK_NOT_AUTHORIZED'].includes(t.reason)&&t.files?.length){
    const recover=node('button','Recuperar cambios sin gastar en IA');recover.type='button';recover.className='secondary';
    recover.addEventListener('click',async()=>{recover.disabled=true;try{await api('tasks/'+id+'/control','POST',{action:'recover'});await refresh();}catch(e){showError(e);}finally{recover.disabled=false;}});
    $('controls').append(recover);
  }
  for(const [action,label]of actions){const b=node('button',label);b.className=['cancel','reject'].includes(action)?'danger':'secondary';b.addEventListener('click',async()=>{b.disabled=true;try{const result=await api('tasks/'+id+'/control','POST',{action});await refresh();const out=$('task-action-result');out.hidden=false;out.textContent=action==='approve'?(result.phase==='publish'?'Entrega aprobada. Preparando Pull Request en GitHub.':'Aprobación registrada.'): 'Acción registrada correctamente.';}catch(e){const out=$('task-action-result');out.hidden=false;out.textContent=e.message==='PUBLISH_NOT_CONFIGURED'?'No se puede crear el Pull Request: la publicación de entregas en GitHub está deshabilitada o falta la configuración. No se han publicado cambios.':('No se pudo completar la acción: '+e.message);}finally{b.disabled=false;}});$('controls').append(b);}
  $('metrics').replaceChildren();for(const [label,value]of [['Rama',t.branch||'Por crear'],['Consumo contabilizado / máximo autorizado de la tarea',money(t.reserved)+' / '+money(t.budget)],['Pasos',t.steps],['Tokens entrada',t.usage.input],['Tokens salida',t.usage.output],['Etapa',t.phase],['Paso interrumpido',t.interrupted?.name||t.interrupted?.kind||'Ninguno']]){const d=node('div','');d.append(node('dt',label),node('dd',String(value)));$('metrics').append(d);}
  const overview=$('delivery-overview');overview.replaceChildren();
  const project=status?.projects?.find(p=>p.id===t.project);
  const completed=t.state==='awaiting_approval'&&t.gate==='delivery';
  const heading=completed?'Cambios preparados para tu revisión':t.state==='completed'?'Trabajo cerrado':t.state==='failed'?'El trabajo se detuvo':'Trabajo en proceso';
  overview.append(node('h4',heading));
  const files=t.files||[],checks=t.checks||[];
  const deliveryUrl=typeof t.delivery?.url==='string'&&t.delivery.url.startsWith('https://github.com/')?t.delivery.url:'';
  const testsText=checks.length?'Pruebas registradas: '+checks.length+'. '+(checks.every(c=>c.passed)?'Todas aprobadas.':'Hay pruebas fallidas.'):'No se ejecutaron pruebas automáticas: resultado sin verificar.';
  const pending=[];if(!deliveryUrl&&files.length)pending.push('enviar cambios a GitHub');if(!checks.length)pending.push('comprobar los cambios');if(completed)pending.push('aprobar la entrega para revisión');
  const fields=[['Proyecto trabajado',project?.name||t.project],['Problema identificado',t.reason||'No se registró una causa concreta.'],['Corrección realizada',t.summary||'No hay descripción suficiente para confirmar qué se corrigió.'],['Archivos modificados',files.length?files.join(', '):'Ninguno'],['Pendiente',pending.length?pending.join('; '):'Sin pendientes registrados'],['Pruebas',testsText],['Estado',deliveryUrl?'Cambios enviados a GitHub para revisión; no publicados en producción.':files.length?'Cambios preparados, pendientes de enviar a GitHub.':'Sin entrega de código confirmada.']];
  for(const [label,value]of fields){const d=node('div','');d.className='delivery-item';d.append(node('strong',label+': '),node('span',value));overview.append(d);}
  if(deliveryUrl){const a=node('a','Ver Pull Request en GitHub');a.href=deliveryUrl;a.target='_blank';a.rel='noopener noreferrer';overview.append(a);}
  if(project?.repository){const a=node('a','Abrir repositorio en GitHub');a.href='https://github.com/'+project.repository;a.target='_blank';a.rel='noopener noreferrer';overview.append(a);}
  if(completed)overview.append(node('p','Puedes revisar el resumen y solicitar una corrección con un nuevo trabajo. Aprobar entrega prepara la siguiente etapa de revisión; no significa publicar directamente en producción.'));
  if(t.state==='failed')overview.append(node('p','Motivo del fallo: '+(t.reason||'No especificado')+'.'));
  const deliveryActions=$('delivery-actions');deliveryActions.replaceChildren();
  if(t.previousTaskId){
    const original=node('button','Abrir trabajo original');original.type='button';original.className='secondary';
    original.addEventListener('click',async()=>{try{await detail(t.previousTaskId);$('detail').scrollIntoView({behavior:'smooth',block:'start'});}catch(error){showError(error);}});
    deliveryActions.append(original);
  }

  const viewResult=node('button','Ver resultado');viewResult.type='button';viewResult.className='secondary';
  viewResult.addEventListener('click',()=>overview.scrollIntoView({behavior:'smooth',block:'start'}));
  deliveryActions.append(viewResult);
  if(['awaiting_approval','completed','failed'].includes(t.state)&&!(t.state==='failed'&&t.reason==='TASK_TIMEOUT')){
    const correction=node('button','Crear nueva tarea de corrección');correction.type='button';correction.className='secondary';
    correction.addEventListener('click',()=>{
      const target=status?.projects?.find(p=>p.id===t.project);
      if(!target)return showError(new Error('PROYECTO_NO_DISPONIBLE'));
      $('project').value=t.project;correctionSource=t.id;projectInfo();
      const details=t.files?.length?'Archivos implicados: '+t.files.join(', ')+'. ':'';
      const previousDelivery=typeof t.delivery?.url==='string'&&/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[0-9]+$/.test(t.delivery.url)?' Pull Request anterior: '+t.delivery.url+'. ':'';
      $('instructions').value='CORRECCIÓN DE ENTREGA ANTERIOR ('+t.id.slice(0,8)+'). '+details+previousDelivery+'Comprueba primero los cambios existentes y evita duplicar modificaciones. Corrige lo siguiente: ';
      $('instructions').focus();$('instructions').scrollIntoView({behavior:'smooth',block:'center'});
      $('message').hidden=false;$('message').textContent='Describe la corrección y pulsa Crear e iniciar trabajo. ATENCIÓN: esta opción crea una tarea nueva y todavía no reutiliza automáticamente el espacio de trabajo anterior. Si hay cambios sin publicar en GitHub, no continúes hasta recuperarlos. No se enviará nada hasta que tú lo confirmes.';
    });
    deliveryActions.append(correction);
  }
  $('summary').textContent=t.summary||'El agente no proporcionó un resumen en lenguaje natural. No se puede determinar la corrección exacta únicamente por los nombres de archivos.';$('pr').replaceChildren();if(t.delivery?.url?.startsWith('https://github.com/')){const a=node('a','Abrir PR para revisión');a.href=t.delivery.url;a.target='_blank';a.rel='noopener noreferrer';$('pr').append(a);}
  $('checks').replaceChildren();if(!t.checks.length)$('checks').append(node('p','Sin pruebas de código ejecutadas en esta tarea.'));for(const check of t.checks){const d=node('details','');d.append(node('summary',`${check.check}: ${check.passed?'APROBADA':'FALLIDA'} · ${check.at||''}`),node('pre',check.output||'Sin salida'));$('checks').append(d);}
  $('remote-checks').replaceChildren();for(const check of t.remoteChecks||[]){const row=node('p',`${check.check}: ${check.state} · ${check.minutesReserved} min reservados `);if(check.runUrl?.startsWith('https://github.com/direcciones507/ad507-developer/actions/runs/')){const link=node('a','Ver ejecución');link.href=check.runUrl;link.target='_blank';link.rel='noopener noreferrer';row.append(link);}$('remote-checks').append(row);}
  $('files').replaceChildren();for(const path of t.files){const b=node('button',path);b.className='secondary';b.addEventListener('click',async()=>{try{const f=await api(`tasks/${id}/file?path=${encodeURIComponent(path)}`);$('file-content').hidden=false;$('file-content').textContent=f.content;}catch(e){showError(e);}});$('files').append(b);}
  $('events').replaceChildren();for(const event of events)$('events').append(node('li',`${event.created} · ${event.kind} · ${JSON.stringify(event.detail)}`));
  // The result view must not disguise an active or stalled task as a completed delivery.
  // Surface persisted, non-secret diagnostic events instead of a generic empty summary.
  const latest=events.length?events[events.length-1]:null;
  const diagnostic=node('p',`Estado técnico: ${t.state} · Fase: ${t.phase||'sin registrar'} · Pasos: ${t.steps??0} · Último evento: ${latest?.kind||'sin eventos'}${latest?.created?' ('+latest.created+')':''}.`);
  diagnostic.className='task-diagnostic';overview.append(diagnostic);
  const failure=[...events].reverse().find(event=>['tool_failed','worker_failed','budget_insufficient_for_next_call'].includes(event.kind));
  if(failure){const detail=failure.detail||{};overview.append(node('p',`Último bloqueo registrado: ${failure.kind} · ${detail.code||detail.reason||'sin código'}${detail.tool?' · Herramienta: '+detail.tool:''}.`));}
  if(['pending','running','paused'].includes(t.state))overview.append(node('p','Este trabajo no ha terminado. No hay una entrega para aprobar todavía.'));
}
$('check-executor').addEventListener('click',async()=>{const button=$('check-executor'),out=$('executor-result');button.disabled=true;out.textContent='Comprobando el ejecutor configurado…';try{const result=await api('executor/preflight');const githubAccess=result.ready&&result.backend==='github-actions'?await api('executor/github-access'):null;const name=result.backend==='github-actions'?'GitHub Actions':'Docker local';const d=result.details;const missing=d?Object.entries({TokenGitHub:d.tokenConfigured,MinutosIncluidosConfirmados:d.includedMinutesConfirmed,MinutosMensuales:d.monthlyMinutesValid,SHAWorkflow:d.workflowSHAValid,ReferenciaWorkflow:d.workflowRefConfigured}).filter(([,ok])=>!ok).map(([name])=>name):[];out.textContent=result.ready?`${name} configurado. ${githubAccess?(githubAccess.ready?'GitHub acepta el token para consultar el workflow ('+githubAccess.workflowState+'). El permiso de envío aún requiere prueba real.':'GitHub rechaza la consulta autenticada: '+githubAccess.reason+'.'):'No se ha ejecutado una tarea remota.'}`:`${name} no disponible: ${result.reason||'CONFIGURACION_PENDIENTE'}.${missing.length?' Faltan: '+missing.join(', ')+'.':''}`; }catch(error){out.textContent='No se pudo comprobar el ejecutor: '+error.message;}finally{button.disabled=false;}});
$('check-executor').addEventListener('click',async()=>{const button=$('check-executor'),out=$('executor-result');button.disabled=true;out.textContent='Comprobando el ejecutor configurado…';try{const result=await api('executor/preflight');const name=result.backend==='github-actions'?'GitHub Actions':'Docker local';out.textContent=result.ready?`${name} disponible. Esta comprobación no ejecuta todavía una tarea remota.`:`${name} no disponible: ${result.reason||'CONFIGURACION_PENDIENTE'}.`;}catch(error){out.textContent='No se pudo comprobar el ejecutor: '+error.message;}finally{button.disabled=false;}});
$('toggle-password').addEventListener('click',()=>{const input=$('password');const visible=input.type==='password';input.type=visible?'text':'password';$('toggle-password').textContent=visible?'🙈 Ocultar contraseña':'👁️ Mostrar contraseña';$('toggle-password').setAttribute('aria-label',visible?'Ocultar contraseña':'Mostrar contraseña');$('toggle-password').setAttribute('aria-pressed',String(visible));});
$('check-hash').addEventListener('click',async()=>{
  const field=$('hash-check'),button=$('check-hash'),out=$('hash-result');
  const hash=field.value.trim();field.value='';out.textContent='Comprobando…';button.disabled=true;
  try{const result=await api('auth/hash-check','POST',{hash});out.textContent=result.matches?'COINCIDE: Railway utiliza este código.':'NO COINCIDE: Railway utiliza otro código. No cambies tu contraseña.';}
  catch(err){out.textContent=err.message==='HASH_FORMAT_INVALID'?'Código incompleto o formato incorrecto.':err.message==='CHECK_RATE_LIMIT'?'Demasiadas comprobaciones. Espera 15 minutos.':err.message;}
  finally{button.disabled=false;}
});
$('login-form').addEventListener('submit',async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{const r=await api('login','POST',{email:$('email').value,password:$('password').value});csrf=r.csrf;$('message').textContent='';$('message').hidden=true;try{await refresh();$('password').value='';}catch(err){$('login').hidden=false;$('app').hidden=true;$('logout').hidden=true;showError(new Error('Acceso aceptado, pero no se pudo cargar el panel: '+err.message+'. Recarga la página y vuelve a intentar.'));}}catch(err){showError(err);}finally{button.disabled=false;}});
const limitButton=node('button','Modificar límite global');limitButton.type='button';limitButton.addEventListener('click',async()=>{const raw=prompt('Nuevo límite global USD',String(status.budget.limit/1000000));if(raw===null)return;const usd=Number(raw);if(!Number.isFinite(usd)||usd<0.01||usd>1000)return showError(new Error('Límite inválido'));if(prompt('Escribe AUTORIZO para confirmar el límite global de '+usd+' USD')!=='AUTORIZO')return;try{await api('budget/limit','POST',{usd,confirm:'AUTORIZO'});await refresh();}catch(e){showError(e);}});$('global-budget').after(limitButton);
const resetButton=node('button','Archivar y borrar trabajos antiguos');resetButton.type='button';resetButton.className='secondary';resetButton.addEventListener('click',async()=>{if(prompt('Se archivarán todos los trabajos y reservas anteriores. Escribe BORRAR HISTORIAL ANTIGUO para confirmar.')!=='BORRAR HISTORIAL ANTIGUO')return;resetButton.disabled=true;try{const result=await api('budget/reset-old','POST',{confirm:'BORRAR HISTORIAL ANTIGUO'});selected=null;$('detail').hidden=true;await refresh();$('message').hidden=false;$('message').textContent='Historial archivado: '+result.archivedTasks+' tareas, '+result.archivedReservations+' reservas. Presupuesto disponible según el límite configurado.';}catch(e){showError(e);}finally{resetButton.disabled=false;}});$('project-budget').after(resetButton);
const auditButton=node('button','Auditar reservas del presupuesto');auditButton.type='button';auditButton.className='secondary';const auditResult=node('pre','');auditResult.style.whiteSpace='pre-wrap';auditButton.addEventListener('click',async()=>{auditButton.disabled=true;auditResult.textContent='Consultando reservas…';try{const a=await api('budget/audit');auditResult.textContent='Total contable: '+money(a.budgetTotal)+' · Suma de reservas: '+money(a.reservationTotal)+' · Conciliación: '+(a.consistent?'coincide':'DIFERENCIA')+'\\n'+a.projects.map(p=>p.project+': '+money(p.reserved)).join('\\n')+'\\nReservas registradas: '+a.reservations.length+'\\n'+a.reservations.map(r=>r.project+' · '+r.state+' · '+money(r.amount)+' · '+(r.settlementVerified?'liquidación identificada':'sin liquidación identificable')).join('\\n')+'\\nNo se han liberado reservas automáticamente.';}catch(e){auditResult.textContent=e.message;}finally{auditButton.disabled=false;}});$('project-budget').after(auditButton,auditResult);
$('budget').addEventListener('input',()=>{taskBudgetManual=true;if(status)projectInfo();});
$('task-form').addEventListener('click',e=>{if(e.target.closest('button[type="submit"]')){const msg=$('message');msg.hidden=false;msg.textContent='Botón pulsado. Validando los campos…';}});
$('task-form').addEventListener('invalid',e=>{const msg=$('message');msg.hidden=false;msg.textContent='No se puede iniciar: revisa el campo «'+(e.target.labels?.[0]?.textContent||e.target.id)+'». '+(e.target.validationMessage||'');msg.scrollIntoView({block:'center'});},true);
$('task-form').addEventListener('submit',async e=>{e.preventDefault();
  if(correctionSource&&/Corrige lo siguiente:\\s*$/i.test($('instructions').value)){
    const msg=$('message');msg.hidden=false;
    msg.textContent='Falta indicar el error concreto. Este botón crearía una tarea nueva sin reutilizar los archivos originales. Abre el trabajo anterior para recuperarlo.';
    return;
  }
  const b=e.submitter;b.disabled=true;try{const t=await api('tasks','POST',{project:$('project').value,instructions:$('instructions').value,budget:Math.round(Number($('budget').value)*1000000),...(correctionSource?{previousTaskId:correctionSource}:{})});$('instructions').value='';correctionSource=null;taskBudgetManual=false;selected=t.id;$('message').textContent='';await refresh();}catch(err){showError(err);}finally{b.disabled=false;}});
$('project-form').addEventListener('submit',async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{await api('projects','POST',{id:$('project-id').value,name:$('project-name').value,repository:$('project-repo').value||null,baseBranch:$('project-base').value,mode:$('project-mode').value,authorize:$('project-consent').checked});$('project-form').reset();$('message').textContent='Proyecto autorizado y guardado. Configura su acceso GitHub por separado.';await refresh();}catch(err){showError(err);}finally{b.disabled=false;}});
$('task-filter').addEventListener('change',()=>{showAllTasks=false;refresh().catch(showError);});$('project').addEventListener('change',()=>{correctionSource=null;projectInfo();});$('logout').addEventListener('click',async()=>{try{await api('logout','POST',{});location.reload();}catch(e){showError(e);}});
refresh().catch(e=>{if(e.message!=='AUTHENTICATION_REQUIRED')showError(e);});
setInterval(async()=>{if(document.hidden||busy||$('app').hidden)return;busy=true;try{await refresh();}catch(e){showError(e);}finally{busy=false;}},3000);
