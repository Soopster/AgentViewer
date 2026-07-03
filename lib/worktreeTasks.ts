// Worktree-per-task orchestration: spawn an agent session into an isolated
// git worktree (own branch, own checkout), then adopt the result back into the
// main checkout with a squash merge — or discard the whole experiment. Node
// APIs only (child_process/fs); consumed by the TUI service layer and safe for
// API routes, but never import from client components.

import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'

export const WORKTREE_TASKS_DIR = '.agent-viewer-worktrees'
export const WORKTREE_BRANCH_PREFIX = 'agent/'

export type WorktreeTask = {
  /** Absolute path of the task's worktree checkout. */
  path: string
  /** Branch the worktree has checked out (agent/<slug>). */
  branch: string
  /** Absolute path of the main repository root the task belongs to. */
  repoRoot: string
  slug: string
  /** Uncommitted-change count from `status --porcelain` (-1 when unreadable). */
  dirtyFiles: number
  /** Commits on the branch that the main checkout's HEAD doesn't have. */
  aheadCommits: number
}

class GitCommandError extends Error {
  constructor(args: string[], stderr: string) {
    super(`git ${args.join(' ')} failed${stderr ? `: ${stderr.trim()}` : ''}`)
    this.name = 'GitCommandError'
  }
}

// Unlike gitNodeProvider.runGitCommand (which swallows failures for read-only
// UI probes), worktree orchestration must surface git errors — a failed merge
// or worktree add has to reach the user verbatim.
function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new GitCommandError(args, String(stderr ?? '') || (err instanceof Error ? err.message : String(err))))
        return
      }
      resolve(String(stdout ?? '').trimEnd())
    })
  })
}

/**
 * Root of the MAIN repository, even when `cwd` is inside a linked worktree
 * (where `--show-toplevel` reports the worktree's own root). Resolved via the
 * shared .git dir so task orchestration always operates on the main checkout.
 */
export async function findRepoRoot(cwd: string): Promise<string | null> {
  try {
    const commonDir = await git(cwd, ['rev-parse', '--git-common-dir'])
    if (!commonDir) return null
    const absolute = path.resolve(cwd, commonDir)
    if (path.basename(absolute) === '.git') return path.dirname(absolute)
    // Bare/unusual layouts: fall back to the worktree's own toplevel.
    const root = await git(cwd, ['rev-parse', '--show-toplevel'])
    return root || null
  } catch {
    return null
  }
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return base || 'task'
}

// Keep the worktree home out of `git status` without touching the committed
// .gitignore — the repo-local exclude file is exactly for tooling like this.
async function ensureWorktreeDirExcluded(repoRoot: string): Promise<void> {
  try {
    const commonDir = await git(repoRoot, ['rev-parse', '--git-common-dir'])
    const excludePath = path.resolve(repoRoot, commonDir, 'info', 'exclude')
    const line = `/${WORKTREE_TASKS_DIR}/`
    let current = ''
    try {
      current = await fs.readFile(excludePath, 'utf-8')
    } catch {
      // no exclude file yet
    }
    if (current.split('\n').some((entry) => entry.trim() === line)) return
    await fs.mkdir(path.dirname(excludePath), { recursive: true })
    await fs.writeFile(excludePath, `${current.endsWith('\n') || current === '' ? current : `${current}\n`}${line}\n`)
  } catch {
    // best-effort: a visible untracked dir is cosmetic, not a failure
  }
}

/**
 * Create an isolated worktree + branch for a task, branched from the repo's
 * current HEAD. Returns the created task; throws with git's own message when
 * the worktree or branch can't be created.
 */
export async function createWorktreeTask(cwd: string, name: string): Promise<WorktreeTask> {
  const repoRoot = await findRepoRoot(cwd)
  if (!repoRoot) throw new Error(`Not a git repository: ${cwd}`)
  const baseSlug = slugify(name)
  await ensureWorktreeDirExcluded(repoRoot)

  // Suffix on collision rather than failing — task names repeat.
  let slug = baseSlug
  for (let attempt = 2; ; attempt += 1) {
    const worktreePath = path.join(repoRoot, WORKTREE_TASKS_DIR, slug)
    const branch = `${WORKTREE_BRANCH_PREFIX}${slug}`
    try {
      await fs.access(worktreePath)
      slug = `${baseSlug}-${attempt}`
      continue
    } catch {
      // path free — try to create
    }
    try {
      await git(repoRoot, ['worktree', 'add', worktreePath, '-b', branch])
    } catch (err) {
      // Branch may exist from an earlier discarded task; retry with a suffix.
      if (err instanceof Error && /already exists/i.test(err.message) && attempt < 20) {
        slug = `${baseSlug}-${attempt}`
        continue
      }
      throw err
    }
    return { path: worktreePath, branch, repoRoot, slug, dirtyFiles: 0, aheadCommits: 0 }
  }
}

/** All live agent worktree tasks for the repo containing `cwd`. */
export async function listWorktreeTasks(cwd: string): Promise<WorktreeTask[]> {
  const repoRoot = await findRepoRoot(cwd)
  if (!repoRoot) return []
  const home = path.join(repoRoot, WORKTREE_TASKS_DIR)
  let porcelain: string
  try {
    porcelain = await git(repoRoot, ['worktree', 'list', '--porcelain'])
  } catch {
    return []
  }
  const tasks: WorktreeTask[] = []
  let currentPath: string | null = null
  for (const line of porcelain.split('\n')) {
    if (line.startsWith('worktree ')) {
      currentPath = line.slice('worktree '.length)
      continue
    }
    if (line.startsWith('branch refs/heads/') && currentPath) {
      const branch = line.slice('branch refs/heads/'.length)
      const normalized = path.resolve(currentPath)
      if (branch.startsWith(WORKTREE_BRANCH_PREFIX) && normalized.startsWith(home + path.sep)) {
        tasks.push({
          path: normalized,
          branch,
          repoRoot,
          slug: branch.slice(WORKTREE_BRANCH_PREFIX.length),
          dirtyFiles: -1,
          aheadCommits: -1,
        })
      }
      currentPath = null
    }
  }
  return Promise.all(tasks.map(async (task) => {
    const [dirty, ahead] = await Promise.all([
      git(task.path, ['status', '--porcelain']).then((out) => (out ? out.split('\n').length : 0)).catch(() => -1),
      git(task.repoRoot, ['rev-list', '--count', `HEAD..${task.branch}`]).then((out) => Number(out) || 0).catch(() => -1),
    ])
    return { ...task, dirtyFiles: dirty, aheadCommits: ahead }
  }))
}

/** The task whose worktree contains `cwd`, if any. */
export async function findWorktreeTaskForCwd(cwd: string): Promise<WorktreeTask | null> {
  // realpath both sides: session cwds can arrive through symlinks (macOS /tmp)
  // while git reports resolved paths.
  const normalized = await fs.realpath(path.resolve(cwd)).catch(() => path.resolve(cwd))
  if (!normalized.includes(`${path.sep}${WORKTREE_TASKS_DIR}${path.sep}`)) return null
  const tasks = await listWorktreeTasks(normalized)
  return tasks.find((task) => normalized === task.path || normalized.startsWith(task.path + path.sep)) ?? null
}

/**
 * Adopt a task's changes into the main checkout: commit anything uncommitted
 * onto the task branch, then squash-merge the branch into the main worktree —
 * changes land STAGED, ready for the user to review and commit. Throws with
 * git's conflict/abort message when the merge can't apply cleanly.
 */
export async function mergeWorktreeTask(task: WorktreeTask): Promise<{ staged: boolean }> {
  const dirty = await git(task.path, ['status', '--porcelain'])
  if (dirty) {
    await git(task.path, ['add', '-A'])
    await git(task.path, ['commit', '-m', `agent worktree task: ${task.slug}`])
  }
  const ahead = Number(await git(task.repoRoot, ['rev-list', '--count', `HEAD..${task.branch}`]).catch(() => '0')) || 0
  if (ahead === 0) return { staged: false }
  await git(task.repoRoot, ['merge', '--squash', task.branch])
  return { staged: true }
}

/**
 * Remove a task's worktree and its branch. `force` discards uncommitted
 * changes; without it, a dirty worktree makes git refuse and we surface that.
 */
export async function removeWorktreeTask(task: WorktreeTask, opts?: { force?: boolean }): Promise<void> {
  const args = ['worktree', 'remove']
  if (opts?.force) args.push('--force')
  args.push(task.path)
  await git(task.repoRoot, args)
  await git(task.repoRoot, ['branch', '-D', task.branch]).catch(() => {
    // branch already gone or checked out elsewhere — not worth failing removal
  })
}
