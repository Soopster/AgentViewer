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
