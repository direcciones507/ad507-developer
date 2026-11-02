// Commands are owned by the controller/workflow, never supplied by a prompt or payload.
export const checkCommands = Object.freeze({
  'project-syntax': ['node','/opt/ad507-project-check.mjs'],
  'agent-test': ['node', '--test', 'tools/ad507-agent/runtime/*.test.mjs'],
  'agent-typecheck': ['pnpm', '--filter', '@ad507/technology-agent', 'typecheck'],
  'api-typecheck': ['pnpm', '--filter', '@leveia/api', 'typecheck'],
  'api-build': ['pnpm', '--filter', '@leveia/api', 'build'],
});
export function requireCheck(project, name) {
  if (project.mode === 'preparation' || !Object.hasOwn(checkCommands, name)||(project.checks&&!project.checks.includes(name))) throw Error('CHECK_NOT_AUTHORIZED');
  return checkCommands[name];
}
