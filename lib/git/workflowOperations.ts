import { createHash, randomUUID } from 'node:crypto'
import { lstat, readFile, realpath, rename, rm, writeFile, access } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { git, gitBytes } from './command'
import { readWorkspace, validateWorkspacePath } from './workspaceService'
import type { ConflictPreview, ConflictVersion, WorkflowAction, WorkspaceAction, WorkspaceBranch, WorkspaceRemoteBranch, WorkspaceResult, WorkspaceSnapshot } from './workspaceTypes'

export function isWorkflowAction(action: WorkspaceAction): action is WorkflowAction {
  return !['stage', 'unstage', 'patch', 'commit'].includes(action.kind)
}
export async function readWorkflowFacts(root: string) {
  const [refs, remotesRaw, rebaseMerge, rebaseApply, remoteConfig] = await Promise.all([
    git(root, ['for-each-ref', '--format=%(refname)%00%(objectname)%00%(upstream:short)%00%(worktreepath)%00%(symref)', 'refs/heads', 'refs/remotes']),
    git(root, ['remote']), git(root, ['rev-parse', '--git-path', 'rebase-merge']), git(root, ['rev-parse', '--git-path', 'rebase-apply']),
    git(root, ['config', '--null', '--get-regexp', '^remote\\..*\\.(url|pushurl|fetch)$']).catch(() => ''),
  ])
  const remotes = remotesRaw.trimEnd().split('\n').filter(Boolean)
  const branchRefs: WorkspaceBranch[] = [], remoteBranches: WorkspaceRemoteBranch[] = []
  for (const line of refs.trimEnd().split('\n').filter(Boolean)) {
    const [ref, sha, upstream, worktreePath, symbolic] = line.split('\0')
    if (symbolic) continue
    if (ref!.startsWith('refs/heads/')) branchRefs.push({ name: ref!.slice(11), sha: sha!, upstream: upstream || null, worktreePath: worktreePath || null })
    else {
      const name = ref!.slice(13), remote = [...remotes].sort((a, b) => b.length - a.length).find(remote => name.startsWith(remote + '/'))
      if (remote) remoteBranches.push({ name, sha: sha!, remote, branch: name.slice(remote.length + 1) })
    }
  }
  const rebasing = (await Promise.all([rebaseMerge, rebaseApply].map(path => access(resolve(root, path.trimEnd())).then(() => true, () => false)))).some(Boolean)
  return { remotes, branchRefs, remoteBranches, rebasing, remoteConfigHash: createHash('sha256').update(remoteConfig).digest('hex') }
}
export function workflowRevision(state: { revision: string; operation: string | null; stashes: unknown; branchRefs: unknown; remoteBranches: unknown; remotes: unknown; branch: string; remoteConfigHash?: string }) {
  return createHash('sha256').update(JSON.stringify(state)).digest('hex')
}
async function safeWorkingPath(root: string, path: string) {
  validateWorkspacePath(path)
  const target = resolve(root, path), canonicalRoot = await realpath(root)
  let ancestor = dirname(target), parent: string
  for (;;) {
    try { parent = await realpath(ancestor); break } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(ancestor) === ancestor) throw error
      ancestor = dirname(ancestor)
    }
  }
  const rel = relative(canonicalRoot, parent)
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new Error('File parent is outside this worktree.')
  return target
}
function textVersion(bytes: Buffer, sha: string, mode: string): ConflictVersion {
  const text = bytes.toString('utf8'), binary = bytes.length > 1024 * 1024 || bytes.includes(0) || !Buffer.from(text).equals(bytes) || mode === '120000' || mode === '160000'
  return { sha, mode, binary, content: binary ? null : text }
}
export async function readConflict(cwd: string, path: string): Promise<ConflictPreview> {
  validateWorkspacePath(path)
  const before = await readWorkspace(cwd), file = before.files.find(file => file.path === path && file.conflict)
  if (!file) throw new Error('This file is no longer conflicted. Refresh first.')
  const raw = await git(before.root, ['--literal-pathspecs', 'ls-files', '--unmerged', '-z', '--', path])
  const versions: Array<ConflictVersion | null> = [null, null, null, null]
  await Promise.all(raw.split('\0').filter(Boolean).map(async record => {
    const match = /^(\d+) ([0-9a-f]+) ([123])\t/.exec(record)
    if (!match) throw new Error('Invalid conflict index entry')
    if (match[1] === '160000') { versions[Number(match[3])] = { sha: match[2]!, mode: match[1], binary: true, content: null }; return }
    const size = Number((await git(before.root, ['cat-file', '-s', match[2]!])).trim())
    if (size > 1024 * 1024) { versions[Number(match[3])] = { sha: match[2]!, mode: match[1]!, binary: true, content: null }; return }
    const { stdout } = await gitBytes(before.root, ['cat-file', 'blob', match[2]!])
    versions[Number(match[3])] = textVersion(stdout, match[2]!, match[1]!)
  }))
  let working: string | null = null, editable = false
  const target = await safeWorkingPath(before.root, path)
  try {
    const stat = await lstat(target)
    if (stat.isFile() && stat.size <= 1024 * 1024) {
      const result = textVersion(await readFile(target), '', '')
      working = result.content; editable = !result.binary
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const after = await readWorkspace(cwd)
  if (after.workflowRevision !== before.workflowRevision) throw new Error('Conflict changed while loading. Refresh and try again.')
  return { path, revision: before.workflowRevision, base: versions[1]!, ours: versions[2]!, theirs: versions[3]!, working, editable }
}
async function validBranch(root: string, name: string) {
  if (typeof name !== 'string' || !name || name.startsWith('-') || name.includes('@{') || name === 'HEAD' || name.includes('\0')) throw new Error('Invalid branch name')
  await git(root, ['check-ref-format', '--branch', name])
}
function branchAt(state: WorkspaceSnapshot, name: string, sha?: string) {
  const branch = state.branchRefs.find(branch => branch.name === name)
  if (!branch || (sha && branch.sha !== sha)) throw new Error('Branch changed or no longer exists. Refresh first.')
  return branch
}
function remoteAt(state: WorkspaceSnapshot, remote: string) {
  if (!state.remotes.includes(remote) || remote.startsWith('-')) throw new Error('Choose a configured remote.')
}
function clean(state: WorkspaceSnapshot) { if (state.files.length) throw new Error('Commit or stash local changes before this operation.') }
function inactive(state: WorkspaceSnapshot) { if (state.operation || state.files.some(file => file.conflict)) throw new Error('Finish or abort the current operation first.') }
function stashAt(state: WorkspaceSnapshot, action: { sha: string; selector: string }) {
  const stash = state.stashes.find(stash => stash.sha === action.sha && stash.selector === action.selector)
  if (!stash) throw new Error('The stash list changed. Refresh and select the stash again.')
  return stash
}
const EDITOR_ENV = { GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true', GIT_MERGE_AUTOEDIT: 'no' }
export async function executeWorkflowAction(root: string, action: WorkflowAction, state: WorkspaceSnapshot): Promise<WorkspaceResult> {
  if (typeof action.revision !== 'string' || action.revision !== state.workflowRevision) throw new Error('Repository or references changed. Refresh and review the action again.')
  let output = ''
  const run = (args: string[]) => git(root, args, undefined, EDITOR_ENV, true)
  try {
    switch (action.kind) {
      case 'branch-create': {
        inactive(state); await validBranch(root, action.name)
        if (typeof action.switchTo !== 'boolean') throw new Error('Invalid branch action')
        if (state.branchRefs.some(branch => branch.name === action.name)) throw new Error('Branch already exists.')
        const startingRemote = state.remoteBranches.find(branch => branch.name === action.start || `refs/remotes/${branch.name}` === action.start)
        const start = action.start === state.head || state.commits.some(commit => commit.sha === action.start) ? action.start : startingRemote?.sha ?? state.branchRefs.find(branch => branch.name === action.start)?.sha
        if (!start) throw new Error('Choose an existing starting commit or branch.')
        const startRef = startingRemote ? `refs/remotes/${startingRemote.name}` : start
        output = await run(action.switchTo ? ['switch', ...(startingRemote ? ['--track'] : []), '-c', action.name, startRef] : ['branch', ...(startingRemote ? ['--track'] : []), '--', action.name, startRef]); break
      }
      case 'branch-switch': {
        inactive(state); const branch = branchAt(state, action.name, action.sha)
        if (branch.worktreePath && await realpath(branch.worktreePath) !== await realpath(root)) throw new Error(`Branch is already checked out in ${branch.worktreePath}`)
        output = await run(['switch', '--', action.name]); break
      }
      case 'branch-rename': {
        inactive(state); branchAt(state, action.name, action.sha); await validBranch(root, action.newName)
        output = await run(['branch', '-m', '--', action.name, action.newName]); break
      }
      case 'branch-delete': {
        inactive(state); const branch = branchAt(state, action.name, action.sha)
        if (action.name === state.branch || branch.worktreePath) throw new Error('A checked-out branch cannot be deleted.')
        output = await run(['branch', '-d', '--', action.name]); break
      }
      case 'branch-track': {
        branchAt(state, action.name)
        if (!state.remoteBranches.some(branch => branch.name === action.upstream)) throw new Error('Choose an existing remote branch.')
        output = await run(['branch', `--set-upstream-to=refs/remotes/${action.upstream}`, '--', action.name]); break
      }
      case 'branch-merge': {
        inactive(state); clean(state); branchAt(state, action.name, action.sha)
        output = await run(['merge', '--no-edit', '--no-autostash', '--', `refs/heads/${action.name}`]); break
      }
      case 'remote-add': {
        if (typeof action.name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(action.name) || typeof action.url !== 'string' || !action.url.trim() || action.url.includes('\0')) throw new Error('Enter a valid remote name and URL.')
        output = await run(['remote', 'add', '--', action.name, action.url]); break
      }
      case 'remote-remove': { remoteAt(state, action.name); output = await run(['remote', 'remove', action.name]); break }
      case 'fetch': { remoteAt(state, action.remote); output = await run(['fetch', '--prune', '--', action.remote]); break }
      case 'pull': {
        inactive(state); clean(state); remoteAt(state, action.remote); await validBranch(root, action.branch)
        if (!state.head || state.branch === '(detached HEAD)') throw new Error('Switch to a local branch before pulling.')
        if (!['ff-only', 'merge', 'rebase'].includes(action.strategy)) throw new Error('Choose a pull strategy.')
        output = await run(['pull', ...(action.strategy === 'rebase' ? ['--rebase'] : ['--no-rebase', action.strategy === 'ff-only' ? '--ff-only' : '--ff']), '--no-autostash', '--', action.remote, action.branch]); break
      }
      case 'push': {
        inactive(state); remoteAt(state, action.remote); await validBranch(root, action.branch)
        if (!state.head || state.branch === '(detached HEAD)') throw new Error('Switch to a local branch before pushing.')
        if (typeof action.setUpstream !== 'boolean') throw new Error('Invalid upstream option')
        const flags: string[] = []
        if (action.lease !== null) {
          const tracked = state.remoteBranches.find(branch => branch.remote === action.remote && branch.branch === action.branch)
          if (!tracked || action.lease !== tracked.sha) throw new Error('Fetch and review the remote tip before replacing remote history.')
          flags.push(`--force-with-lease=refs/heads/${action.branch}:${action.lease}`)
        }
        output = await run(['push', '--porcelain', ...(action.setUpstream ? ['--set-upstream'] : []), ...flags, '--', action.remote, `HEAD:refs/heads/${action.branch}`]); break
      }
      case 'stash-create': {
        inactive(state)
        if (!state.head) throw new Error('Create the first commit before stashing.')
        if (!['all', 'staged', 'keep-index', 'selected'].includes(action.mode) || typeof action.includeUntracked !== 'boolean' || typeof action.message !== 'string' || action.message.length > 65536 || action.message.includes('\0')) throw new Error('Invalid stash options')
        if (action.mode === 'staged' && action.includeUntracked) throw new Error('Staged-only stashes cannot include untracked files.')
        const paths = action.mode === 'selected' ? action.paths : []
        if (!Array.isArray(paths) || (action.mode === 'selected' && paths.length === 0)) throw new Error('Select files to stash.')
        paths.forEach(validateWorkspacePath)
        for (const path of paths) if (!state.files.some(file => file.path === path || file.previousPath === path)) throw new Error('Selected file is no longer changed.')
        const selectedPaths = [...new Set(paths.flatMap(path => { const file = state.files.find(file => file.path === path); return file?.previousPath ? [path, file.previousPath] : [path] }))]
        output = await run(['stash', 'push', ...(action.mode === 'staged' ? ['--staged'] : action.mode === 'keep-index' ? ['--keep-index'] : []), ...(action.includeUntracked ? ['--include-untracked'] : []), '--message', action.message || 'Agent Viewer stash', '--', ...selectedPaths.map(path => `:(literal)${path}`)]); break
      }
      case 'stash-apply': case 'stash-pop': case 'stash-drop': {
        inactive(state); const stash = stashAt(state, action)
        if (typeof action.restoreIndex !== 'boolean') throw new Error('Invalid stash restore option')
        if (action.kind !== 'stash-drop') {
          clean(state)
          // Apply the object identity first. A failed application retains the
          // stash and exposes its conflicts through the refreshed snapshot.
          output = await run(['stash', 'apply', ...(action.restoreIndex ? ['--index'] : []), stash.sha])
        }
        if (action.kind !== 'stash-apply') {
          const current = await readWorkspace(root)
          stashAt(current, action)
          output += await run(['stash', 'drop', stash.selector])
        }
        break
      }
      case 'resolve': case 'conflict-save': {
        const file = state.files.find(file => file.path === action.path && file.conflict)
        if (!file) throw new Error('Select an unresolved conflict.')
        validateWorkspacePath(action.path)
        if (action.kind === 'conflict-save') {
          if (typeof action.content !== 'string' || Buffer.byteLength(action.content) > 1024 * 1024 || action.content.includes('\0')) throw new Error('Resolution must be a text file under 1 MB.')
          if (/^<{7,} /m.test(action.content) || /^={7,}\r?$/m.test(action.content) || /^>{7,} /m.test(action.content)) throw new Error('Resolve all conflict markers before saving.')
          const conflict = await readConflict(root, action.path)
          if (!conflict.editable || conflict.revision !== action.revision) throw new Error('Conflict is not editable or changed. Refresh it first.')
          const target = await safeWorkingPath(root, action.path), stat = await lstat(target), temporary = `${target}.agent-viewer-${randomUUID()}`
          try { await writeFile(temporary, action.content, { mode: stat.mode & 0o777 }); await rename(temporary, target) } finally { await rm(temporary, { force: true }) }
        } else if (action.choice === 'ours' || action.choice === 'theirs') {
          const conflict = await readConflict(root, action.path), version = conflict[action.choice]
          if (conflict.revision !== action.revision) throw new Error('Conflict changed. Refresh before resolving it.')
          if (version?.mode === '160000') throw new Error('Resolve submodule conflicts in the submodule before marking resolved.')
          if (!version) { output = await run(['--literal-pathspecs', 'rm', '--', action.path]); break }
          output = await run(['--literal-pathspecs', 'checkout', `--${action.choice}`, '--', action.path])
        } else if (action.choice === 'working') {
          const conflict = await readConflict(root, action.path)
          if (conflict.revision !== action.revision) throw new Error('Conflict changed. Refresh before resolving it.')
          if (conflict.working && (/^<{7,} /m.test(conflict.working) || /^={7,}\r?$/m.test(conflict.working) || /^>{7,} /m.test(conflict.working))) throw new Error('Resolve conflict markers before marking this file resolved.')
        } else throw new Error('Invalid conflict resolution')
        output += await run(['--literal-pathspecs', 'add', '-A', '--', action.path]); break
      }
      case 'operation': {
        if (!state.operation || action.operation !== state.operation || !['continue', 'abort', 'skip'].includes(action.action)) throw new Error('The active Git operation changed. Refresh first.')
        if (!['merge', 'rebase', 'cherry-pick', 'revert'].includes(state.operation)) throw new Error('This operation must be completed in a terminal.')
        if (action.action === 'skip' && state.operation === 'merge') throw new Error('Merge does not support skipping.')
        if (action.action === 'continue' && state.files.some(file => file.conflict)) throw new Error('Resolve and stage all conflicts before continuing.')
        output = await run([state.operation, `--${action.action}`]); break
      }
      default: throw new Error('Unsupported Git action')
    }
    return { output: output.trim() || 'Git operation completed.', snapshot: await readWorkspace(root) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { output: output.trim(), error: message, snapshot: await readWorkspace(root) }
  }
}
