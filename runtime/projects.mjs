const ID=/^[a-z][a-z0-9-]{1,63}$/;
const REPO=/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
export function normalizeProject(id,input,env={}){
  if(!ID.test(id)||!input||typeof input!=='object'||typeof input.name!=='string'||input.name.length<2||input.name.length>100||/[\x00-\x1f]/.test(input.name))throw Error('INVALID_PROJECT');
  const mode=input.mode||'preparation',repository=input.repository||null,baseBranch=input.baseBranch||'main';
  if(!['preparation','development'].includes(mode)||repository&&!REPO.test(repository)||mode==='development'&&!repository)throw Error('INVALID_PROJECT_REPOSITORY');
  if(!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,100}$/.test(baseBranch)||baseBranch.includes('..')||baseBranch.includes('//')||baseBranch.endsWith('/'))throw Error('INVALID_BASE_BRANCH');
  if(input.productionWrite===true||input.mergeMain===true)throw Error('PROTECTED_OPERATION');
  const key=id.replaceAll('-','_').toUpperCase();
  const projectCap=Number(input.projectCap??env[`AD507_${id==='leveia'?'LEVEIA':id==='junta-comunal-santiago'?'JUNTA':key}_BUDGET_MICROUSD`]??1000000),taskCap=Number(input.taskCap??250000);
  if(!Number.isSafeInteger(projectCap)||projectCap<1||projectCap>10000000||!Number.isSafeInteger(taskCap)||taskCap<1||taskCap>250000||taskCap>projectCap)throw Error('INVALID_PROJECT_BUDGET');
  return {id,name:input.name,enabled:input.enabled!==false,mode,repository,baseBranch,productionWrite:false,mergeMain:false,projectCap,taskCap,
    checks:mode==='preparation'?[]:repository==='direcciones507/leveia'?['agent-test','agent-typecheck','api-typecheck','api-build']:['project-syntax'],
    tokenEnv:id==='leveia'?'AD507_LEVEIA_GITHUB_TOKEN':`AD507_PROJECT_${key}_GITHUB_TOKEN`,source:id==='leveia'?env.AD507_LEVEIA_SOURCE:undefined};
}
export function registeredProject(c,p){const known=c.projects?.[p.id];if(!known?.enabled||known.repository!==p.repository||known.baseBranch!==p.baseBranch)throw Error('PROJECT_NOT_AUTHORIZED');return known;}
export function projectToken(c,project){const p=registeredProject(c,project);return c.env?.[p.tokenEnv]||(p.id==='mi-contacto'?(c.env?.AD507_PROJECT_DIRECCIONES507_GITHUB_TOKEN||c.env?.AD507_GITHUB_TOKEN):undefined)||(p.id==='leveia'?(c.sourceToken||c.env?.AD507_GITHUB_TOKEN):undefined);}
export class ProjectRegistry{
  constructor(c,s){this.c=c;this.s=s;s.db.exec('CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,data TEXT NOT NULL)');
    for(const [id,p] of Object.entries(c.projects))s.db.prepare('INSERT OR IGNORE INTO projects VALUES(?,?)').run(id,JSON.stringify(p));
    // Migrate only the historical Mi Contacto misrouting. Do not overwrite owner changes.
    const mi=s.db.prepare('SELECT data FROM projects WHERE id=?').get('mi-contacto');
    if(mi){
      const previous=JSON.parse(mi.data);
      const configured=c.projects?.['mi-contacto'];
      if(configured?.repository==='direcciones507/mi-contacto' &&
        (previous.repository==='direcciones507/direcciones507' || previous.repository===configured.repository) &&
        previous.baseBranch==='main' && configured.baseBranch==='recovery/mi-contacto-existing-20261101'){
        s.db.prepare('UPDATE projects SET data=? WHERE id=?').run(JSON.stringify({...previous,repository:configured.repository,baseBranch:configured.baseBranch}),'mi-contacto');
      }
    }
    const projects=Object.create(null);for(const row of s.db.prepare('SELECT id,data FROM projects ORDER BY rowid').all())projects[row.id]=normalizeProject(row.id,JSON.parse(row.data),c.env);
    // Owner-controlled review ref for the Junta PR. Keep the repository identity
    // fixed and persist the branch so subsequent jobs use the same snapshot.
    const reviewBranch=c.env?.AD507_JUNTA_REVIEW_BRANCH;
    if(reviewBranch){
      const id='junta-comunal-santiago-web',current=projects[id];
      if(!current||current.repository!=='direcciones507/Junta-Comunal-Santiago')throw Error('JUNTA_REVIEW_PROJECT_MISMATCH');
      const updated=normalizeProject(id,{...current,baseBranch:reviewBranch},c.env);
      s.db.prepare('UPDATE projects SET data=? WHERE id=?').run(JSON.stringify(updated),id);
      projects[id]=updated;
    }
    c.projects=projects;
  }
  register(body){
    if(body?.authorize!==true)throw Error('EXPLICIT_PROJECT_AUTHORIZATION_REQUIRED');
    const keys=['id','name','repository','baseBranch','mode','projectCap','taskCap','authorize'];
    if(Object.keys(body).some(k=>!keys.includes(k)))throw Error('PROJECT_PERMISSION_FIELD_NOT_ALLOWED');
    const p=normalizeProject(body.id,body,this.c.env);
    if(Object.hasOwn(this.c.projects,p.id)||p.repository&&Object.values(this.c.projects).some(x=>x.repository?.toLowerCase()===p.repository.toLowerCase()))throw Error('PROJECT_ALREADY_REGISTERED');
    this.s.tx(()=>{this.s.db.prepare('INSERT INTO projects VALUES(?,?)').run(p.id,JSON.stringify(p));this.s.event(null,'owner_project_authorized',{id:p.id,repository:p.repository,baseBranch:p.baseBranch,mode:p.mode,projectCap:p.projectCap,taskCap:p.taskCap});});
    this.c.projects[p.id]=p;return p;
  }
}
