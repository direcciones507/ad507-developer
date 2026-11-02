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
      CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires INTEGER NOT NULL);`);
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
  globalUsage(){return this.db.prepare('SELECT COALESCE(SUM(reserved),0) AS total FROM budgets').get().total;}
  projectUsage(id){return this.db.prepare('SELECT reserved FROM budgets WHERE project=?').get(id)?.reserved??0;}
  close(){this.db.close();if(this.leader){this.leader.exec('ROLLBACK');this.leader.close();}}
}
