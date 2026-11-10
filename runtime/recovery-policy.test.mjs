import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverTimedOutTask} from './recovery-policy.mjs';

const base=()=>({id:'original',state:'failed',reason:'TASK_TIMEOUT',phase:'model',branch:'ad507/task-original',
 budget:1000000,reserved:21345,steps:29,files:['docs/autonomous-agent-validation.md'],
 messages:[{role:'user',content:'Original task'}],pendingCalls:[],
 inflight:null});
test('continues original workspace with same budget and work, no new task',()=>{
 const original=base(), {task}=recoverTimedOutTask(original,['docs/autonomous-agent-validation.md']);
 assert.equal(task,original);assert.equal(task.state,'pending');assert.equal(task.budget,1000000);
 assert.equal(task.reserved,21345);assert.equal(task.steps,29);assert.equal(task.messages.length,1);
 assert.deepEqual(task.files,['docs/autonomous-agent-validation.md']);
});
test('preserves exactly the durable remote check pending call',()=>{
 const original=base();
 original.pendingCalls=[{id:'abc',function:{name:'run_safe_check'}}];
 original.inflight={kind:'tool',id:'abc',name:'run_safe_check'};
 const result=recoverTimedOutTask(original,['docs/a.md']);
 assert.equal(result.continuingRemoteCheck,true);
 assert.equal(original.pendingCalls[0].id,'abc');
 assert.equal(original.inflight,null);
});
test('rejects missing workspace changes and uncertain write calls',()=>{
 assert.throws(()=>recoverTimedOutTask(base(),[]),/NO_RECOVERABLE_CHANGES/);
 const t=base();t.inflight={kind:'tool',id:'w',name:'write_repository_file'};
 assert.throws(()=>recoverTimedOutTask(t,['docs/a.md']),/UNCERTAIN_TOOL_REQUIRES_REVIEW/);
 assert.equal(t.state,'failed');
});
test('never resumes an unauthorized terminal task',()=>{
 const t=base();t.reason='BUDGET_EXHAUSTED';
 assert.throws(()=>recoverTimedOutTask(t,['docs/a.md']),/RECOVERY_NOT_ELIGIBLE/);
});
