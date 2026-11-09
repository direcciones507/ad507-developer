import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
export const states = ['pending','running','paused','awaiting_approval','completed','failed','cancelled'];
export class Store {
  constructor(root, { lock = true } = {}) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    if (lock) {
      // A dedicated SQLite transaction supplies an OS-backed, crash-released leader lock.
      // No PID files: container PID reuse must not prevent recovery after restart.
      this.leader = new DatabaseSync(join(root, 'runtime-leader.sqlite'));
      try { this.leader.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE; CREATE TABLE IF NOT EXISTS owner(id INTEGER)'); }
      catch(e) { this.leader.close(); throw Error(e.errcode === 5 || /locked/.test(e.message) ? 'SINGLE_INSTANCE_REQUIRED' : 'LEADER_LOCK_FAILED'); }
    }
    this.db = new DatabaseSync(join(root, 'developer.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, project TEXT NOT NULL, state TEXT NOT NULL,
        data TEXT NOT NULL, updated TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT, task TEXT,
        kind TEXT NOT NULL, detail TEXT NOT NULL, created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS budgets(project TEXT PRIMARY KEY, reserved INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS reservations(id TEXT PRIMARY KEY, task TEXT NOT NULL, amount INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    this.recover();
  }
  tx(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const r = fn(); this.db.exec('COMMIT'); return r; } catch(e) { this.db.exec('ROLLBACK'); throw e; } }
  event(id, kind, detail = {}) { this.db.prepare('INSERT INTO events(task,kind,detail,created) VALUES(?,?,?,?)').run(id,kind,JSON.stringify(detail),new Date().toISOString()); }
  save(t) { t.updated = new Date().toISOString(); this.db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,data=excluded.data,updated=excluded.updated').run(t.id,t.project,t.state,JSON.stringify(t),t.updated); return t; }
  get(id) { const r = this.db.prepare('SELECT data FROM tasks WHERE id=?').get(id); if (!r) throw Error('TASK_NOT_FOUND'); return JSON.parse(r.data); }
  list() { return this.db.prepare('SELECT data FROM tasks ORDER BY updated DESC LIMIT 200').all().map(r=>JSON.parse(r.data)); }
  events(id) { return this.db.prepare('SELECT seq,kind,detail,created FROM events WHERE task=? ORDER BY seq DESC LIMIT 200').all(id).reverse().map(r=>({...r,detail:JSON.parse(r.detail)})); }
  create(project,instructions,budget,provider) {
    return this.tx(()=>{const t={id:randomUUID(),project,instructions,budget,provider,state:'pending',phase:'workspace',branch:null,
      messages:[],steps:0,checks:[],files:[],reserved:0,usage:{input:0,output:0},created:Date.now(),reason:null};
      this.save(t); this.event(t.id,'task_created',{project,provider,budget}); return t;});
  }
  recover() { this.tx(()=>{ for(const {data} of this.db.prepare("SELECT data FROM tasks WHERE state='running'").all()) { const t=JSON.parse(data); if(t.state==='running') {
    t.state='awaiting_approval'; t.gate='recovery'; t.reason='Proceso interrumpido. Revisar el último paso antes de continuar; no se repite una acción incierta.';
    this.save(t); this.event(t.id,'recovery_required',{phase:t.phase,inflight:t.inflight??null});
  }}}); }
  reserve(t, amount, projectCap, globalCap=Number.MAX_SAFE_INTEGER) {
    if(!Number.isSafeInteger(amount)||amount<=0)throw Error('INVALID_RESERVATION');
    return this.tx(()=>{const fresh=this.get(t.id);const used=this.projectUsage(t.project);
      if(fresh.reserved+amount>fresh.budget||used+amount>projectCap||this.globalUsage()+amount>globalCap)throw Error('BUDGET_EXHAUSTED');
      const id=randomUUID(); this.db.prepare('INSERT INTO reservations VALUES(?,?,?)').run(id,t.id,amount);
      this.db.prepare('INSERT INTO budgets VALUES(?,?) ON CONFLICT(project) DO UPDATE SET reserved=reserved+excluded.reserved').run(t.project,amount);
      t.reserved=fresh.reserved+amount; this.save(t);this.event(t.id,'budget_reserved',{id,amount});return id;});
  }
  settle(t, reservationId, actual) {
    if(!Number.isSafeInteger(actual)||actual<0)throw Error('INVALID_SETTLEMENT');
    return this.tx(()=>{
      const row=this.db.prepare('SELECT amount FROM reservations WHERE id=? AND task=?').get(reservationId,t.id);
      if(!row)throw Error('RESERVATION_NOT_FOUND');
      if(actual>row.amount)throw Error('ACTUAL_COST_EXCEEDS_RESERVATION');
      const released=row.amount-actual;
      this.db.prepare('UPDATE reservations SET amount=? WHERE id=?').run(actual,reservationId);
      this.db.prepare('UPDATE budgets SET reserved=reserved-? WHERE project=?').run(released,t.project);
      const fresh=this.get(t.id);t.reserved=fresh.reserved-released;
      this.save(t);this.event(t.id,'budget_settled',{id:reservationId,reserved:row.amount,actual,released});
      return released;
    });
  }
  releaseUnsentReservation(taskId,reservationId,reason){
    // Only a positively verified non-dispatch may be released; never infer it from a failed task.
    if(reason!=='provider_not_dispatched')throw Error('RELEASE_EVIDENCE_REQUIRED');
    return this.tx(()=>{
      const row=this.db.prepare('SELECT amount FROM reservations WHERE id=? AND task=?').get(reservationId,taskId);
      if(!row)throw Error('RESERVATION_NOT_FOUND');
      const t=this.get(taskId);
      this.db.prepare('DELETE FROM reservations WHERE id=?').run(reservationId);
      this.db.prepare('UPDATE budgets SET reserved=reserved-? WHERE project=?').run(row.amount,t.project);
      t.reserved-=row.amount;this.save(t);
      this.event(taskId,'budget_released_unsent',{id:reservationId,amount:row.amount,reason});
      return row.amount;
    });
  }
  globalBudgetLimit(fallback){const row=this.db.prepare("SELECT value FROM settings WHERE key='global_budget_micro_usd'").get();const value=row?Number(row.value):fallback;if(!Number.isSafeInteger(value)||value<1)throw Error('INVALID_GLOBAL_BUDGET');return value;}
  setGlobalBudgetLimit(amount,baseline){
    if(!Number.isSafeInteger(amount)||amount<1||amount>1000000000)throw Error('INVALID_GLOBAL_BUDGET');
    return this.tx(()=>{const previous=this.globalBudgetLimit(baseline);if(amount<this.globalUsage())throw Error('BUDGET_BELOW_COMMITTED_USAGE');this.db.prepare("INSERT INTO settings(key,value) VALUES('global_budget_micro_usd',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(amount));this.event(null,'global_budget_limit_changed',{previous,amount});return {previous,amount};});
  }
  budgetAudit(){
    const projects=this.db.prepare('SELECT project,reserved FROM budgets ORDER BY project').all();
    const rows=this.db.prepare("SELECT r.id,r.task,r.amount,t.project,t.state,t.data FROM reservations r LEFT JOIN tasks t ON t.id=r.task ORDER BY t.updated DESC").all();
    const reservations=rows.map(r=>{
      const t=r.data?JSON.parse(r.data):null;
      const events=this.db.prepare("SELECT kind,detail FROM events WHERE task=? AND kind IN ('budget_reserved','budget_settled') ORDER BY seq").all(r.task);
      const settled=events.some(e=>{if(e.kind!=='budget_settled')return false;try{return JSON.parse(e.detail).id===r.id;}catch{return false;}});
      return {id:r.id,task:r.task,project:r.project||null,state:r.state||'missing',amount:r.amount,settlementVerified: settled,settlementStatus:settled?'verified':'historical_unattributed',uncertain:!settled,taskReserved:t?.reserved??null};
    });
    const reservationTotal=reservations.reduce((n,r)=>n+r.amount,0);
    const budgetTotal=projects.reduce((n,p)=>n+p.reserved,0);
    return {budgetTotal,reservationTotal,consistent:budgetTotal===reservationTotal,projects,reservations,notice:'Read-only accounting. Historical settlements lack reservation IDs and may have occurred. A failed task is not evidence of zero provider cost; no automatic refund is authorized.'};
  }
  globalUsage(){return this.db.prepare('SELECT COALESCE(SUM(reserved),0) AS total FROM budgets').get().total;}
  projectUsage(id){return this.db.prepare('SELECT reserved FROM budgets WHERE project=?').get(id)?.reserved??0;}
  close(){this.db.close();if(this.leader){this.leader.exec('ROLLBACK');this.leader.close();}}
}
