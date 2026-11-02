import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, access, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { registeredProject,projectToken } from './projects.mjs';
const execute = promisify(execFile);
export class SourceCache {
  constructor(config, run = execute) { this.c = config; this.execute = run; }
  async ensure(project) {
    project=registeredProject(this.c,project);if(!project.repository)throw Error('PROJECT_NOT_AUTHORIZED');
    const token = projectToken(this.c,project);
    if (!token) throw Error('SOURCE_TOKEN_REQUIRED');
    const parent = join(this.c.root, 'sources');
    const target = join(parent, project.id+'.git');
    const branch=project.baseBranch||'main',ref=`refs/heads/${branch}:refs/heads/${branch}`;
    await mkdir(parent, { recursive: true, mode: 0o700 });
    // Authentication exists only in this trusted Git process's environment, never its args/config or task workspace.
    const env = { PATH: process.env.PATH, HOME: '/nonexistent', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0',
      GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from('x-access-token:'+token).toString('base64')}` };
    const run = async (cwd, args) => {
      try { return await this.execute('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, env, timeout: 60000, maxBuffer: 256000 }); }
      catch { throw Error('SOURCE_FETCH_FAILED'); }
    };
    let exists = true;
    try { await access(target); } catch { exists = false; }
    if (!exists) {
      const temp = join(parent, `preparing-${randomUUID()}`);
      await mkdir(temp, { mode: 0o700 });
      try {
        await run(temp, ['init', '--bare']);
        await run(temp, ['remote', 'add', 'origin', `https://github.com/${project.repository}.git`]);
        await run(temp, ['fetch', '--depth=1', 'origin', ref]);
        await run(temp, ['symbolic-ref', 'HEAD', `refs/heads/${branch}`]);
        await rename(temp, target);
      } catch (error) { await rm(temp, { recursive: true, force: true }); throw error; }
    } else {
      const origin = await run(target, ['remote', 'get-url', 'origin']);
      if (origin.stdout.trim() !== `https://github.com/${project.repository}.git`) {
        // A project was historically routed to another repository. Never reuse
        // its cached Git objects; quarantine the old cache and fetch a clean one.
        const stale = join(parent, `stale-${project.id}-${randomUUID()}.git`);
        await rename(target, stale);
        const temp = join(parent, `preparing-${randomUUID()}`);
        await mkdir(temp, { mode: 0o700 });
        try {
          await run(temp, ['init', '--bare']);
          await run(temp, ['remote', 'add', 'origin', `https://github.com/${project.repository}.git`]);
          await run(temp, ['fetch', '--depth=1', 'origin', ref]);
          await run(temp, ['symbolic-ref', 'HEAD', `refs/heads/${branch}`]);
          await rename(temp, target);
        } catch (error) { await rm(temp, { recursive: true, force: true }); throw error; }
      } else {
        await run(target, ['fetch', '--depth=1', 'origin', '+'+ref]);
      }
    }
    return target;
  }
}
