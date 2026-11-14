import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'"
/** Preserve Git's hook dispatch while preventing pre-commit hooks from silently
 * changing the index that the user reviewed. The guard runs in Node or Bun. */
export async function createCommitHookGuards(directory: string, originalHooks: string, expectedIndex: string): Promise<void> {
  await mkdir(directory, { mode: 0o700 })
  const guard = join(directory, 'guard.cjs')
  await writeFile(guard, `const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const name = process.argv[2];
const result = spawnSync('git', ['-c', ${JSON.stringify('core.hooksPath=' + originalHooks)}, 'hook', 'run', '--ignore-missing', name, '--', ...process.argv.slice(3)], { stdio: 'inherit', env: process.env });
if (result.error) { console.error(result.error.message); process.exit(1); }
if (result.status !== 0) process.exit(result.status || 1);
if (['pre-commit', 'prepare-commit-msg', 'commit-msg'].includes(name)) {
  const index = spawnSync('git', ['ls-files', '--stage', '-z'], { env: process.env });
  if (index.status !== 0 || createHash('sha256').update(index.stdout).digest('hex') !== ${JSON.stringify(expectedIndex)}) {
    console.error('A commit hook changed the staged content. Commit stopped; review and stage the hook changes before trying again.');
    process.exit(1);
  }
}
`, { mode: 0o600 })
  for (const hook of ['pre-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit', 'post-rewrite']) {
    await writeFile(join(directory, hook), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(guard)} ${quote(hook)} "$@"\n`, { mode: 0o700 })
  }
}
