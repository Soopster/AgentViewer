// What the git panel is showing a diff *of*.
//
// The panel used to answer exactly one question — "what is uncommitted right
// now" — which is the wrong question after an agent has run several turns on a
// branch: the interesting change set is usually "everything this branch added"
// or "what the last turn did", and neither is `git status`. A source picks the
// two trees being compared; everything downstream (the file list, the per-file
// patch, the whole-tree diff) is derived from that one choice.
//
// Turn sources are the checkpoint refs written before each agent turn
// (lib/checkpoints.ts). They must be compared tree-to-tree rather than with
// `git diff <sha>`, because plain diff ignores untracked files entirely — a
// file the agent created would vanish from its own turn's diff. That is why the
// turn branch delegates to checkpoints.ts instead of going through runGit.

import { changesSinceCheckpoint, diffSinceCheckpoint, listTurnCheckpoints } from './checkpoints'
import type { GitCommandRunner, GitDiffSource, GitStatusEntry, GitTurnRef } from './gitProvider'

/** Turns available as diff sources, newest first.
 *
 *  Checkpoints are repo-scoped, so a repo worked by several sessions accrues
 *  one interleaved list where consecutive entries belong to different
 *  conversations — "Turn 57" then means nothing to someone reading one session.
 *  With a `sessionId` the list is that session's turns alone, which is also
 *  what makes the numbering meaningful: turn 1 is where this session started.
 *  Checkpoints written before sessions were recorded carry no id and are
 *  excluded rather than guessed at. */
export async function listGitTurns(cwd: string, sessionId?: string | null): Promise<GitTurnRef[]> {
  const all = await listTurnCheckpoints(cwd).catch(() => [])
  const checkpoints = sessionId ? all.filter((checkpoint) => checkpoint.sessionId === sessionId) : all
  return checkpoints.map((checkpoint) => ({
    sha: checkpoint.sha,
    label: checkpoint.label,
    createdAt: checkpoint.createdAt,
    sessionId: checkpoint.sessionId,
  }))
}

/** Where one turn's changes end: at the *next* turn's checkpoint, or — for the
 *  newest turn — at the working tree right now. Compared straight against the
 *  working tree instead, every turn would include everything that happened
 *  after it, so "Turn 1" in a five-turn session would be indistinguishable from
 *  the whole session. Returns null when the turn is the newest one, or when its
 *  checkpoint is no longer in the list (pruned), where the working tree is
 *  still the only meaningful other side. */
async function resolveTurnSuccessor(cwd: string, sha: string): Promise<string | null> {
  // Deliberately the unfiltered list: the tree a turn's work ended at is the
  // next checkpoint taken in this repo, whichever session took it. Scoping this
  // to one session would attribute another session's interleaved edits to the
  // turn being viewed.
  const checkpoints = await listTurnCheckpoints(cwd).catch(() => [])
  const index = checkpoints.findIndex((checkpoint) => checkpoint.sha === sha)
  if (index <= 0) return null
  return checkpoints[index - 1].sha
}

/** The turns to offer in the picker, and whether they are this session's.
 *
 *  A session with no checkpoints of its own is common and is not an error: the
 *  repo may have been worked before turn snapshots recorded a session id, or by
 *  another session entirely. Falling back to every turn in the repo keeps the
 *  menu usable; `scoped` lets the UI say which list it is showing, so the
 *  numbering is never read as this session's when it isn't. */
export async function listGitTurnsForMenu(
  cwd: string,
  sessionId?: string | null,
): Promise<{ turns: GitTurnRef[]; scoped: boolean }> {
  const scoped = await listGitTurns(cwd, sessionId)
  if (!sessionId || scoped.length > 0) return { turns: scoped, scoped: !!sessionId }
  return { turns: await listGitTurns(cwd, null), scoped: false }
}

/** The commit a branch's changes are measured from: its fork point. */
async function resolveBranchBase(cwd: string, runGit: GitCommandRunner): Promise<string | null> {
  const upstreamRaw = await runGit(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
  const upstream = upstreamRaw && !upstreamRaw.startsWith('fatal') ? upstreamRaw : null
  const originHeadRaw = await runGit(cwd, ['rev-parse', '--abbrev-ref', 'origin/HEAD'])
  const originHead = originHeadRaw && !originHeadRaw.startsWith('fatal') ? originHeadRaw : null
  for (const candidate of [upstream, originHead, 'origin/main', 'origin/master', 'main', 'master']) {
    if (!candidate) continue
    const base = await runGit(cwd, ['merge-base', 'HEAD', candidate])
    if (base && !base.startsWith('fatal')) return base
  }
  return null
}

/** `A\tpath` lines → status entries, in the unstaged column so the tree and the
 *  status pill read them as plain changes rather than as staged work. */
function parseNameStatus(raw: string): GitStatusEntry[] {
  if (!raw) return []
  return raw.split('\n').flatMap((line): GitStatusEntry[] => {
    const [status, ...rest] = line.split('\t')
    const filePath = rest.join('\t')
    if (!status || !filePath) return []
    const code = status[0]
    if (code !== 'A' && code !== 'M' && code !== 'D') return []
    return [{ x: ' ', y: code, path: filePath }]
  })
}

function sortEntries(entries: GitStatusEntry[]): GitStatusEntry[] {
  return entries.sort((left, right) => left.path.localeCompare(right.path))
}

/** The files a source considers changed. */
export async function fetchSourceStatus(
  cwd: string,
  runGit: GitCommandRunner,
  source: GitDiffSource,
): Promise<GitStatusEntry[]> {
  if (source.kind === 'turn') {
    const successor = await resolveTurnSuccessor(cwd, source.sha)
    if (successor) {
      // Both sides are checkpoint commits, so `git diff` sees the whole tree —
      // the untracked-file blind spot that forces the working-tree comparison
      // through checkpoints.ts does not apply here.
      return sortEntries(parseNameStatus(
        await runGit(cwd, ['diff', '--no-renames', '--name-status', source.sha, successor]),
      ))
    }
    const changes = await changesSinceCheckpoint(cwd, source.sha).catch(() => [])
    return sortEntries(changes.map((change) => ({ x: ' ', y: change.status, path: change.path })))
  }
  const base = await resolveBranchBase(cwd, runGit)
  if (!base) return []
  const [tracked, untrackedRaw] = await Promise.all([
    runGit(cwd, ['diff', '--no-renames', '--name-status', base]),
    runGit(cwd, ['ls-files', '--others', '--exclude-standard']),
  ])
  const seen = new Set<string>()
  const entries = parseNameStatus(tracked)
  for (const entry of entries) seen.add(entry.path)
  for (const path of untrackedRaw ? untrackedRaw.split('\n').filter(Boolean) : []) {
    if (!seen.has(path)) entries.push({ x: '?', y: '?', path })
  }
  return sortEntries(entries)
}

/** A source's diff — the whole change set, or one file of it. */
export async function fetchSourceDiff(
  cwd: string,
  runGit: GitCommandRunner,
  source: GitDiffSource,
  filePath?: string | null,
): Promise<string> {
  if (source.kind === 'turn') {
    const successor = await resolveTurnSuccessor(cwd, source.sha)
    if (successor) {
      const args = ['diff', '--no-renames', source.sha, successor]
      if (filePath) args.push('--', filePath)
      return await runGit(cwd, args)
    }
    return await diffSinceCheckpoint(cwd, source.sha, filePath ?? undefined).catch(() => '')
  }
  const base = await resolveBranchBase(cwd, runGit)
  if (!base) return ''
  const args = ['diff', '--no-renames', base]
  if (filePath) args.push('--', filePath)
  const patch = await runGit(cwd, args)
  if (patch || !filePath) return patch
  // An untracked file has no base blob to diff against; show it as an addition.
  return await runGit(cwd, ['diff', '--no-index', '/dev/null', filePath]) || ''
}
