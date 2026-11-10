import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { requireCheck } from './checks-policy.mjs';
import { sanitizeOutput } from './workspace.mjs';
import { readLimited } from './provider.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const repo = 'direcciones507/ad507-developer';
const finished = new Set(['completed', 'cancelled', 'failed', 'expired']);
export class ActionsChecks {
  constructor(config, store, workspace, { fetchImpl = fetch, pollMs = 1000 } = {}) {
    this.c = config; this.s = store; this.w = workspace; this.fetch = fetchImpl; this.pollMs = pollMs;
    const keyPath = join(config.root, 'runner.key');
    try { this.key = readFileSync(keyPath); }
    catch (error) { if (error.code !== 'ENOENT') throw error; this.key = randomBytes(32); writeFileSync(keyPath, this.key, { flag: 'wx', mode: 0o600 }); }
    if (this.key.length !== 32) throw Error('RUNNER_KEY_INVALID');
    store.db.exec(`CREATE TABLE IF NOT EXISTS remote_checks(id TEXT PRIMARY KEY, task TEXT NOT NULL, project TEXT NOT NULL,
      fingerprint TEXT UNIQUE NOT NULL, state TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS actions_budget(scope TEXT PRIMARY KEY, reserved INTEGER NOT NULL);`);
    this.recoverRejectedReservations();
  }
  get(id) { const row = this.s.db.prepare('SELECT data FROM remote_checks WHERE id=?').get(id); if (!row) throw Error('REMOTE_JOB_NOT_FOUND'); return JSON.parse(row.data); }
  // Keep SQL arity explicit; only this helper writes the durable check record.
  put(job) { this.s.db.prepare('INSERT INTO remote_checks(id,task,project,fingerprint,state,data) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,data=excluded.data')
    .run(job.id, job.task, job.project, job.fingerprint, job.state, JSON.stringify(job)); return job; }
  taskJobs(id) { return this.s.db.prepare('SELECT data FROM remote_checks WHERE task=? ORDER BY rowid').all(id).map(r => {
    const j = JSON.parse(r.data); return { id: j.id, check: j.check, state: j.state, runUrl: j.runUrl, minutesReserved: j.minutes, created: j.created, revision: j.revision };
  }); }
  ticket(job) { return createHmac('sha256', this.key).update(job.id + ':' + job.fingerprint).digest('hex'); }
  authenticate(id, ticket) {
    const job = this.get(id);
    if (typeof ticket !== 'string' || !/^[a-f0-9]{64}$/.test(ticket) || !timingSafeEqual(Buffer.from(ticket, 'hex'), Buffer.from(this.ticket(job), 'hex'))) throw Error('RUNNER_UNAUTHORIZED');
    if(this.s.get(job.task).state==='cancelled'){job.state='cancelled';job.cancelPending=true;this.put(job);throw Error('RUNNER_TICKET_REVOKED');}
    if (job.state === 'cancelled' || job.state === 'expired' || Date.now() > job.expires) throw Error('RUNNER_TICKET_REVOKED');
    return job;
  }
  ready() { return Boolean(this.c.actionsToken && this.c.actionsIncludedOnly && Number.isSafeInteger(this.c.actionsMonthlyMinutes) && this.c.actionsMonthlyMinutes >= 10 && /^[a-f0-9]{40}$/.test(this.c.actionsSHA || '') && this.c.actionsRef); }
  usage() { const month = new Date().toISOString().slice(0,7); return this.s.db.prepare('SELECT reserved FROM actions_budget WHERE scope=?').get('month:' + month)?.reserved || 0; }
  reserve(job) {
    // GitHub owns Actions quota enforcement. These rows are audit accounting,
    // not additional user-configured spending limits for the coding agent.
    // Keep conservative reservations for uncertain dispatches and reconciliation.
    const month = new Date().toISOString().slice(0,7);
    for (const scope of [`month:${month}`,`project:${job.project}:${month}`,`task:${job.task}`])
      this.s.db.prepare('INSERT INTO actions_budget VALUES(?,?) ON CONFLICT(scope) DO UPDATE SET reserved=reserved+excluded.reserved').run(scope, job.minutes);
  }
  releaseRejected(job, code) {
    // Only definitive HTTP rejection is refundable. Never release an uncertain
    // transport failure, which may already have started a remote workflow.
    if (!/^ACTIONS_HTTP_(?:400|401|403|404|409|422)$/.test(code)) return false;
    return this.s.tx(() => {
      const fresh=this.get(job.id);
      if (fresh.minutesReleased || fresh.runId || !['unknown','dispatching','rejected'].includes(fresh.state)) return false;
      const month=new Date(fresh.created).toISOString().slice(0,7);
      for(const scope of [`month:${month}`,`project:${fresh.project}:${month}`,`task:${fresh.task}`])
        this.s.db.prepare('UPDATE actions_budget SET reserved=MAX(0,reserved-?) WHERE scope=?').run(fresh.minutes,scope);
      fresh.minutesReleased=true;fresh.state='rejected';fresh.dispatchFailureCode=code;this.put(fresh);
      this.s.event(fresh.task,'remote_check_reservation_released',{id:fresh.id,minutes:fresh.minutes,code});
      return true;
    });
  }
  recoverRejectedReservations() {
    // One-time/idempotent reconciliation of legacy definitive HTTP 403 failures.
    for(const row of this.s.db.prepare("SELECT data FROM remote_checks WHERE state='unknown'").all()){
      const job=JSON.parse(row.data);
      const events=this.s.db.prepare("SELECT detail FROM events WHERE task=? AND kind='remote_dispatch_diagnostic'").all(job.task);
      const rejected=events.some(e=>{try{const d=JSON.parse(e.detail);return d.job===job.id&&/^ACTIONS_HTTP_(?:400|401|403|404|409|422)$/.test(d.code)}catch{return false}});
      if(rejected)this.releaseRejected(job,'ACTIONS_HTTP_403');
    }
  }
  async reconcileUnclaimedDispatches() {
    // Historical uncertain dispatches can be reconciled only after expiry and
    // after a complete GitHub workflow run listing proves no matching run exists.
    const candidates=this.s.db.prepare("SELECT data FROM remote_checks WHERE state='unknown'").all()
      .map(row=>JSON.parse(row.data)).filter(j=>!j.runId&&!j.minutesReleased&&Date.now()>j.expires+60000);
    if(!candidates.length)return;
    let runs;
    try{
      const result=await this.api('actions/workflows/remote-check.yml/runs?event=workflow_dispatch&per_page=100');
      if(result.total_count>100||!Array.isArray(result.workflow_runs))return;
      runs=result.workflow_runs;
    }catch{return;}
    for(const job of candidates){
      // A listing covering the candidate's creation time is necessary.
      if(runs.length&&Date.parse(runs[runs.length-1].created_at)>job.created)continue;
      const found=runs.some(run=>run.display_title===`AD507 check ${job.id}`);
      if(found)continue;
      this.s.tx(()=>{
        const fresh=this.get(job.id);
        if(fresh.minutesReleased||fresh.runId||fresh.state!=='unknown')return;
        const month=new Date(fresh.created).toISOString().slice(0,7);
        for(const scope of [`month:${month}`,`project:${fresh.project}:${month}`,`task:${fresh.task}`])
          this.s.db.prepare('UPDATE actions_budget SET reserved=MAX(0,reserved-?) WHERE scope=?').run(fresh.minutes,scope);
        fresh.minutesReleased=true;fresh.state='rejected';fresh.dispatchFailureCode='NO_GITHUB_RUN_AFTER_EXPIRY';this.put(fresh);
        this.s.event(fresh.task,'remote_check_reservation_released',{id:fresh.id,minutes:fresh.minutes,code:'NO_GITHUB_RUN_AFTER_EXPIRY'});
      });
    }
  }
  async reconcileFinishedRuns() {
    // Reservations are upper bounds, not actual GitHub runner minutes.
    // Only settle runs whose GitHub API status is definitively completed.
    const rows=this.s.db.prepare("SELECT data FROM remote_checks WHERE state IN ('claimed','queued','completed','failed','expired')").all();
    for(const row of rows){
      const job=JSON.parse(row.data);
      if(!job.runId||job.minutesReleased||job.minutesSettled)continue;
      let run,jobs;
      try{
        run=await this.api('actions/runs/'+job.runId);
        if(run.status!=='completed')continue;
        jobs=await this.api('actions/runs/'+job.runId+'/jobs?per_page=100');
      }catch{continue;}
      if(!Array.isArray(jobs.jobs)||jobs.total_count>100)continue;
      const billed=jobs.jobs.reduce((sum,item)=>{
        if(!item.started_at||!item.completed_at)return sum;
        const seconds=Math.max(0,(Date.parse(item.completed_at)-Date.parse(item.started_at))/1000);
        return sum+Math.max(1,Math.ceil(seconds/60));
      },0);
      const actual=Math.min(job.minutes,Math.max(1,billed));
      this.s.tx(()=>{
        const fresh=this.get(job.id);
        if(fresh.minutesSettled||fresh.minutesReleased)return;
        const refund=fresh.minutes-actual;
        const month=new Date(fresh.created).toISOString().slice(0,7);
        for(const scope of [`month:${month}`,`project:${fresh.project}:${month}`,`task:${fresh.task}`])
          this.s.db.prepare('UPDATE actions_budget SET reserved=MAX(0,reserved-?) WHERE scope=?').run(refund,scope);
        fresh.minutesSettled=actual;this.put(fresh);
        this.s.event(fresh.task,'remote_check_minutes_settled',{id:fresh.id,reserved:fresh.minutes,actual,refunded:refund,conclusion:run.conclusion});
      });
    }
  }
  async api(path, method = 'GET', body) {
    if (!this.c.actionsToken) throw Error('ACTIONS_TOKEN_REQUIRED');
    const response = await this.fetch(`https://api.github.com/repos/${repo}/${path}`, { method, redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${this.c.actionsToken}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' }, body: body ? JSON.stringify(body) : undefined });
    if (!response.ok) throw Error(`ACTIONS_HTTP_${response.status}`);
    if (response.status === 204) return null;
    return JSON.parse(await readLimited(response, 512000));
  }
  async manifest(t, name) {
    const dir = await this.w.snapshot(t); const files = [];
    try {
      async function walk(folder, prefix = '') { for (const entry of (await readdir(folder, { withFileTypes: true })).sort((a,b)=>a.name.localeCompare(b.name))) {
        const path = prefix + entry.name;
        if (entry.isDirectory()) await walk(join(folder, entry.name), path + '/');
        else files.push({ path, content: (await readFile(join(folder, entry.name))).toString('base64') });
      }}
      await walk(dir);
      return { version: 1, task: t.id, project: t.project, check: name, revision: t.revision || 0, base: t.base, files };
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
  async run(t, project, name, signal) {
    requireCheck(project, name); signal.throwIfAborted();
    await this.reconcileFinishedRuns();
    await this.reconcileUnclaimedDispatches();
    // Fail closed: this runner is authenticated against LEVEIA only. Never bill
    // LEVEIA Actions minutes for checks requested by another project.
    if (project.mode !== 'development' || !project.repository || t.project !== project.id) throw Error('PROJECT_ACTIONS_RUNNER_NOT_CONFIGURED');
    if (!this.ready()) throw Error('ACTIONS_NOT_CONFIGURED_OR_BUDGET_UNCONFIRMED');
    const manifest = await this.manifest(t, name);
    const snapshotHash = hash(JSON.stringify(manifest));
    const fingerprint = hash(t.id + ':' + snapshotHash + ':' + this.c.actionsSHA);
    const existing = this.s.db.prepare('SELECT data FROM remote_checks WHERE fingerprint=?').get(fingerprint);
    let job;
    if (existing) job = JSON.parse(existing.data);
    else {
      const id = randomUUID();
      job = { id, task: t.id, project: t.project, check: name, revision: t.revision || 0, fingerprint, snapshotHash, state: 'prepared',
        expectedSHA: this.c.actionsSHA, ref: this.c.actionsRef, minutes: 10, created: Date.now(), expires: Date.now() + 30 * 60 * 1000, runId: null };
      const payload = gzipSync(Buffer.from(JSON.stringify({ ...manifest, job: id, snapshotHash, expectedSHA: job.expectedSHA })));
      if (payload.length > 16000000) throw Error('SNAPSHOT_TOO_LARGE');
      const directory = join(this.c.root, 'checks'); await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(join(directory, id + '.json.gz'), payload, { mode: 0o600 });
      signal.throwIfAborted();
      this.s.tx(() => { this.reserve(job); this.put(job); this.s.event(t.id, 'remote_check_reserved', { id, check: name, minutes: job.minutes }); });
      job.state = 'dispatching'; this.put(job); // Persist BEFORE the external dispatch; never retry an uncertain request automatically.
      try {
        const result = await this.api(`actions/workflows/remote-check.yml/dispatches`, 'POST', { ref: job.ref, inputs: { remote_job: id, remote_ticket: this.ticket(job) } });
        job = this.get(id);
        if (result?.workflow_run_id && !/^[0-9]+$/.test(String(result.workflow_run_id)))throw Error('RUNNER_IDENTITY_REJECTED');
        if (result?.workflow_run_id) { job.runId = String(result.workflow_run_id); job.runUrl = `https://github.com/${repo}/actions/runs/${job.runId}`; }
        if (job.state === 'dispatching') job.state = 'queued';
        this.put(job);
      } catch (error) {
        if(signal.aborted&&this.s.get(t.id).state==='cancelled')await this.cancelTask(t.id);
        job = this.get(id); if (job.state === 'dispatching') { job.state = 'unknown'; this.put(job); }
        // Preserve uncertainty, but record only a safe, bounded diagnostic code.
        const dispatchCode=/^ACTIONS_HTTP_(?:400|401|403|404|409|422|429|500|502|503)$/.test(error.message)?error.message:'ACTIONS_DISPATCH_TRANSPORT_ERROR';
        this.s.event(t.id,'remote_dispatch_diagnostic',{job:id,code:dispatchCode,workflow:'remote-check.yml',ref:job.ref});
        if(this.releaseRejected(job,dispatchCode))throw Error(dispatchCode);
        throw Error('REMOTE_DISPATCH_UNCERTAIN');
      }
    }
    try {
      for (;;) {
        signal.throwIfAborted(); job = this.get(job.id);
        if (job.state === 'completed') return { ...job.result, remoteJob: job.id, runUrl: job.runUrl };
        if (finished.has(job.state)) throw Error('REMOTE_CHECK_' + job.state.toUpperCase());
        if (job.state === 'unknown' || job.state === 'prepared' || job.state === 'dispatching') throw Error('REMOTE_DISPATCH_UNCERTAIN');
        if (Date.now() > job.expires) { job.state = 'expired'; job.cancelPending = true; this.put(job); await this.cancelRun(job); throw Error('REMOTE_CHECK_EXPIRED'); }
        await new Promise((resolve, reject) => { const done = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); resolve(); };
          const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(Error('REMOTE_WAIT_ABORTED')); };
          const timer = setTimeout(done, this.pollMs); signal.addEventListener('abort', abort, { once: true }); });
      }
    } catch (error) {
      // Pause/restart detaches the waiter but permits this immutable check to finish. Resume reuses its receipt.
      if (signal.aborted && this.s.get(t.id).state === 'cancelled') await this.cancelTask(t.id);
      throw error;
    }
  }
  async verifyRun(job, identity) {
    if (!identity || !/^[0-9]+$/.test(String(identity.runId)) || identity.attempt !== 1 || identity.sha !== job.expectedSHA) throw Error('RUNNER_IDENTITY_REJECTED');
    if (job.runId && job.runId !== String(identity.runId)) throw Error('RUNNER_IDENTITY_REJECTED');
    const run = await this.api(`actions/runs/${identity.runId}`);
    if (run.head_sha !== job.expectedSHA || run.head_branch !== job.ref || run.event !== 'workflow_dispatch' || !['AS Developer Remote Check',`AD507 check ${job.id}`].includes(run.name) || run.path?.split('@')[0] !== '.github/workflows/remote-check.yml' || run.display_title !== `AD507 check ${job.id}` || run.repository?.full_name !== repo) throw Error('RUNNER_IDENTITY_REJECTED');
  }
  async claim(id, ticket, identity) {
    let job = this.authenticate(id, ticket); if (finished.has(job.state)) throw Error('REMOTE_JOB_FINISHED');
    await this.verifyRun(job, identity); job = this.authenticate(id, ticket);
    if (job.claim && (job.claim.runId !== String(identity.runId) || job.claim.attempt !== identity.attempt)) throw Error('RUNNER_ALREADY_CLAIMED');
    job.claim = { runId: String(identity.runId), attempt: identity.attempt }; job.runId = String(identity.runId);
    job.runUrl = `https://github.com/${repo}/actions/runs/${job.runId}`; job.state = 'claimed'; this.put(job);
    this.s.event(job.task, 'remote_check_claimed', { id, runId: job.runId });
    return { id, snapshotHash: job.snapshotHash, expectedSHA: job.expectedSHA, check: job.check };
  }
  async payload(id, ticket, runId) {
    const job = this.authenticate(id, ticket);
    if (job.state !== 'claimed' || job.claim?.runId !== String(runId)) throw Error('RUNNER_NOT_CLAIMED');
    return readFile(join(this.c.root, 'checks', id + '.json.gz'));
  }
  complete(id, ticket, identity, result) {
    const job = this.authenticate(id, ticket);
    if (!job.claim || job.claim.runId !== String(identity.runId) || job.claim.attempt !== identity.attempt || identity.sha !== job.expectedSHA) throw Error('RUNNER_IDENTITY_REJECTED');
    if (!result || result.check !== job.check || result.snapshotHash !== job.snapshotHash || typeof result.passed !== 'boolean' || typeof result.output !== 'string' || result.output.length > 20000) throw Error('RUNNER_RESULT_REJECTED');
    const normalized = { check: job.check, passed: result.passed, output: sanitizeOutput(result.output, this.c) };
    if (job.state === 'completed') { if (JSON.stringify(job.result) !== JSON.stringify(normalized)) throw Error('RUNNER_RESULT_CONFLICT'); return { accepted: true, duplicate: true }; }
    if (job.state !== 'claimed') throw Error('RUNNER_NOT_CLAIMED');
    job.result = normalized; job.state = 'completed'; job.finished = Date.now(); this.put(job);
    this.s.event(job.task, 'remote_check_completed', { id, check: job.check, passed: normalized.passed, runId: job.runId });
    return { accepted: true };
  }
  async cancelRun(job) {
    if (!job.runId) { job.cancelPending = true; this.put(job); return; }
    try { await this.api(`actions/runs/${job.runId}/cancel`, 'POST'); job = this.get(job.id); job.cancelPending = false; this.put(job); }
    catch(error) { job = this.get(job.id); job.cancelPending = error.message!=='ACTIONS_HTTP_409'; this.put(job); }
  }
  async cancelTask(task) {
    for (const row of this.s.db.prepare('SELECT data FROM remote_checks WHERE task=?').all(task)) {
      const job = JSON.parse(row.data); if (finished.has(job.state)) continue;
      job.state = 'cancelled'; job.cancelPending = true; this.put(job); this.s.event(task, 'remote_check_cancelled', { id: job.id }); await this.cancelRun(job);
    }
  }
  async reconcile() {
    for (const row of this.s.db.prepare("SELECT data FROM remote_checks WHERE state NOT IN ('completed','failed')").all()) {
      let job = JSON.parse(row.data);
      if (Date.now() > job.expires && !finished.has(job.state)) { job.state = 'expired'; job.cancelPending = true; this.put(job); }
      if (job.cancelPending && job.runId) await this.cancelRun(job);
    }
  }
}
