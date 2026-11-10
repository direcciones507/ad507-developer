// Resume only an existing timed-out task with its isolated workspace intact.
// Do not create another task, refill budget, or replay uncertain mutations.
export function recoverTimedOutTask(task, changedFiles) {
  if (task.state !== 'failed' || task.reason !== 'TASK_TIMEOUT' || task.phase !== 'model' || !task.branch)
    throw Error('RECOVERY_NOT_ELIGIBLE');
  if (!Array.isArray(changedFiles) || changedFiles.length === 0)
    throw Error('NO_RECOVERABLE_CHANGES');
  const pending = Array.isArray(task.pendingCalls) ? task.pendingCalls[0] : null;
  const inflight = task.inflight;
  const safeRemote = inflight?.kind === 'tool' &&
    inflight.name === 'run_safe_check' && pending?.id === inflight.id &&
    pending?.function?.name === 'run_safe_check';
  // A tool that can modify files must never be automatically replayed.
  if (inflight?.kind === 'tool' && !safeRemote)
    throw Error('UNCERTAIN_TOOL_REQUIRES_REVIEW');
  if (inflight?.kind === 'workspace')
    throw Error('UNCERTAIN_WORKSPACE_REQUIRES_REVIEW');
  // An interrupted model call may have been billed; do not change accounting.
  task.inflight = null;
  task.files = [...changedFiles];
  task.state = 'pending';
  task.gate = null;
  task.reason = 'Continuando la tarea original con archivos y presupuesto conservados.';
  task.summary = '';
  return { task, continuingRemoteCheck: safeRemote };
}
