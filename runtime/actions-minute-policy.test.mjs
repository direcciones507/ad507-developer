import test from 'node:test';
import assert from 'node:assert/strict';
import {ActionsChecks} from './actions-checks.mjs';

test('Actions reservations are audit-only and do not impose hidden monthly/project/task limits',()=>{
 const scopes=[];
 const fake={c:{actionsMonthlyMinutes:0,actionsProjectMinutes:0,actionsTaskMinutes:0},s:{db:{prepare(sql){assert.match(sql,/INSERT INTO actions_budget/);return {run(scope,minutes){scopes.push([scope,minutes]);}}}}}};
 ActionsChecks.prototype.reserve.call(fake,{task:'task-1',project:'as-developer',minutes:10});
 assert.equal(scopes.length,3);
 assert.ok(scopes.some(([scope])=>scope==='task:task-1'));
 assert.ok(scopes.some(([scope])=>scope.startsWith('project:as-developer:')));
 assert.ok(scopes.some(([scope])=>scope.startsWith('month:')));
 assert.ok(scopes.every(([,minutes])=>minutes===10));
});
