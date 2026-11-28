import type { ActivityInput } from '../../../lib/plugins/activityFeed'
import type { PluginSessionRef } from '../../../lib/plugins/bookmarks'
import type { GitSummary } from '../../../lib/gitProvider'
import { proofFreshness, type ProofSnapshot } from '../../../lib/plugins/proof'

export const REPO_SOURCE = 'repo'

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`
const folder = (cwd: string) => cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || cwd

/**
 * What the working tree and its checks say about the selected conversation's project.
 * A dirty tree is only news while nothing is editing it, so it stays quiet during a turn.
 * Failed or stale checks are reported from the latest finished run only.
 */
export function repoActivities(input: {
  cwd: string
  git: GitSummary | null
  proof: ProofSnapshot | null
  turnRunning: boolean
  target?: PluginSessionRef
  now: number
}): ActivityInput[] {
  const { cwd, git, proof, turnRunning, target, now } = input
  const rows: ActivityInput[] = []
  const name = folder(cwd)
  const run = proof?.runs[0]
  if (proof && run?.finishedAt) {
    const failed = run.results.filter(result => result.status !== 'passed')
    if (failed.length) rows.push({
      id: `checks:${cwd}`, source: REPO_SOURCE, kind: 'checks', status: 'error',
      title: `${plural(failed.length, 'check')} failing in ${name}`,
      detail: failed.map(result => result.check.label).join(', '), target, updatedAt: run.finishedAt,
      context: { checks: { cwd, version: proof.config.version, ids: failed.map(result => result.check.id), failing: failed.map(result => result.check.label) } },
      dismissKey: `${run.id}:${failed.map(result => result.check.id).join(',')}`,
    })
    else if (run.results.some(result => proofFreshness(result, proof) === 'stale')) rows.push({
      id: `checks:${cwd}`, source: REPO_SOURCE, kind: 'checks', status: 'waiting',
      context: { checks: { cwd, version: proof.config.version, ids: run.results.map(result => result.check.id), failing: [] } },
      title: `Checks are stale in ${name}`, detail: 'Files changed since the last passing run — rerun them in Proof', target, updatedAt: run.finishedAt,
      dismissKey: `stale:${run.id}`,
    })
  }
  const changed = git ? git.modified + git.untracked : 0
  if (git && changed > 0 && !turnRunning) rows.push({
    id: `repo:${cwd}`, source: REPO_SOURCE, kind: 'repo', status: 'info',
    title: `${plural(changed, 'uncommitted change')} on ${git.branch || 'detached HEAD'}`,
    detail: [git.modified ? `${git.modified} modified` : '', git.untracked ? `${git.untracked} untracked` : '', git.stashes ? plural(git.stashes, 'stash') : ''].filter(Boolean).join(' · '),
    target, updatedAt: now,
    // Edits change the count constantly; the dismissal is about the dirty tree, not its size.
    dismissKey: `dirty:${git.branch}`,
  })
  return rows
}
