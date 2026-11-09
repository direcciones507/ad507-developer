import test from 'node:test';
import assert from 'node:assert/strict';
import { engineeringInstructions, engineeringStages } from './agents.ts';

test('AS Developer role sequence is stable and bounded', () => {
  assert.deepEqual(engineeringStages.map(stage => stage.id), ['plan', 'explore', 'propose', 'verify', 'review']);
  assert.equal(new Set(engineeringStages.map(stage => stage.id)).size, 5);
});
test('development instructions retain security, cost and approval boundaries', () => {
  const instructions = engineeringInstructions('empleos-pa', 'development');
  for (const required of ['PLAN -> EXPLORE -> PROPOSE -> VERIFY -> OWNER REVIEW',
    'Missing isolated executor', 'Never self-approve', 'Never invoke GitHub Actions',
    'You cannot merge, deploy, access secrets', 'Project: empleos-pa. Mode: development']) {
    assert.ok(instructions.includes(required), required);
  }
});
test('preparation mode cannot turn into code delivery', () => {
  const instructions = engineeringInstructions('junta-comunal-santiago', 'preparation');
  assert.match(instructions, /Only preparation documents under docs\//);
  assert.match(instructions, /Do not build websites/);
});
