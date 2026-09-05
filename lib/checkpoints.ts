// Turn checkpoints: before every agent turn, snapshot the session's working
// tree as a hidden git commit (temp index → write-tree → commit-tree → a ref
// under refs/agent-viewer-checkpoints/). Nothing touches the user's index,
// worktree, or HEAD, and the snapshot happens BEFORE the agent runs — the only
// race-free point to capture "what the files looked like before this turn".
// Restore and per-hunk review helpers complete the trust loop: see exactly
// what changed since any turn, put any file back, trim hunks, commit, PR.
//
// Node APIs only; consumed by sessionBackend (turn-start hook) and the TUI
// service layer. Never import from client components.

import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { findRepoRoot } from './worktreeTasks'

export const CHECKPOINT_REF_PREFIX = 'refs/agent-viewer-checkpoints/'
const CHECKPOINT_CAP_PER_REPO = 60
// Turn starts must not stall on a slow snapshot (giant repos): skip instead.
const CHECKPOINT_TIMEOUT_MS = 4000

export type TurnCheckpoint = {
  ref: string
  sha: string
  createdAt: number
  /** First line of the user message that started the turn. */
  label: string
  sessionId?: string
  provider?: string
}

export type CheckpointFileChange = {
  /** A = added since the checkpoint, M = modified, D = deleted since. */
  status: 'A' | 'M' | 'D'
  path: string
}

export type WorkingDiffHunk = {
  file: string
  /** The @@ header line, for display. */
  header: string
  /** Hunk body lines (including the @@ line). */
  lines: string[]
  /** Standalone patch (file headers + this hunk) that `git apply -R` accepts. */
  patchText: string
}

function gitEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    // Snapshots must work even without user git config (author never shows in
    // the user's history — these commits live only behind our refs).
    GIT_AUTHOR_NAME: 'agent-viewer',
    GIT_AUTHOR_EMAIL: 'agent-viewer@localhost',
    GIT_COMMITTER_NAME: 'agent-viewer',
    GIT_COMMITTER_EMAIL: 'agent-viewer@localhost',
    ...extra,
  }
}

function git(cwd: string, args: string[], opts?: { env?: Record<string, string>; input?: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      args,
      { cwd, encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024, env: gitEnv(opts?.env) },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`git ${args.join(' ')} failed${stderr ? `: ${String(stderr).trim()}` : ''}`))
          return
        }
        resolve(String(stdout ?? '').trimEnd())
      },
    )
    if (opts?.input !== undefined && child.stdin) {
      child.stdin.write(opts.input)
      child.stdin.end()
    }
  })
}

function sanitizeLabel(message: string): string {
  const firstLine = message.split('\n').find((line) => line.trim().length > 0) ?? ''
  return firstLine.trim().slice(0, 120) || 'agent turn'
}

/**
 * Snapshot the working tree (tracked + untracked, .gitignore respected) as a
 * hidden commit and record it under a repo-scoped checkpoint ref. Best-effort
 * with a hard time cap — returns null instead of delaying the turn.
 */
export async function createTurnCheckpoint(
  cwd: string,
  meta: { sessionId?: string; provider?: string; message?: string },
): Promise<TurnCheckpoint | null> {
  const work = (async (): Promise<TurnCheckpoint | null> => {
    const repoRoot = await findRepoRoot(cwd)
    if (!repoRoot) return null
    const indexFile = path.join(
      await fs.mkdtemp(path.join(tmpdir(), 'agent-viewer-ckpt-')),
      'index',
    )
    try {
      const env = { GIT_INDEX_FILE: indexFile }
      await git(cwd, ['add', '-A'], { env })
      const tree = await git(cwd, ['write-tree'], { env })
      const head = await git(cwd, ['rev-parse', '--verify', 'HEAD']).catch(() => null)
      const label = sanitizeLabel(meta.message ?? '')
      const body = JSON.stringify({ sessionId: meta.sessionId, provider: meta.provider })
      const commitArgs = ['commit-tree', tree, '-m', `${label}\n\n${body}`]
      if (head) commitArgs.push('-p', head)
      const sha = await git(cwd, commitArgs)
      const createdAt = Date.now()
      const ref = `${CHECKPOINT_REF_PREFIX}${createdAt}-${sha.slice(0, 8)}`
      await git(cwd, ['update-ref', ref, sha])
      void pruneCheckpoints(cwd).catch(() => {})
      return { ref, sha, createdAt, label, sessionId: meta.sessionId, provider: meta.provider }
    } finally {
      await fs.rm(path.dirname(indexFile), { recursive: true, force: true }).catch(() => {})
    }
  })()

  const timeout = new Promise<null>((resolve) => {
    const timer = setTimeout(() => resolve(null), CHECKPOINT_TIMEOUT_MS)
    if (typeof timer === 'object' && timer && 'unref' in timer) (timer as { unref: () => void }).unref()
  })
  return Promise.race([work.catch(() => null), timeout])
}

/**
 * Re-stamp a checkpoint with the session id the turn actually ran under.
 *
 * A turn is addressed to the session the user clicked, but Claude's cold
 * resume realizes its own id and the viewer follows *that* one — so a
 * checkpoint stamped at submission time can name a session that no longer
 * matches anything on screen, and a per-session turn list comes back empty.
 * The snapshot itself is already correct; only its metadata is stale, so this
 * rebuilds the commit around the same tree and parent and moves the ref. The
 * ref name is left alone: it carries the creation time the list sorts on.
 */
export async function retagCheckpointSession(
  cwd: string,
  checkpoint: TurnCheckpoint,
  sessionId: string,
): Promise<TurnCheckpoint> {
  if (!sessionId || sessionId === checkpoint.sessionId) return checkpoint
  const tree = await git(cwd, ['rev-parse', `${checkpoint.sha}^{tree}`])
  const parent = await git(cwd, ['rev-parse', '--verify', `${checkpoint.sha}^`]).catch(() => null)
  const body = JSON.stringify({ sessionId, provider: checkpoint.provider })
  const args = ['commit-tree', tree, '-m', `${checkpoint.label}\n\n${body}`]
  if (parent) args.push('-p', parent)
  const sha = await git(cwd, args)
  await git(cwd, ['update-ref', checkpoint.ref, sha, checkpoint.sha])
  return { ...checkpoint, sha, sessionId }
}

/** Repo-scoped checkpoint list, newest first. */
export async function listTurnCheckpoints(cwd: string): Promise<TurnCheckpoint[]> {
  const out = await git(cwd, [
    'for-each-ref',
    '--sort=-refname',
    '--format=%(refname)%00%(objectname)%00%(contents:subject)%00%(contents:body)',
    CHECKPOINT_REF_PREFIX,
  ]).catch(() => '')
  if (!out) return []
  // One record per line: ref/sha/subject/body separated by NUL (%00), so
  // subjects with spaces stay intact; body is single-line JSON metadata.
  return out.split('\n').flatMap((line): TurnCheckpoint[] => {
    const [ref, sha, subject, rawBody] = line.split('\u0000')
    if (!ref || !sha) return []
    const createdAt = Number(ref.slice(CHECKPOINT_REF_PREFIX.length).split('-')[0]) || 0
    let sessionId: string | undefined
    let provider: string | undefined
    try {
      const parsed = JSON.parse((rawBody ?? '').trim() || '{}') as { sessionId?: string; provider?: string }
      sessionId = parsed.sessionId
      provider = parsed.provider
    } catch {
      // pre-metadata checkpoints — label still renders
    }
    return [{ ref, sha, createdAt, label: subject ?? '', sessionId, provider }]
  })
}

async function pruneCheckpoints(cwd: string): Promise<void> {
  const checkpoints = await listTurnCheckpoints(cwd)
  for (const stale of checkpoints.slice(CHECKPOINT_CAP_PER_REPO)) {
    await git(cwd, ['update-ref', '-d', stale.ref]).catch(() => {})
  }
}

export async function deleteTurnCheckpoint(cwd: string, ref: string): Promise<void> {
  if (!ref.startsWith(CHECKPOINT_REF_PREFIX)) throw new Error(`Not a checkpoint ref: ${ref}`)
  await git(cwd, ['update-ref', '-d', ref])
}

/**
 * Snapshot the CURRENT worktree (tracked + untracked) as a tree object, the
 * same way checkpoints are captured. Plain `git diff <sha>` can't be used for
 * "since the checkpoint" queries: it ignores untracked files entirely (new
 * files vanish, pre-existing untracked ones read as phantom deletions), so we
 * always compare tree-to-tree.
 */
async function snapshotWorktreeTree(cwd: string): Promise<string> {
  const indexFile = path.join(await fs.mkdtemp(path.join(tmpdir(), 'agent-viewer-ckpt-')), 'index')
  try {
    const env = { GIT_INDEX_FILE: indexFile }
    await git(cwd, ['add', '-A'], { env })
    return await git(cwd, ['write-tree'], { env })
  } finally {
    await fs.rm(path.dirname(indexFile), { recursive: true, force: true }).catch(() => {})
  }
}

/** What changed between a checkpoint and the working tree right now. */
export async function changesSinceCheckpoint(cwd: string, sha: string): Promise<CheckpointFileChange[]> {
  const nowTree = await snapshotWorktreeTree(cwd)
  const out = await git(cwd, ['diff-tree', '-r', '--no-renames', '--name-status', sha, nowTree])
  if (!out) return []
  return out.split('\n').flatMap((line): CheckpointFileChange[] => {
    const [status, ...rest] = line.split('\t')
    const filePath = rest.join('\t')
    if (!filePath || !status) return []
    const normalized = status[0]
    if (normalized !== 'A' && normalized !== 'M' && normalized !== 'D') return []
    return [{ status: normalized, path: filePath }]
  })
}

/** Full diff text checkpoint → working tree (optionally one file). */
export async function diffSinceCheckpoint(cwd: string, sha: string, filePath?: string): Promise<string> {
  const nowTree = await snapshotWorktreeTree(cwd)
  const args = ['diff', '--no-renames', sha, nowTree]
  if (filePath) args.push('--', filePath)
  return git(cwd, args)
}

/**
 * Put files back the way they were at the checkpoint. Only the worktree is
 * touched (the index is left alone). Files created after the checkpoint are
 * deleted; modified/deleted files are restored from the snapshot. With no
 * `paths`, the whole change set since the checkpoint is reverted.
 */
export async function restoreCheckpoint(cwd: string, sha: string, paths?: string[]): Promise<{ restored: number; deleted: number }> {
  const changes = await changesSinceCheckpoint(cwd, sha)
  const wanted = paths && paths.length > 0 ? new Set(paths) : null
  const selected = wanted ? changes.filter((change) => wanted.has(change.path)) : changes
  const toRestore = selected.filter((change) => change.status !== 'A').map((change) => change.path)
  const toDelete = selected.filter((change) => change.status === 'A').map((change) => change.path)
  if (toRestore.length > 0) {
    await git(cwd, ['restore', '--source', sha, '--worktree', '--', ...toRestore])
  }
  const repoRoot = (await findRepoRoot(cwd)) ?? cwd
  for (const relPath of toDelete) {
    await fs.rm(path.join(repoRoot, relPath), { force: true }).catch(() => {})
  }
  return { restored: toRestore.length, deleted: toDelete.length }
}

// ---------------------------------------------------------------------------
// Review flow: working-diff hunks, per-hunk reject, commit, PR.

/**
 * Parse `git diff HEAD` into standalone hunks (each rejectable on its own),
 * plus the untracked files (whole-file additions, rejected by deletion).
 */
export async function listWorkingDiffHunks(cwd: string): Promise<{ hunks: WorkingDiffHunk[]; untracked: string[] }> {
  const [diffText, untrackedOut] = await Promise.all([
    git(cwd, ['diff', '--no-renames', '--no-color', 'HEAD']).catch(() => ''),
    git(cwd, ['ls-files', '--others', '--exclude-standard']).catch(() => ''),
  ])
  const untracked = untrackedOut ? untrackedOut.split('\n').filter(Boolean) : []
  const hunks: WorkingDiffHunk[] = []
  let fileHeader: string[] = []
  let file = ''
  let current: { header: string; lines: string[] } | null = null
  const flush = () => {
    if (!current || !file) return
    hunks.push({
      file,
      header: current.header,
      lines: current.lines,
      patchText: `${fileHeader.join('\n')}\n${current.lines.join('\n')}\n`,
    })
    current = null
  }
  for (const line of diffText.split('\n')) {
    if (line.startsWith('diff --git ')) {
      flush()
      fileHeader = [line]
      file = ''
      continue
    }
    if (line.startsWith('@@')) {
      flush()
      current = { header: line, lines: [line] }
      continue
    }
    if (current) {
      current.lines.push(line)
      continue
    }
    fileHeader.push(line)
    if (line.startsWith('+++ b/')) file = line.slice('+++ b/'.length)
    else if (line.startsWith('--- a/') && !file) file = line.slice('--- a/'.length)
  }
  flush()
  return { hunks, untracked }
}

/** Reverse-apply one hunk's patch to the worktree (drop that change). */
export async function rejectWorkingHunk(cwd: string, patchText: string): Promise<void> {
  await git(cwd, ['apply', '-R', '--whitespace=nowarn', '-'], { input: patchText })
}

export async function deleteUntrackedFile(cwd: string, relPath: string): Promise<void> {
  const repoRoot = (await findRepoRoot(cwd)) ?? cwd
  const target = path.join(repoRoot, relPath)
  // Only ever delete inside the repo, and only files git reports as untracked.
  const untracked = await git(cwd, ['ls-files', '--others', '--exclude-standard', '--', relPath])
  if (!untracked.trim()) throw new Error(`${relPath} is not an untracked file`)
  await fs.rm(target, { force: true })
}

/** Stage everything and commit. Returns the new commit sha. */
export async function commitAllChanges(cwd: string, message: string): Promise<string> {
  const trimmed = message.trim()
  if (!trimmed) throw new Error('Commit message is required')
  await git(cwd, ['add', '-A'])
  await git(cwd, ['commit', '-m', trimmed])
  return git(cwd, ['rev-parse', 'HEAD'])
}

/**
 * Push the current branch and open a PR via `gh`. On main/master, a review
 * branch is created first so the PR has a head to point at.
 */
export async function createReviewPullRequest(cwd: string, title: string): Promise<string> {
  const branch = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (branch === 'main' || branch === 'master') {
    await git(cwd, ['checkout', '-b', `agent/review-${Date.now()}`])
  }
  await git(cwd, ['push', '-u', 'origin', 'HEAD'])
  return new Promise((resolve, reject) => {
    execFile(
      'gh',
      ['pr', 'create', '--title', title.trim() || 'Agent review', '--body', 'Reviewed in agent-viewer.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)'],
      { cwd, encoding: 'utf-8', maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(String(stderr ?? '').trim() || 'gh pr create failed'))
          return
        }
        resolve(String(stdout ?? '').trim())
      },
    )
  })
}
