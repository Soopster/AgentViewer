import type { GitCommandRunner, GitDiffSource, GitStatusEntry } from '../../lib/gitProvider'
import { fetchSourceDiff } from '../../lib/gitDiffSources'

/** Fetch the selected comparison once; navigation within it performs no Git I/O. */
export async function fetchGitReviewStream(
  cwd: string,
  runGit: GitCommandRunner,
  source: GitDiffSource,
  entries: GitStatusEntry[],
): Promise<string> {
  const tracked = source.kind === 'working'
    ? await runGit(cwd, ['diff', 'HEAD']) || await runGit(cwd, ['diff', '--cached'])
    : await fetchSourceDiff(cwd, runGit, source)
  // Turn checkpoints already include untracked content. Git's working/branch diffs do not.
  if (source.kind === 'turn') return tracked
  const patches = [tracked]
  const untracked = entries.filter(entry => entry.x === '?' && entry.y === '?')
  // Bound process fan-out for repositories containing many newly generated files.
  for (let index = 0; index < untracked.length; index += 4) {
    patches.push(...await Promise.all(untracked.slice(index, index + 4).map(entry =>
      runGit(cwd, ['diff', '--no-index', '/dev/null', entry.path]))))
  }
  return patches.filter(Boolean).join('\n')
}
