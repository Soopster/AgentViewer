import type { GitCommandRunner, GitStatusEntry } from './gitProvider'

/** The workspace's own facts plus its sibling worktrees — hunk's `status`
 *  compass. Read-only: nothing here fetches, locks the index or changes a ref.
 *
 *  Free of Node imports so client components can keep importing the types and
 *  the pure helpers (`isConflictEntry`, `renameLabel`). */

export type GitOperation = 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'bisect'

export type GitBranchFacts = {
  /** null when HEAD is detached. */
  branch: string | null
  /** A branch with no commit yet. */
  unborn: boolean
  upstream: string | null
  /** The upstream is configured but its ref is gone. */
  upstreamGone: boolean
  ahead: number
  behind: number
}

export type GitWorktreeState = 'ok' | 'bare' | 'locked' | 'prunable' | 'unreadable'

export type GitWorktreeSummary = GitBranchFacts & {
  path: string
  head: string
  state: GitWorktreeState
  tracked: number
  untracked: number
  conflicts: number
}

export type GitWorkspaceStatus = GitBranchFacts & {
  /** The inspected worktree's top level. */
  root: string
  head: string
  operation: GitOperation | null
  tracked: GitStatusEntry[]
  untracked: GitStatusEntry[]
  conflicts: number
  siblings: GitWorktreeSummary[]
  /** More worktrees exist than were read. */
  siblingsOmitted: number
}

/** Sibling reads are one `git status` each; a repository with hundreds of
 *  agent worktrees must not turn opening a pane into hundreds of spawns. */
export const WORKTREE_SIBLING_LIMIT = 24
const SIBLING_CONCURRENCY = 4
/** Each group lists this many paths before collapsing to a count. */
export const STATUS_GROUP_LIMIT = 10

const OPERATION_HEADS: Array<[ref: string, operation: GitOperation]> = [
  ['MERGE_HEAD', 'merge'],
  ['REBASE_HEAD', 'rebase'],
  ['CHERRY_PICK_HEAD', 'cherry-pick'],
  ['REVERT_HEAD', 'revert'],
  ['BISECT_HEAD', 'bisect'],
]

/** Which operation the worktree is paused in, from one spawn: `%S` names the
 *  ref each commit was reached by and `--ignore-missing` drops the absent ones,
 *  so the output is exactly the operation heads that exist. */
export async function fetchGitOperation(cwd: string, runGit: GitCommandRunner): Promise<GitOperation | null> {
  const present = new Set((await runGit(cwd, [
    'log', '--no-walk', '--ignore-missing', '--format=%S', ...OPERATION_HEADS.map(([ref]) => ref),
  ])).split('\n'))
  return OPERATION_HEADS.find(([ref]) => present.has(ref))?.[1] ?? null
}

/** Porcelain's unmerged pairs: either side `U`, or both added / both deleted. */
export function isConflictEntry(x: string, y: string): boolean {
  return x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')
}

function splitPath(path: string): [directory: string, name: string] {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? ['', path] : [path.slice(0, slash), path.slice(slash + 1)]
}

/** A rename inside one directory says the directory once; a move still needs
 *  both full paths. */
export function renameLabel(previousPath: string, path: string): string {
  const [previousDirectory] = splitPath(previousPath)
  const [directory, name] = splitPath(path)
  return `${previousPath} → ${previousDirectory === directory ? name : path}`
}

/** A file-tree row already sits under its directory, so the origin is the only
 *  part worth spelling out — and the current name leads, so truncation keeps it. */
export function renameOriginLabel(previousPath: string, path: string): string {
  const [previousDirectory, previousName] = splitPath(previousPath)
  return splitPath(path)[0] === previousDirectory ? previousName : previousPath
}

const CHANGE_WORDS: Record<string, string> = {
  M: 'modified', A: 'new file', D: 'deleted', R: 'renamed', C: 'copied', T: 'type changed',
}

const CONFLICT_WORDS: Record<string, string> = {
  UU: 'both modified', AA: 'both added', DD: 'both deleted',
  AU: 'added by us', UA: 'added by them', DU: 'deleted by us', UD: 'deleted by them',
}

/** `modified (staged)`, or both sides spelled out when staging is mixed. */
export function describeStatusEntry(entry: Pick<GitStatusEntry, 'x' | 'y'>): string {
  const { x, y } = entry
  if (x === '?' && y === '?') return 'untracked'
  if (isConflictEntry(x, y)) return `conflict (${CONFLICT_WORDS[x + y] ?? 'unmerged'})`
  const facts: string[] = []
  if (CHANGE_WORDS[x]) facts.push(`${CHANGE_WORDS[x]} (staged)`)
  if (CHANGE_WORDS[y]) facts.push(`${CHANGE_WORDS[y]} (unstaged)`)
  return facts.join(' · ') || 'changed'
}

/** Zero counters are omitted: `3 ahead · 1 behind origin/main`. */
export function describeUpstream(facts: GitBranchFacts): string {
  if (!facts.upstream) return facts.branch ? 'no upstream' : ''
  if (facts.upstreamGone) return `upstream ${facts.upstream} is gone`
  const counts = [
    facts.ahead ? `${facts.ahead} ahead` : '',
    facts.behind ? `${facts.behind} behind` : '',
  ].filter(Boolean)
  return counts.length ? `${counts.join(' · ')} ${facts.upstream}` : `up to date with ${facts.upstream}`
}

export function describeBranch(facts: GitBranchFacts & { head?: string }): string {
  if (!facts.branch) return facts.head ? `detached at ${facts.head.slice(0, 7)}` : 'detached HEAD'
  return facts.unborn ? `${facts.branch} (no commits yet)` : facts.branch
}

/** `## main...origin/main [ahead 1, behind 2]`, the first line of
 *  `status --porcelain=v1 -b`. */
export function parseBranchHeader(line: string): GitBranchFacts {
  const facts: GitBranchFacts = { branch: null, unborn: false, upstream: null, upstreamGone: false, ahead: 0, behind: 0 }
  if (!line.startsWith('## ')) return facts
  let rest = line.slice(3)
  if (rest.startsWith('HEAD (no branch)')) return facts
  for (const prefix of ['No commits yet on ', 'Initial commit on ']) {
    if (rest.startsWith(prefix)) { rest = rest.slice(prefix.length); facts.unborn = true }
  }
  const tracking = rest.match(/ \[([^\]]+)\]$/)
  if (tracking) {
    rest = rest.slice(0, tracking.index)
    facts.upstreamGone = tracking[1] === 'gone'
    facts.ahead = Number(tracking[1]!.match(/ahead (\d+)/)?.[1] ?? 0)
    facts.behind = Number(tracking[1]!.match(/behind (\d+)/)?.[1] ?? 0)
  }
  const separator = rest.indexOf('...')
  facts.branch = separator < 0 ? rest : rest.slice(0, separator)
  facts.upstream = separator < 0 ? null : rest.slice(separator + 3)
  return facts
}

/** Porcelain v1 entries; a rename keeps its origin beside the path it became. */
export function parseStatusEntries(lines: string[]): GitStatusEntry[] {
  return lines.filter(line => line.length > 3 && !line.startsWith('## ')).map((line) => {
    const x = line[0] ?? ' '
    const y = line[1] ?? ' '
    const raw = line.slice(3)
    const arrow = x === 'R' || y === 'R' || x === 'C' || y === 'C' ? raw.indexOf(' -> ') : -1
    return arrow < 0 ? { x, y, path: raw } : { x, y, path: raw.slice(arrow + 4), previousPath: raw.slice(0, arrow) }
  })
}

type WorktreeRecord = { path: string; head: string; branch: string | null; state: GitWorktreeState }

export function parseWorktreeList(raw: string): WorktreeRecord[] {
  const records: WorktreeRecord[] = []
  let current: WorktreeRecord | null = null
  for (const line of raw.split('\n')) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice(9), head: '', branch: null, state: 'ok' }
      records.push(current)
    } else if (!current) continue
    else if (line.startsWith('HEAD ')) current.head = line.slice(5)
    else if (line.startsWith('branch ')) current.branch = line.slice(7).replace(/^refs\/heads\//, '')
    else if (line === 'bare') current.state = 'bare'
    // A locked worktree is still readable; a prunable one has no directory left.
    else if (line.startsWith('prunable')) current.state = 'prunable'
    else if (line.startsWith('locked') && current.state === 'ok') current.state = 'locked'
  }
  return records
}

function readStatus(cwd: string, runGit: GitCommandRunner): Promise<string> {
  // Without this a status refreshes the index, which takes the lock an agent's
  // own git command in that worktree may be waiting on.
  return runGit(cwd, ['--no-optional-locks', 'status', '--porcelain=v1', '-b', '-u'])
}

function countEntries(entries: GitStatusEntry[]) {
  let tracked = 0, untracked = 0, conflicts = 0
  for (const entry of entries) {
    if (entry.x === '?' && entry.y === '?') untracked += 1
    else { tracked += 1; if (isConflictEntry(entry.x, entry.y)) conflicts += 1 }
  }
  return { tracked, untracked, conflicts }
}

async function readSibling(record: WorktreeRecord, runGit: GitCommandRunner): Promise<GitWorktreeSummary> {
  const empty: GitBranchFacts = { branch: record.branch, unborn: false, upstream: null, upstreamGone: false, ahead: 0, behind: 0 }
  const base = { path: record.path, head: record.head, tracked: 0, untracked: 0, conflicts: 0 }
  if (record.state === 'bare' || record.state === 'prunable') return { ...empty, ...base, state: record.state }
  const lines = (await readStatus(record.path, runGit).catch(() => '')).split('\n')
  // A readable worktree always answers with its branch header; silence is a
  // failed read, which must not be reported as a clean tree.
  if (!lines[0]?.startsWith('## ')) return { ...empty, ...base, state: 'unreadable' }
  return { ...parseBranchHeader(lines[0]), ...base, ...countEntries(parseStatusEntries(lines)), state: record.state }
}

export async function fetchGitWorkspaceStatus(cwd: string, runGit: GitCommandRunner): Promise<GitWorkspaceStatus | null> {
  const [statusRaw, topLevel, worktreesRaw, head, operation] = await Promise.all([
    readStatus(cwd, runGit),
    runGit(cwd, ['rev-parse', '--show-toplevel']),
    runGit(cwd, ['worktree', 'list', '--porcelain']),
    runGit(cwd, ['rev-parse', '-q', '--verify', 'HEAD']),
    fetchGitOperation(cwd, runGit),
  ])
  const lines = statusRaw.split('\n')
  if (!lines[0]?.startsWith('## ')) return null
  const entries = parseStatusEntries(lines)
  const others = parseWorktreeList(worktreesRaw).filter(record => record.path !== topLevel)
  const read = others.slice(0, WORKTREE_SIBLING_LIMIT)
  const siblings: GitWorktreeSummary[] = []
  for (let index = 0; index < read.length; index += SIBLING_CONCURRENCY) {
    siblings.push(...await Promise.all(read.slice(index, index + SIBLING_CONCURRENCY).map(record => readSibling(record, runGit))))
  }
  return {
    ...parseBranchHeader(lines[0]),
    root: topLevel,
    head: /^[0-9a-f]{7,64}$/.test(head) ? head : '',
    operation,
    tracked: entries.filter(entry => !(entry.x === '?' && entry.y === '?')),
    untracked: entries.filter(entry => entry.x === '?' && entry.y === '?'),
    conflicts: countEntries(entries).conflicts,
    siblings,
    siblingsOmitted: others.length - read.length,
  }
}

const OPERATION_LABELS: Record<GitOperation, string> = {
  merge: 'merge', rebase: 'rebase', 'cherry-pick': 'cherry-pick', revert: 'revert', bisect: 'bisect',
}

/** `merge in progress · 2 conflicts`, or null when the tree is idle. */
export function describeOperation(status: Pick<GitWorkspaceStatus, 'operation' | 'conflicts'>): string | null {
  const conflicts = status.conflicts ? `${status.conflicts} conflict${status.conflicts === 1 ? '' : 's'}` : ''
  if (!status.operation) return conflicts || null
  return [`${OPERATION_LABELS[status.operation]} in progress`, conflicts].filter(Boolean).join(' · ')
}

function describeSibling(sibling: GitWorktreeSummary): string {
  if (sibling.state === 'bare') return 'bare'
  if (sibling.state === 'prunable') return 'missing (prunable)'
  if (sibling.state === 'unreadable') return 'unreadable'
  const facts = [
    sibling.conflicts ? `${sibling.conflicts} conflict${sibling.conflicts === 1 ? '' : 's'}` : '',
    sibling.tracked ? `${sibling.tracked} changed` : '',
    sibling.untracked ? `${sibling.untracked} untracked` : '',
  ].filter(Boolean)
  const upstream = sibling.upstream ? describeUpstream(sibling) : ''
  return [
    facts.length ? facts.join(' · ') : 'clean',
    upstream.startsWith('up to date') ? '' : upstream,
    sibling.state === 'locked' ? 'locked' : '',
  ].filter(Boolean).join(' · ')
}

/** A sibling beside this worktree reads as `../name`; one elsewhere keeps its
 *  full path, since a long chain of `..` says less than the path does. */
export function siblingDisplayPath(root: string, path: string): string {
  const from = root.split('/')
  const to = path.split('/')
  let shared = 0
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) shared += 1
  const up = from.length - shared
  if (!root || shared < 2 || up > 2) return path
  return [...Array<string>(up).fill('..'), ...to.slice(shared)].join('/') || '.'
}

function groupLines(title: string, entries: GitStatusEntry[]): string[] {
  if (entries.length === 0) return []
  const shown = entries.slice(0, STATUS_GROUP_LIMIT)
  const untracked = entries[0]!.x === '?'
  return [
    '',
    `${title} (${entries.length})`,
    ...shown.map((entry) => {
      const path = entry.previousPath ? renameLabel(entry.previousPath, entry.path) : entry.path
      return untracked ? `  ${path}` : `  ${path}  ${describeStatusEntry(entry)}`
    }),
    ...(entries.length > shown.length ? [`  and ${entries.length - shown.length} more files`] : []),
  ]
}

/** Plain text for the Status pane. No line starts with `+`, `-` or `@@`: both
 *  popovers colour that pane's text by diff prefix. */
export function formatGitWorkspaceStatus(status: GitWorkspaceStatus): string {
  const operation = describeOperation(status)
  const upstream = describeUpstream(status)
  const lines = [
    `On ${describeBranch(status)}`,
    ...(upstream ? [`  ${upstream}`] : []),
    ...(operation ? [`  ${operation}`] : []),
  ]
  if (status.tracked.length === 0 && status.untracked.length === 0) lines.push('', 'Working tree clean')
  lines.push(...groupLines('Tracked changes', status.tracked), ...groupLines('Untracked files', status.untracked))
  if (status.siblings.length > 0) {
    lines.push('', `Other worktrees (${status.siblings.length + status.siblingsOmitted})`)
    for (const sibling of status.siblings) {
      lines.push(`  ${describeBranch(sibling)}  ${describeSibling(sibling)}`, `    ${siblingDisplayPath(status.root, sibling.path)}`)
    }
    if (status.siblingsOmitted > 0) lines.push(`  and ${status.siblingsOmitted} more worktrees`)
  }
  return lines.join('\n')
}
