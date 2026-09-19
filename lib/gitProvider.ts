export type GitStatusEntry = {
  x: string
  y: string
  path: string
}

export type GitData = {
  branch: string
  upstream: string | null
  ahead: number
  behind: number
  status: GitStatusEntry[]
  unstaged: string
  staged: string
  branches: string[]
  commits: string[]
}

export type GitSummary = {
  branch: string
  modified: number
  untracked: number
  stashes: number
}

export type GitBranchRef = {
  name: string
  current: boolean
  worktreePath: string | null
}

export type GitReviewFile = {
  path: string
  x: string
  y: string
  status: string
  staged: boolean
  unstaged: boolean
  untracked: boolean
  additions: number
  deletions: number
  patch: string
}

export type GitReviewData = GitData & {
  files: GitReviewFile[]
  omittedFiles: number
  generatedAt: number
}

/** Which pair of trees the panel is diffing.
 *
 *  'working' is git's own uncommitted-changes view; 'branch' is everything this
 *  branch changed since its fork point; 'turn' is one agent turn's checkpoint
 *  compared against the working tree right now. Resolution lives in
 *  lib/gitDiffSources.ts — this file stays free of Node imports so client
 *  components can keep importing these types. */
export type GitDiffSource =
  | { kind: 'working' }
  | { kind: 'branch' }
  | { kind: 'turn'; sha: string }

export type GitTurnRef = {
  sha: string
  label: string
  createdAt: number
  sessionId?: string
}

export function parseGitDiffSource(kind: unknown, sha: unknown): GitDiffSource {
  if (kind === 'branch') return { kind: 'branch' }
  if (kind === 'turn' && typeof sha === 'string' && /^[0-9a-f]{7,64}$/.test(sha)) return { kind: 'turn', sha }
  return { kind: 'working' }
}

export type GitPaneId = 0 | 1 | 2 | 3 | 4

export type GitCommandRunner = (cwd: string, args: string[]) => Promise<string>

const ALLOWED_GIT_COMMANDS = new Set([
  'rev-parse',
  'status',
  'branch',
  'log',
  'diff',
  'show',
  'rev-list',
])

export function isAllowedGitCommand(args: unknown): args is string[] {
  return Array.isArray(args)
    && args.length > 0
    && typeof args[0] === 'string'
    && ALLOWED_GIT_COMMANDS.has(args[0])
    && args.every((arg) => typeof arg === 'string')
}

function parseGitStatus(statusRaw: string): GitStatusEntry[] {
  return statusRaw
    ? statusRaw.split('\n').filter(Boolean).map((line) => ({
        x: line[0] ?? ' ',
        y: line[1] ?? ' ',
        path: line.slice(3),
      }))
    : []
}

export async function fetchGitSummary(cwd: string, runGit: GitCommandRunner): Promise<GitSummary | null> {
  const [branch, statusRaw, stashCountRaw] = await Promise.all([
    runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
    runGit(cwd, ['status', '--porcelain', '-u']),
    runGit(cwd, ['rev-list', '--walk-reflogs', '--count', 'refs/stash']),
  ])
  if (!branch) return null

  let modified = 0
  let untracked = 0
  for (const entry of parseGitStatus(statusRaw)) {
    if (entry.x === '?' && entry.y === '?') untracked += 1
    else modified += 1
  }

  return {
    branch,
    modified,
    untracked,
    stashes: Number.parseInt(stashCountRaw, 10) || 0,
  }
}

export async function fetchGitBranches(cwd: string, runGit: GitCommandRunner): Promise<GitBranchRef[]> {
  const [current, branchesRaw, worktreesRaw] = await Promise.all([
    runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
    runGit(cwd, ['branch', '--format=%(refname:short)']),
    runGit(cwd, ['worktree', 'list', '--porcelain']),
  ])

  const worktreeByBranch = new Map<string, string>()
  let worktreePath: string | null = null
  for (const line of worktreesRaw.split('\n')) {
    if (line.startsWith('worktree ')) {
      worktreePath = line.slice('worktree '.length)
    } else if (line.startsWith('branch refs/heads/') && worktreePath) {
      worktreeByBranch.set(line.slice('branch refs/heads/'.length), worktreePath)
    } else if (!line) {
      worktreePath = null
    }
  }

  return [...new Set(branchesRaw.split('\n').map((branch) => branch.trim()).filter(Boolean))]
    .map((name) => ({
      name,
      current: name === current,
      worktreePath: worktreeByBranch.get(name) ?? null,
    }))
    .sort((left, right) => Number(right.current) - Number(left.current) || left.name.localeCompare(right.name))
}

export function isSafeGitBranchName(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > 255) return false
  if (value.startsWith('-') || value.startsWith('/') || value.endsWith('/') || value.endsWith('.')) return false
  if (value.includes('..') || value.includes('//') || value.includes('@{')) return false
  if (/[\s~^:?*[\\\]]/.test(value)) return false
  return value.split('/').every((part) => part && !part.startsWith('.') && !part.endsWith('.lock'))
}

function reviewPath(entry: GitStatusEntry): string {
  const renameMarker = ' -> '
  return entry.path.includes(renameMarker) ? entry.path.split(renameMarker).at(-1) ?? entry.path : entry.path
}

function statusLabel(entry: GitStatusEntry): string {
  if (entry.x === '?' && entry.y === '?') return 'untracked'
  if (entry.x === 'D' || entry.y === 'D') return 'deleted'
  if (entry.x === 'A' || entry.y === 'A') return 'added'
  if (entry.x === 'R' || entry.y === 'R') return 'renamed'
  if (entry.x === 'C' || entry.y === 'C') return 'copied'
  if (entry.x === 'U' || entry.y === 'U') return 'conflict'
  return 'modified'
}

function countPatchLines(patch: string): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) additions += 1
    else if (line.startsWith('-')) deletions += 1
  }
  return { additions, deletions }
}

async function fetchReviewPatch(cwd: string, runGit: GitCommandRunner, entry: GitStatusEntry): Promise<string> {
  const path = reviewPath(entry)
  if (entry.x === '?' && entry.y === '?') {
    return await runGit(cwd, ['diff', '--no-index', '/dev/null', path]) || ''
  }
  return await runGit(cwd, ['diff', 'HEAD', '--', path])
    || await runGit(cwd, ['diff', '--cached', '--', path])
    || ''
}

export async function fetchGitData(cwd: string, runGit: GitCommandRunner): Promise<GitData> {
  // Full working-tree diffs are deferred to the per-pane loader so opening the
  // popover stays responsive on large repositories and slower platforms.
  const [branch, upstreamRaw, statusRaw, branchesRaw, commitsRaw] = await Promise.all([
    runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
    runGit(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']),
    runGit(cwd, ['status', '--porcelain', '-u']),
    runGit(cwd, ['branch', '-a', '--format=%(refname:short)']),
    runGit(cwd, ['log', '--oneline', '-30']),
  ])

  const upstream = upstreamRaw.startsWith('fatal') ? null : upstreamRaw || null
  const aheadBehindRaw = upstream
    ? await runGit(cwd, ['rev-list', '--left-right', '--count', `${upstream}...HEAD`])
    : ''
  const [behindStr, aheadStr] = aheadBehindRaw.split('\t')
  const ahead = parseInt(aheadStr ?? '0', 10) || 0
  const behind = parseInt(behindStr ?? '0', 10) || 0

  return {
    branch: branch || 'HEAD',
    upstream,
    ahead,
    behind,
    status: parseGitStatus(statusRaw),
    unstaged: '',
    staged: '',
    branches: branchesRaw ? branchesRaw.split('\n').filter(Boolean) : [],
    commits: commitsRaw ? commitsRaw.split('\n').filter(Boolean) : [],
  }
}

export async function fetchGitReviewData(cwd: string, runGit: GitCommandRunner): Promise<GitReviewData> {
  const data = await fetchGitData(cwd, runGit)
  const reviewLimit = 80
  const files = await Promise.all(data.status.slice(0, reviewLimit).map(async (entry) => {
    const patch = await fetchReviewPatch(cwd, runGit, entry)
    const counts = countPatchLines(patch)
    const path = reviewPath(entry)
    return {
      path,
      x: entry.x,
      y: entry.y,
      status: statusLabel(entry),
      staged: entry.x !== ' ' && entry.x !== '?',
      unstaged: entry.y !== ' ' && entry.y !== '?',
      untracked: entry.x === '?' && entry.y === '?',
      additions: counts.additions,
      deletions: counts.deletions,
      patch,
    }
  }))

  return {
    ...data,
    files,
    omittedFiles: Math.max(data.status.length - files.length, 0),
    generatedAt: Date.now(),
  }
}

export async function fetchGitPaneContent({
  cwd,
  runGit,
  data,
  pane,
  selectedFilePath,
  branchIndex,
  commitIndex,
}: {
  cwd: string
  runGit: GitCommandRunner
  data: GitData
  pane: GitPaneId
  selectedFilePath?: string | null
  branchIndex?: number
  commitIndex?: number
}): Promise<string> {
  switch (pane) {
    case 0: {
      const [unstaged, staged] = await Promise.all([
        runGit(cwd, ['diff']),
        runGit(cwd, ['diff', '--cached']),
      ])
      return unstaged || (staged
        ? '(no unstaged changes)\n\n' + staged
        : '(working tree clean)')
    }
    case 1: {
      const parts = [`Branch:   ${data.branch}`]
      parts.push(data.upstream
        ? `Upstream: ${data.upstream}  ↑${data.ahead}  ↓${data.behind}`
        : 'No upstream configured')
      return parts.join('\n')
    }
    case 2: {
      if (!selectedFilePath) {
        return data.status.length === 0 ? '(working tree clean)' : '(select a file)'
      }
      const entry = data.status.find((e) => e.path === selectedFilePath)
      const isUntracked = entry?.x === '?' && entry?.y === '?'
      if (isUntracked) {
        return await runGit(cwd, ['diff', '--no-index', '/dev/null', selectedFilePath]) || '(empty file)'
      }
      return await runGit(cwd, ['diff', 'HEAD', '--', selectedFilePath])
        || await runGit(cwd, ['diff', '--cached', '--', selectedFilePath])
        || '(no changes)'
    }
    case 3: {
      const branch = data.branches[branchIndex ?? 0]
      return branch ? (await runGit(cwd, ['log', '--oneline', '-20', branch]) || branch) : '(no branches)'
    }
    case 4: {
      const commit = data.commits[commitIndex ?? 0]
      if (!commit) return '(no commits)'
      const hash = commit.split(' ')[0]
      return hash ? await runGit(cwd, ['show', '--stat', hash]) : commit
    }
  }
}
