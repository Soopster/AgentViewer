// Gathers what `lib/dailySummary.ts` groups: the index's activity rows, then
// per repository the user's commits, its pull requests and its working tree.
//
// Every outside answer is best-effort. A repository git cannot read, a `gh`
// that is missing or logged out, or a directory that is gone each degrade to
// "not known" and are said so in the summary, never to an error that hides the
// rest of the day.

import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { promisify } from 'node:util'

import {
  buildDailySummary,
  dailySummaryBounds,
  type DailySummary,
  type DailySummaryCommit,
  type DailySummaryPullRequest,
  type DailySummaryRange,
  type DailySummaryRepoInput,
  type DailySummaryWaitingInput,
} from './dailySummary'
import { readPersistedActivity } from './sessionPersistence'
import { findRepoRoot } from './worktreeTasks'

const execFileAsync = promisify(execFile)
const GIT_TIMEOUT_MS = 8_000
const GH_TIMEOUT_MS = 10_000
const REPO_CONCURRENCY = 4
const MAX_COMMITS = 200
const FIELD = '\x1f'

async function run(command: string, args: string[], cwd: string, timeout: number): Promise<string> {
  const { stdout } = await execFileAsync(command, args, { cwd, timeout, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' })
  return stdout
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index]!)
    }
  }))
  return results
}

/** Commits by this repository's configured author, on any branch (agents commit on worktree branches). */
export async function readRepoCommits(root: string, fromMs: number, toMs: number): Promise<DailySummaryCommit[]> {
  const email = (await run('git', ['config', 'user.email'], root, GIT_TIMEOUT_MS).catch(() => '')).trim()
  const args = [
    'log', '--all', '--no-merges', `--max-count=${MAX_COMMITS}`,
    `--since=@${Math.floor(fromMs / 1000)}`, `--until=@${Math.ceil(toMs / 1000)}`,
    `--format=%H${FIELD}%an${FIELD}%ct${FIELD}%s`,
  ]
  if (email) args.push(`--author=${email}`)
  const out = await run('git', args, root, GIT_TIMEOUT_MS)
  const commits: DailySummaryCommit[] = []
  for (const line of out.split('\n')) {
    const [sha, author, seconds, subject] = line.split(FIELD)
    if (!sha || !seconds) continue
    const timestampMs = Number(seconds) * 1000
    // --since filters by committer date; a rebased old commit is not today's work.
    if (timestampMs < fromMs || timestampMs > toMs) continue
    commits.push({ sha, author: author ?? '', timestampMs, subject: subject ?? '' })
  }
  return commits
}

async function readDirtyFiles(root: string): Promise<number | null> {
  try {
    // --no-optional-locks: a plain status refreshes the index and takes the lock
    // an agent working in this checkout may be waiting on.
    const out = await run('git', ['--no-optional-locks', 'status', '--porcelain'], root, GIT_TIMEOUT_MS)
    return out.split('\n').filter(Boolean).length
  } catch {
    return null
  }
}

type GhPullRequest = {
  number?: number
  title?: string
  state?: string
  url?: string
  isDraft?: boolean
  reviewDecision?: string | null
  updatedAt?: string
}

class GhUnavailable extends Error {}

async function readPullRequests(root: string, fromMs: number): Promise<DailySummaryPullRequest[]> {
  const since = new Date(fromMs).toISOString().slice(0, 10)
  let out: string
  try {
    out = await run('gh', [
      'pr', 'list', '--author', '@me', '--state', 'all', '--limit', '30',
      '--search', `updated:>=${since}`,
      '--json', 'number,title,state,url,isDraft,reviewDecision,updatedAt',
    ], root, GH_TIMEOUT_MS)
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stderr?: string }
    if (err.code === 'ENOENT') throw new GhUnavailable('gh is not installed')
    const stderr = String(err.stderr ?? '')
    if (/auth login|not logged/i.test(stderr)) throw new GhUnavailable('gh is not logged in')
    // A repository with no GitHub remote is not a failure of gh.
    return []
  }
  const parsed = JSON.parse(out) as GhPullRequest[]
  return parsed.flatMap((pr) => {
    if (typeof pr.number !== 'number' || !pr.url) return []
    // The search is by day; drop what was last touched before the range began.
    if (pr.updatedAt && Date.parse(pr.updatedAt) < fromMs) return []
    const state = pr.state === 'MERGED' || pr.state === 'CLOSED' ? pr.state : 'OPEN'
    return [{ number: pr.number, title: pr.title ?? '', state, url: pr.url, isDraft: Boolean(pr.isDraft), reviewDecision: pr.reviewDecision ?? null }]
  })
}

async function directoryExists(path: string): Promise<boolean> {
  return stat(path).then((entry) => entry.isDirectory(), () => false)
}

export type DailySummaryReadOptions = {
  range: DailySummaryRange
  now?: Date
  waiting?: DailySummaryWaitingInput[]
  /** Skip `gh` (tests, and hosts where it would prompt). */
  skipPullRequests?: boolean
}

export async function readDailySummary(options: DailySummaryReadOptions): Promise<DailySummary> {
  const bounds = dailySummaryBounds(options.range, options.now)
  const activity = await readPersistedActivity(bounds.fromMs, bounds.toMs)

  const cwds = [...new Set(activity.sessions.flatMap((session) => session.cwd ? [session.cwd] : []))]
  const repoRoots = new Map<string, string | null>()
  const exists = new Map<string, boolean>()
  await mapLimit(cwds, REPO_CONCURRENCY * 2, async (cwd) => {
    const present = await directoryExists(cwd)
    // A removed checkout cannot be asked for its repository; it stands for itself.
    const root = present ? await findRepoRoot(cwd) : cwd
    repoRoots.set(cwd, root)
    if (root) exists.set(root, (exists.get(root) ?? false) || present)
  })

  let pullRequestsUnavailable: string | null = null
  const roots = [...exists.keys()]
  const repos = await mapLimit(roots, REPO_CONCURRENCY, async (root): Promise<DailySummaryRepoInput> => {
    if (!exists.get(root)) return { root, exists: false, commits: [], pullRequests: [], dirtyFiles: null }
    const [commits, dirtyFiles, pullRequests] = await Promise.all([
      readRepoCommits(root, bounds.fromMs, bounds.toMs).catch(() => []),
      readDirtyFiles(root),
      options.skipPullRequests || pullRequestsUnavailable
        ? Promise.resolve([])
        : readPullRequests(root, bounds.fromMs).catch((error: unknown) => {
            if (error instanceof GhUnavailable) pullRequestsUnavailable = error.message
            return []
          }),
    ])
    return { root, exists: true, commits, pullRequests, dirtyFiles }
  })

  return buildDailySummary({
    range: options.range,
    bounds,
    sessions: activity.sessions.map((session) => ({
      key: session.key,
      provider: session.provider,
      sessionId: session.sessionId,
      title: session.customTitle || session.title,
      cwd: session.cwd ?? null,
      firstPrompt: session.firstPrompt ?? null,
      firstMessageAt: session.firstMessageAt,
      lastMessageAt: session.lastMessageAt,
      lastModified: session.lastModified ?? null,
    })),
    prompts: activity.prompts,
    edits: activity.edits,
    repoRoots,
    repos,
    waiting: options.waiting ?? [],
    pullRequestsUnavailable,
  })
}
