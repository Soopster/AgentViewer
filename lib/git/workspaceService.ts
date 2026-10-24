import { git } from './command'
import { withWorkspaceOperationLock } from './operationLock'
import { executeWorkflowAction, isWorkflowAction, readConflict, readWorkflowFacts, workflowRevision } from './workflowOperations'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { copyFile, lstat, open, readFile, readlink, rename, rm } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { fetchGitOperation } from '../gitWorkspaceStatus'
import { createCommitHookGuards } from './commitHooks'
import { partialPatch } from './partialPatch'
import type { IndexSide, WorkspaceAction, WorkspaceFile, WorkspacePreview, WorkspaceResult, WorkspaceSnapshot, WorkspaceTransport } from './workspaceTypes'

const hash = (text: string | Buffer) => createHash('sha256').update(text).digest('hex')
const diffArgs = (side: IndexSide) => ['diff', '--no-ext-diff', '--no-textconv', '--binary', '--no-renames', ...(side === 'staged' ? ['--cached'] : [])]
function parseStatus(raw: string): WorkspaceFile[] {
  const records = raw.split('\0'), files: WorkspaceFile[] = []
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!
    if (!record) continue
    const x = record[0]!, y = record[1]!, path = record.slice(3)
    const previousPath = x === 'R' || y === 'R' || x === 'C' || y === 'C' ? records[++i] : undefined
    files.push({ path, previousPath, x, y, conflict: x === 'U' || y === 'U' || x + y === 'AA' || x + y === 'DD' })
  }
  return files
}
async function rootFor(cwd: string) { return (await git(cwd, ['rev-parse', '--show-toplevel'])).trimEnd() }
async function currentHead(root: string): Promise<string | null> {
  try { return (await git(root, ['rev-parse', '--verify', 'HEAD'])).trim() } catch { return null }
}
async function indexRevision(root: string) { return hash(await git(root, ['ls-files', '--stage', '-z'])) }
async function facts(root: string) {
  const [raw, staged, unstaged, index, head] = await Promise.all([
    git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']), git(root, diffArgs('staged')),
    git(root, diffArgs('unstaged')), indexRevision(root), currentHead(root),
  ])
  const files = parseStatus(raw)
  const digest = createHash('sha256').update(raw).update(staged).update(unstaged).update(index).update(head ?? '')
  for (const file of files.filter(file => file.x === '?')) {
    const path = resolve(root, file.path)
    const stat = await lstat(path)
    digest.update(file.path).update(String(stat.mode))
    if (stat.isDirectory()) digest.update(String(stat.mtimeMs))
    else digest.update(stat.isSymbolicLink() ? await readlink(path) : await readFile(path))
  }
  return { files, head, indexRevision: index, revision: digest.digest('hex') }
}
export async function readWorkspace(cwd: string): Promise<WorkspaceSnapshot> {
  const root = await rootFor(cwd)
  const [state, branch, branches, commits, stashesRaw, operation, status, lastMessage, workflow] = await Promise.all([
    facts(root), git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => Promise.resolve('(detached HEAD)')),
    git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']),
    git(root, ['log', '-80', '--format=%H%x00%s']).catch(() => Promise.resolve('')),
    git(root, ['stash', 'list', '--format=%H%x00%gd%x00%s']), fetchGitOperation(root, (cwd, args) => git(cwd, args).catch(() => '')),
    git(root, ['status', '--porcelain=v2', '--branch', '--untracked-files=no']),
    git(root, ['log', '-1', '--format=%B']).catch(() => Promise.resolve('')), readWorkflowFacts(root),
  ])
  const ab = /^# branch.ab \+(\d+) -(\d+)$/m.exec(status)
  const stashes = stashesRaw.trimEnd().split('\n').filter(Boolean).map(line => { const [sha, selector, label] = line.split('\0'); return { sha: sha!, selector: selector!, label: `${selector}: ${label ?? ''}` } })
  const currentOperation = workflow.rebasing ? 'rebase' : operation === 'rebase' ? null : operation
  const token = workflowRevision({ revision: state.revision, branch: branch.trimEnd(), operation: currentOperation, stashes, branchRefs: workflow.branchRefs, remoteBranches: workflow.remoteBranches, remotes: workflow.remotes, remoteConfigHash: workflow.remoteConfigHash })
  return { ...state, remotes: workflow.remotes, branchRefs: workflow.branchRefs, remoteBranches: workflow.remoteBranches, workflowRevision: token, root, branch: branch.trimEnd(), branches: branches.trimEnd().split('\n').filter(Boolean),
    commits: commits.trimEnd().split('\n').filter(Boolean).map(line => { const [sha, subject] = line.split('\0'); return { sha: sha!, subject: subject ?? '' } }),
    stashes,
    operation: currentOperation, upstream: /^# branch.upstream (.*)$/m.exec(status)?.[1] ?? null,
    ahead: Number(ab?.[1] ?? 0), behind: Number(ab?.[2] ?? 0), lastMessage: lastMessage.trimEnd() }
}
export function validateWorkspacePath(path: string) {
  if (typeof path !== 'string' || !path || path.includes('\0') || isAbsolute(path) || path.split(/[\\/]/).some(part => part === '..' || part.toLowerCase() === '.git')) throw new Error('Invalid repository path')
}
export async function previewWorkspace(cwd: string, side: IndexSide, path: string | null): Promise<WorkspacePreview> {
  if (side !== 'staged' && side !== 'unstaged') throw new Error('Invalid index side')
  if (path !== null) validateWorkspacePath(path)
  const root = await rootFor(cwd), before = await facts(root)
  let patch: string
  if (path && before.files.some(file => file.path === path && file.x === '?')) {
    // --no-index exits 1 for differences. The preview is read only; create a
    // text patch from the file using git diff's own quoting and binary handling.
    patch = await new Promise<string>((accept, reject) => {
      const child = spawn('git', ['diff', '--no-ext-diff', '--no-textconv', '--no-index', '--', process.platform === 'win32' ? 'NUL' : '/dev/null', path], { cwd: root })
      let out = '', err = ''
      child.stdout.on('data', data => { out += String(data); if (out.length > 32 * 1024 * 1024) child.kill() })
      child.stderr.on('data', data => { err += String(data) })
      child.on('error', reject)
      child.on('close', code => code === 0 || code === 1 ? accept(out) : reject(new Error(err || 'Unable to preview file')))
    })
  } else patch = await git(root, [...diffArgs(side), '--', ...(path ? [path] : [])])
  const after = await facts(root)
  if (after.revision !== before.revision) throw new Error('Repository changed while loading the preview. Refresh and try again.')
  return { patch, revision: before.revision, side, path }
}
const queues = new Map<string, Promise<unknown>>()
const requests = new Map<string, { signature: string; result: Promise<WorkspaceResult> }>()
export async function actWorkspace(cwd: string, requestId: string, action: WorkspaceAction): Promise<WorkspaceResult> {
  if (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{8,100}$/.test(requestId)) throw new Error('Invalid operation identity')
  const root = await rootFor(cwd)
  const common = resolve(root, (await git(root, ['rev-parse', '--git-common-dir'])).trimEnd())
  const key = `${root}\0${requestId}`, signature = JSON.stringify(action), existing = requests.get(key)
  if (existing) { if (existing.signature !== signature) throw new Error('Operation identity already used'); return existing.result }
  const result = (queues.get(common) ?? Promise.resolve()).catch(() => {}).then(() => withWorkspaceOperationLock(common, () => mutate(root, action)))
  requests.set(key, { signature, result }); queues.set(common, result)
  void result.finally(() => { if (queues.get(common) === result) queues.delete(common) }).catch(() => {})
  if (requests.size > 256) requests.delete(requests.keys().next().value!)
  return result
}
async function withIndexTransaction(root: string, revision: string, execute: (env: Record<string, string>) => Promise<string>): Promise<WorkspaceResult> {
  const indexPath = resolve(root, (await git(root, ['rev-parse', '--git-path', 'index'])).trimEnd())
  const lockPath = `${indexPath}.lock`, temporary = `${indexPath}.agent-viewer-${randomUUID()}`
  const lock = await open(lockPath, 'wx').catch(() => { throw new Error('Git index is locked by another operation. Wait and refresh.') })
  let ownsLock = true
  try {
    if ((await facts(root)).revision !== revision) throw new Error('Repository changed. Refresh and select the changes again.')
    await copyFile(indexPath, temporary).catch(error => { if (error.code !== 'ENOENT') throw error })
    const output = await execute({ GIT_INDEX_FILE: temporary })
    if ((await facts(root)).revision !== revision) throw new Error('Repository changed during staging. Refresh and select again.')
    await copyFile(temporary, lockPath)
    await lock.close()
    await rename(lockPath, indexPath)
    ownsLock = false
    return { output, snapshot: await readWorkspace(root) }
  } finally {
    await lock.close().catch(() => {})
    if (ownsLock) await rm(lockPath, { force: true })
    await rm(temporary, { force: true })
    await rm(`${temporary}.lock`, { force: true })
  }
}
async function mutate(root: string, action: WorkspaceAction): Promise<WorkspaceResult> {
  if (!action || typeof action.kind !== 'string') throw new Error('Unsupported Git action')
  const state = await readWorkspace(root)
  if (isWorkflowAction(action)) return executeWorkflowAction(root, action, state)
  let output = ''
  if (action.kind === 'commit') {
    if (typeof action.message !== 'string' || !action.message.trim() || action.message.length > 65536 || action.message.includes('\0')) throw new Error('Enter a commit message')
    if (typeof action.amend !== 'boolean') throw new Error('Invalid amend option')
    if (state.operation || state.files.some(file => file.conflict)) throw new Error('Finish the current Git operation before committing here.')
    if (state.head !== action.head || state.indexRevision !== action.indexRevision) throw new Error('HEAD or staged content changed. Review the staged preview again.')
    if (!state.files.some(file => file.x !== ' ' && file.x !== '?') && !action.amend) throw new Error('Stage changes before committing.')
    if (action.amend && !state.head) throw new Error('There is no commit to amend.')
    const indexPath = resolve(root, (await git(root, ['rev-parse', '--git-path', 'index'])).trimEnd())
    const lockPath = `${indexPath}.lock`, temporary = `${indexPath}.agent-viewer-${randomUUID()}`
    const hooksDirectory = `${temporary}.hooks`
    const originalHooks = resolve(root, (await git(root, ['rev-parse', '--git-path', 'hooks'])).trimEnd())
    const lock = await open(lockPath, 'wx').catch(() => { throw new Error('Git index is locked by another operation. Wait and refresh.') })
    let ownsLock = true
    try {
      if (await indexRevision(root) !== action.indexRevision || await currentHead(root) !== action.head) throw new Error('Staged content changed. Review it again.')
      await copyFile(indexPath, temporary)
      // The real index lock excludes external staging while commit and hooks use
      // a private index. Publish the resulting index only after commit succeeds.
      await createCommitHookGuards(hooksDirectory, originalHooks, action.indexRevision)
      output = await git(root, ['-c', `core.hooksPath=${hooksDirectory}`, 'commit', ...(action.amend ? ['--amend'] : []), '--file=-'], action.message, { GIT_INDEX_FILE: temporary })
      await copyFile(temporary, lockPath)
      await lock.close()
      await rename(lockPath, indexPath)
      ownsLock = false
    } finally {
      await lock.close().catch(() => {})
      if (ownsLock) await rm(lockPath, { force: true })
      await rm(temporary, { force: true })
      await rm(`${temporary}.lock`, { force: true })
      await rm(hooksDirectory, { recursive: true, force: true })
    }
  } else {
    if (typeof action.revision !== 'string' || action.revision !== state.revision) throw new Error('Repository changed. Refresh and select the changes again.')
    return withIndexTransaction(root, action.revision, async env => {
      if (action.kind === 'patch') {
        validateWorkspacePath(action.path)
        if (action.side !== 'staged' && action.side !== 'unstaged') throw new Error('Invalid index side')
        if (typeof action.patch !== 'string' || !Array.isArray(action.lines) || action.lines.length === 0 || action.lines.some(line => !Number.isInteger(line) || line < 0)) throw new Error('Invalid patch selection')
        const file = state.files.find(file => file.path === action.path)
        if (!file || file.conflict || file.previousPath || file.x === 'T' || file.y === 'T') throw new Error('Use the whole-file action for this file.')
        const preview = await previewWorkspace(root, action.side, action.path)
        if (preview.revision !== action.revision || preview.patch !== action.patch) throw new Error('The selected diff changed. Refresh and select it again.')
        const patch = partialPatch(preview.patch, action.lines, action.side === 'staged')
        output = await git(root, ['apply', '--cached', '--whitespace=nowarn', '-'], patch, env)
      } else {
        if (!Array.isArray(action.paths) || action.paths.length === 0 || action.paths.length > 10000) throw new Error('Select files first')
        const paths = [...new Set(action.paths)]
        paths.forEach(validateWorkspacePath)
        for (const path of paths) {
          const file = state.files.find(file => file.path === path || file.previousPath === path)
          if (!file) throw new Error('File is no longer in the change set. Refresh first.')
          if (file.conflict) throw new Error('Resolve conflicts before staging in this workspace.')
          if (file.previousPath && !paths.includes(file.previousPath)) paths.push(file.previousPath)
        }
        output = action.kind === 'stage'
          ? await git(root, ['--literal-pathspecs', 'add', '--', ...paths], undefined, env)
          : state.head ? await git(root, ['--literal-pathspecs', 'reset', '-q', 'HEAD', '--', ...paths], undefined, env)
            : await git(root, ['--literal-pathspecs', 'rm', '--cached', '-r', '--', ...paths], undefined, env)
      }
      return output.trim() || (action.kind === 'patch' ? 'Selection updated.' : action.kind === 'stage' ? 'Files staged.' : 'Files unstaged.')
    })
  }
  return { output: output.trim() || 'Commit created.', snapshot: await readWorkspace(root) }
}
export async function inspectWorkspace(cwd: string, kind: string, ref: string): Promise<string> {
  const state = await readWorkspace(cwd)
  if (kind === 'branch' && state.branches.includes(ref)) return git(state.root, ['diff', '--no-ext-diff', '--no-textconv', 'HEAD', `refs/heads/${ref}`, '--'])
  if (kind === 'remote-branch' && state.remoteBranches.some(branch => branch.name === ref)) return git(state.root, ['diff', '--no-ext-diff', '--no-textconv', 'HEAD', `refs/remotes/${ref}`, '--'])
  if (kind === 'commit' && state.commits.some(commit => commit.sha === ref)) return git(state.root, ['show', '--no-ext-diff', '--no-textconv', '--format=fuller', ref, '--'])
  if (kind === 'stash' && state.stashes.some(stash => stash.sha === ref)) return git(state.root, ['stash', 'show', '--no-ext-diff', '--no-textconv', '--patch', '--include-untracked', ref, '--'])
  throw new Error('Reference is no longer available. Refresh first.')
}
export const localWorkspaceTransport: WorkspaceTransport = { conflict: readConflict, inspect: inspectWorkspace, snapshot: readWorkspace, preview: previewWorkspace, act: actWorkspace }
