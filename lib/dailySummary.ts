// What every agent did over a day or a week, grouped by repository: the
// prompts each session was given, the files it wrote, the commits and pull
// requests that came of it, and what is still waiting on the user.
//
// No Node imports: the reader (`lib/dailySummaryReader.ts`) gathers the index
// rows, git and `gh` answers and hands them here; this module only groups and
// formats, so the whole shape is testable without a repository.

import type { AgentProvider } from './types'

export type DailySummaryRange = 'today' | 'yesterday' | 'week'

export const DAILY_SUMMARY_RANGES: readonly DailySummaryRange[] = ['today', 'yesterday', 'week']

export type DailySummaryBounds = { fromMs: number; toMs: number; label: string }

/** Local-time bounds. A week starts on Monday, as most standups count one. */
export function dailySummaryBounds(range: DailySummaryRange, now: Date = new Date()): DailySummaryBounds {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const day = (date: Date) => date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  if (range === 'today') return { fromMs: midnight.getTime(), toMs: now.getTime(), label: `Today · ${day(midnight)}` }
  if (range === 'yesterday') {
    const start = new Date(midnight)
    start.setDate(start.getDate() - 1)
    return { fromMs: start.getTime(), toMs: midnight.getTime() - 1, label: `Yesterday · ${day(start)}` }
  }
  const start = new Date(midnight)
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  return { fromMs: start.getTime(), toMs: now.getTime(), label: `This week · since ${day(start)}` }
}

export type DailySummarySessionInput = {
  key: string
  provider: AgentProvider
  sessionId: string
  title: string
  cwd: string | null
  firstPrompt: string | null
  firstMessageAt: number | null
  lastMessageAt: number | null
  lastModified: number | null
}

export type DailySummaryCommit = { sha: string; subject: string; author: string; timestampMs: number }

export type DailySummaryPullRequest = {
  number: number
  title: string
  state: 'OPEN' | 'MERGED' | 'CLOSED'
  url: string
  isDraft: boolean
  reviewDecision: string | null
}

export type DailySummaryRepoInput = {
  root: string
  /** False for a directory that is gone (a removed worktree, a temp checkout). */
  exists: boolean
  commits: DailySummaryCommit[]
  pullRequests: DailySummaryPullRequest[]
  /** Files `git status` lists, or null when it could not be read. */
  dirtyFiles: number | null
}

export type DailySummaryWaitingInput = {
  provider: AgentProvider
  sessionId: string
  kind: 'permission' | 'question' | 'plan' | 'waiting' | 'viewer-note' | 'turn-done'
  text: string
}

export type DailySummaryInput = {
  range: DailySummaryRange
  bounds: DailySummaryBounds
  sessions: DailySummarySessionInput[]
  prompts: Array<{ sessionKey: string; timestampMs: number; text: string }>
  edits: Array<{ sessionKey: string; timestampMs: number; filePath: string; prompt: string | null }>
  /** cwd → repository root, or null when the cwd is not in a repository. */
  repoRoots: ReadonlyMap<string, string | null>
  repos: DailySummaryRepoInput[]
  waiting: DailySummaryWaitingInput[]
  /** Set when `gh` was missing or failed, so "no pull requests" is not claimed. */
  pullRequestsUnavailable?: string | null
}

export type DailySummarySession = {
  key: string
  provider: AgentProvider
  sessionId: string
  title: string
  prompts: string[]
  /** The transcript has not been indexed since the session ran, so prompts and files are missing. */
  unindexed: boolean
  files: string[]
  lastActiveMs: number
  waiting: DailySummaryWaitingInput[]
}

export type DailySummaryWaiting = { text: string; session?: string }

export type DailySummaryRepo = {
  root: string
  name: string
  exists: boolean
  sessions: DailySummarySession[]
  files: string[]
  commits: DailySummaryCommit[]
  pullRequests: DailySummaryPullRequest[]
  waiting: DailySummaryWaiting[]
}

export type DailySummary = {
  range: DailySummaryRange
  label: string
  repos: DailySummaryRepo[]
  totals: { sessions: number; prompts: number; files: number; commits: number; pullRequests: number; waiting: number }
  unindexedSessions: number
  pullRequestsUnavailable: string | null
}

const NO_REPO = ''
const MAX_PROMPT_CHARS = 160

function oneLine(text: string, max = MAX_PROMPT_CHARS): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

function baseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  return trimmed.slice(Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1) || trimmed
}

function relativeTo(root: string, filePath: string): string {
  if (!root) return filePath
  const prefix = root.endsWith('/') ? root : `${root}/`
  return filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath
}

const WAITING_WORDS: Record<DailySummaryWaitingInput['kind'], string> = {
  permission: 'approval',
  question: 'question',
  plan: 'plan to review',
  waiting: 'waiting for you',
  'viewer-note': 'note',
  'turn-done': 'finished, unread',
}

export function buildDailySummary(input: DailySummaryInput): DailySummary {
  const { fromMs } = input.bounds
  const promptsBySession = new Map<string, string[]>()
  for (const prompt of input.prompts) {
    const list = promptsBySession.get(prompt.sessionKey) ?? []
    list.push(oneLine(prompt.text))
    promptsBySession.set(prompt.sessionKey, list)
  }
  const editsBySession = new Map<string, typeof input.edits>()
  for (const edit of input.edits) {
    const list = editsBySession.get(edit.sessionKey) ?? []
    list.push(edit)
    editsBySession.set(edit.sessionKey, list)
  }
  const waitingBySession = new Map<string, DailySummaryWaitingInput[]>()
  for (const item of input.waiting) {
    const id = `${item.provider}:${item.sessionId}`
    waitingBySession.set(id, [...(waitingBySession.get(id) ?? []), item])
  }
  const repoInputs = new Map(input.repos.map((repo) => [repo.root, repo]))

  const repos = new Map<string, DailySummaryRepo>()
  const repoFor = (root: string): DailySummaryRepo => {
    let repo = repos.get(root)
    if (!repo) {
      const source = repoInputs.get(root)
      repo = {
        root,
        name: root ? baseName(root) : 'Outside a repository',
        exists: source?.exists ?? true,
        sessions: [],
        files: [],
        commits: source?.commits ?? [],
        pullRequests: source?.pullRequests ?? [],
        waiting: [],
      }
      repos.set(root, repo)
    }
    return repo
  }

  let unindexedSessions = 0
  const seenWaiting = new Set<string>()
  for (const session of input.sessions) {
    const root = (session.cwd ? input.repoRoots.get(session.cwd) : null) ?? NO_REPO
    const edits = editsBySession.get(session.key) ?? []
    const prompts = [...(promptsBySession.get(session.key) ?? [])]
    // Before the index learned which rows are prompts, an edit still carried the
    // prompt of its turn — so a turn that wrote something is never lost.
    for (const edit of edits) {
      const text = edit.prompt ? oneLine(edit.prompt) : null
      if (text && !prompts.includes(text)) prompts.push(text)
    }
    const startedInRange = session.firstMessageAt !== null && session.firstMessageAt >= fromMs
    if (prompts.length === 0 && startedInRange && session.firstPrompt) prompts.push(oneLine(session.firstPrompt))
    const lastActiveMs = Math.max(session.lastMessageAt ?? 0, session.lastModified ?? 0)
    // The store moved in range but the index's last message did not: the
    // transcript has not been read since, so what the session did is unknown.
    const unindexed = (session.lastMessageAt ?? 0) < fromMs && (session.lastModified ?? 0) >= fromMs
    const waiting = waitingBySession.get(`${session.provider}:${session.sessionId}`) ?? []
    if (prompts.length === 0 && edits.length === 0 && waiting.length === 0 && !unindexed) continue
    if (unindexed) unindexedSessions += 1
    const files = [...new Set(edits.map((edit) => relativeTo(root, edit.filePath)))].sort()
    const repo = repoFor(root)
    repo.sessions.push({
      key: session.key,
      provider: session.provider,
      sessionId: session.sessionId,
      title: oneLine(session.title, 80),
      prompts,
      unindexed,
      files,
      lastActiveMs,
      waiting,
    })
    for (const file of files) if (!repo.files.includes(file)) repo.files.push(file)
    for (const item of waiting) {
      seenWaiting.add(`${item.provider}:${item.sessionId}:${item.kind}:${item.text}`)
      repo.waiting.push({ text: `${WAITING_WORDS[item.kind]}: ${oneLine(item.text, 100)}`, session: oneLine(session.title, 60) })
    }
  }

  // Repositories with commits or pull requests but no indexed session still count.
  for (const source of input.repos) {
    if (source.commits.length > 0 || source.pullRequests.length > 0) repoFor(source.root)
  }
  for (const repo of repos.values()) {
    const source = repoInputs.get(repo.root)
    if (source?.dirtyFiles) repo.waiting.push({ text: `${source.dirtyFiles} uncommitted file${source.dirtyFiles === 1 ? '' : 's'}` })
    for (const pr of repo.pullRequests) {
      if (pr.state !== 'OPEN') continue
      const status = pr.isDraft ? 'draft' : pr.reviewDecision === 'CHANGES_REQUESTED' ? 'changes requested' : pr.reviewDecision === 'APPROVED' ? 'approved, not merged' : 'open'
      repo.waiting.push({ text: `#${pr.number} ${status}: ${oneLine(pr.title, 80)}` })
    }
    repo.files.sort()
    repo.sessions.sort((a, b) => b.lastActiveMs - a.lastActiveMs)
  }

  // Waiting items whose session the range did not include still belong somewhere.
  const unplaced = input.waiting.filter((item) => !seenWaiting.has(`${item.provider}:${item.sessionId}:${item.kind}:${item.text}`))
  if (unplaced.length > 0) {
    const repo = repoFor(NO_REPO)
    for (const item of unplaced) repo.waiting.push({ text: `${WAITING_WORDS[item.kind]}: ${oneLine(item.text, 100)}` })
  }

  const ordered = [...repos.values()]
    .filter((repo) => repo.sessions.length > 0 || repo.commits.length > 0 || repo.pullRequests.length > 0 || repo.waiting.length > 0)
    .sort((a, b) => {
      // Repositories that still exist come first; a removed temp checkout is history.
      if (a.exists !== b.exists) return a.exists ? -1 : 1
      if ((a.root === NO_REPO) !== (b.root === NO_REPO)) return a.root === NO_REPO ? 1 : -1
      const activity = (repo: DailySummaryRepo) => repo.sessions.length * 4 + repo.commits.length * 2 + repo.files.length
      return activity(b) - activity(a) || a.name.localeCompare(b.name)
    })

  const sessions = ordered.flatMap((repo) => repo.sessions)
  return {
    range: input.range,
    label: input.bounds.label,
    repos: ordered,
    totals: {
      sessions: sessions.length,
      prompts: sessions.reduce((sum, session) => sum + session.prompts.length, 0),
      files: ordered.reduce((sum, repo) => sum + repo.files.length, 0),
      commits: ordered.reduce((sum, repo) => sum + repo.commits.length, 0),
      pullRequests: ordered.reduce((sum, repo) => sum + repo.pullRequests.length, 0),
      waiting: ordered.reduce((sum, repo) => sum + repo.waiting.length, 0),
    },
    unindexedSessions,
    pullRequestsUnavailable: input.pullRequestsUnavailable ?? null,
  }
}

const MAX_PROMPTS_PER_SESSION = 6
const MAX_FILES_LISTED = 12

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

/** The summary as markdown: what is pasted into a standup, a PR or a chat. */
export function formatDailySummaryMarkdown(summary: DailySummary): string {
  const { totals } = summary
  const lines: string[] = [`# ${summary.label}`, '']
  lines.push([
    plural(totals.sessions, 'session'),
    plural(totals.prompts, 'prompt'),
    plural(totals.files, 'file') + ' changed',
    plural(totals.commits, 'commit'),
    plural(totals.pullRequests, 'pull request'),
  ].join(' · '))
  if (totals.waiting > 0) lines.push(`**${totals.waiting} waiting on you**`)
  if (summary.repos.length === 0) lines.push('', 'No recorded agent activity in this range.')

  for (const repo of summary.repos) {
    lines.push('', `## ${repo.name}${repo.exists ? '' : ' (no longer on disk)'}`)
    if (repo.root) lines.push(repo.root)
    if (repo.waiting.length > 0) {
      lines.push('', '**Waiting on you**')
      for (const item of repo.waiting) lines.push(`- ${item.text}${item.session ? ` — ${item.session}` : ''}`)
    }
    if (repo.sessions.length > 0) {
      lines.push('', '**Sessions**')
      for (const session of repo.sessions) {
        const files = session.files.length > 0 ? ` · ${plural(session.files.length, 'file')}` : ''
        lines.push(`- ${session.title} (${session.provider}${files})${session.unindexed ? ' — not indexed since it ran; open it to include its prompts' : ''}`)
        for (const prompt of session.prompts.slice(0, MAX_PROMPTS_PER_SESSION)) lines.push(`  - "${prompt}"`)
        if (session.prompts.length > MAX_PROMPTS_PER_SESSION) lines.push(`  - … ${session.prompts.length - MAX_PROMPTS_PER_SESSION} more`)
      }
    }
    if (repo.files.length > 0) {
      lines.push('', `**Files changed** (${repo.files.length})`)
      for (const file of repo.files.slice(0, MAX_FILES_LISTED)) lines.push(`- ${file}`)
      if (repo.files.length > MAX_FILES_LISTED) lines.push(`- … ${repo.files.length - MAX_FILES_LISTED} more`)
    }
    if (repo.commits.length > 0) {
      lines.push('', `**Commits** (${repo.commits.length})`)
      for (const commit of repo.commits) lines.push(`- ${commit.sha.slice(0, 7)} ${oneLine(commit.subject, 100)}`)
    }
    if (repo.pullRequests.length > 0) {
      lines.push('', '**Pull requests**')
      for (const pr of repo.pullRequests) {
        const state = pr.state === 'OPEN' ? (pr.isDraft ? 'draft' : 'open') : pr.state.toLowerCase()
        lines.push(`- #${pr.number} ${oneLine(pr.title, 100)} (${state}) ${pr.url}`)
      }
    }
  }

  const notes: string[] = []
  if (summary.unindexedSessions > 0) notes.push(`${plural(summary.unindexedSessions, 'session')} ran without being indexed; open them to include what they did.`)
  if (summary.pullRequestsUnavailable) notes.push(`Pull requests not read: ${summary.pullRequestsUnavailable}.`)
  if (notes.length > 0) lines.push('', ...notes.map((note) => `_${note}_`))
  return `${lines.join('\n')}\n`
}
