// One pass over the watched pull requests, run from the schedules engine's tick —
// so only the process holding its lease wakes anyone, and a daemon beside a TUI
// cannot wake a session twice.
import { buildPrWatchPrompt, diffPrWatch, onlyFeedback, snapshotPr, WATCH_INTERVAL_MS, WATCH_MAX_COMMENT_WAKES, WATCH_MAX_FAILED_READS } from './watch'
import { githubRepoArgument } from './links'
import { readPrWatches, updatePrWatches, type PrWatch } from './watchStore'
import type { GithubPrDetail } from './types'

export type PrWatchDeps = {
  read: (cwd: string, number: number, repo: string) => Promise<GithubPrDetail>
  viewer: (cwd: string, prUrl: string) => Promise<string | null>
  busy: (watch: PrWatch) => Promise<boolean>
  settled: (watch: PrWatch) => Promise<boolean>
  /** Starts the turn; resolves when it has ended. */
  wake: (watch: PrWatch, prompt: string) => Promise<void>
  notify: (watch: PrWatch, title: string, detail: string) => Promise<void>
}

const defaultDeps: PrWatchDeps = {
  read: async (cwd, number, repo) => (await import('./prs')).fetchGithubPr(cwd, number, repo),
  viewer: async (cwd, prUrl) => (await import('./repo')).fetchGithubViewer(cwd, prUrl),
  busy: async watch => (await import('../sessionActivity')).listViewRunningSessions().some(running => running.sessionId === watch.sessionId),
  settled: async watch => !!(await (await import('../sessionInbox')).readSessionInboxState(watch.provider, watch.sessionId, watch.providerInstanceId))?.settledAt,
  wake: async (watch, prompt) => {
    const { promptSessionUnattended } = await import('../schedules/engine')
    const result = await promptSessionUnattended(watch.provider, watch.sessionId, { message: prompt })
    if (result.outcome === 'failed') throw new Error(result.error ?? 'the turn failed')
  },
  notify: async (watch, title, detail) => (await import('../viewerAttention')).postViewerAttention({ sessionId: watch.sessionId, title, detail }) as unknown as void,
}

const waking = new Set<string>()
let ticking = false

/** Writes one watch back, unless it was stopped or restarted while we were reading. */
function save(watch: PrWatch): boolean {
  let kept = false
  updatePrWatches(watches => watches.map(entry => {
    if (entry.key !== watch.key || entry.startedAt !== watch.startedAt) return entry
    kept = true
    return watch
  }))
  return kept
}

function end(watch: PrWatch): void {
  updatePrWatches(watches => watches.filter(entry => entry.key !== watch.key || entry.startedAt !== watch.startedAt))
}

async function check(watch: PrWatch, now: number, deps: PrWatchDeps): Promise<void> {
  const label = `${watch.pr.repo}#${watch.pr.number}`
  if (await deps.settled(watch)) { end(watch); return }
  const due = !watch.checkedAt || now - watch.checkedAt >= WATCH_INTERVAL_MS
  if (!due && !watch.pending.length) return
  let detail: GithubPrDetail
  try {
    detail = await deps.read(watch.cwd, watch.pr.number, githubRepoArgument(watch.pr.url, watch.pr.repo))
  } catch (error) {
    if (!due) return
    const message = error instanceof Error ? error.message : String(error)
    // A rate limit says nothing about the pull request: wait it out without counting it.
    const failedReads = /rate limit/i.test(message) ? watch.failedReads : watch.failedReads + 1
    if (failedReads >= WATCH_MAX_FAILED_READS) {
      end(watch)
      await deps.notify(watch, `Stopped watching ${label}`, `It could not be read ${failedReads} times in a row: ${message}`)
    } else save({ ...watch, checkedAt: now, failedReads, error: message })
    return
  }
  const next: PrWatch = { ...watch, checkedAt: due ? now : watch.checkedAt, failedReads: 0, error: undefined }
  if (detail.state !== 'OPEN') {
    end(watch)
    await deps.notify(watch, `${label} was ${detail.state.toLowerCase()}`, 'Watching has ended.')
    return
  }
  if (!next.snapshot) { save({ ...next, snapshot: snapshotPr(detail) }); return }
  const changes = diffPrWatch(next.snapshot, detail, await deps.viewer(watch.cwd, watch.pr.url))
  next.snapshot = changes.snapshot
  next.pending = [...next.pending, ...changes.events].slice(-40)
  if (!next.pending.length || waking.has(watch.key) || await deps.busy(watch)) { save(next); return }
  const events = next.pending
  const commentWakes = onlyFeedback(events) ? next.commentWakes + 1 : 0
  // Cleared and counted before the turn starts: a crash during it must not deliver the same news again.
  const delivered: PrWatch = { ...next, pending: [], wakes: next.wakes + 1, commentWakes }
  if (!save(delivered)) return
  if (commentWakes >= WATCH_MAX_COMMENT_WAKES) end(delivered)
  waking.add(watch.key)
  void deps.wake(delivered, buildPrWatchPrompt(detail, events))
    .catch(error => deps.notify(delivered, `Could not wake the agent for ${label}`, error instanceof Error ? error.message : String(error)))
    .finally(() => waking.delete(watch.key))
  if (commentWakes >= WATCH_MAX_COMMENT_WAKES) await deps.notify(delivered, `Stopped watching ${label}`, `${commentWakes} wakes in a row brought only comments.`)
}

export async function runPrWatchTick(now: number = Date.now(), overrides: Partial<PrWatchDeps> = {}): Promise<void> {
  if (ticking) return
  ticking = true
  try {
    const deps = { ...defaultDeps, ...overrides }
    for (const watch of readPrWatches()) await check(watch, now, deps).catch(() => {})
  } finally { ticking = false }
}
