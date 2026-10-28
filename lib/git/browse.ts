/** Structured, read-only data for the terminal Git browser. */
import { open, lstat, readdir, realpath } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, relative, isAbsolute, sep } from 'node:path'
import { git, gitBytes } from './command'

export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
export const PREVIEW_LIMIT = 1024 * 1024
export type BrowseCommit = { graph?: string; sha: string; parents: string[]; subject: string; author: string; email: string; date: string; committer: string; committed: string; refs: string; message: string }
export type BrowseEntry = { path: string; name: string; kind: 'tree' | 'blob' | 'symlink' | 'submodule'; oid?: string }
export type BrowseWorktree = { path: string; branch: string }
const FORMAT = '%H%x00%P%x00%s%x00%an%x00%ae%x00%aI%x00%cn%x00%cI%x00%D%x00%B'
function commitRecords(raw: string): BrowseCommit[] {
  const fields = raw.split('\0'), result: BrowseCommit[] = []
  for (let i = 0; i + 9 < fields.length; i += 10) result.push({ sha: fields[i]!.trim(), parents: fields[i + 1]!.split(' ').filter(Boolean), subject: fields[i + 2]!, author: fields[i + 3]!, email: fields[i + 4]!, date: fields[i + 5]!, committer: fields[i + 6]!, committed: fields[i + 7]!, refs: fields[i + 8]!, message: fields[i + 9]! })
  return result
}
export async function browseHistory(cwd: string, ref: string, skip = 0): Promise<BrowseCommit[]> {
  if (ref !== '--all' && ref !== 'HEAD' && !ref.startsWith('refs/')) throw new Error('Invalid history reference')
  const args = ['--date-order', '--max-count=100', `--skip=${skip}`, ...(ref === '--all' ? ['--all'] : [ref]), '--']
  const [raw, graph] = await Promise.all([git(cwd, ['log', '-z', `--format=${FORMAT}`, ...args]), git(cwd, ['log', '--graph', '--format=%H', ...args])])
  const graphs = new Map<string, string>()
  for (const line of graph.split('\n')) { const match = /^([| *\\/_ .-]*)([a-f0-9]{40,64})$/.exec(line); if (match) graphs.set(match[2]!, match[1]!.replace(/\*/g, '●')) }
  return commitRecords(raw).map(commit => ({ ...commit, graph: graphs.get(commit.sha) ?? '● ' }))
}
export async function browseCommit(cwd: string, sha: string): Promise<BrowseCommit> {
  if (!/^[a-f0-9]{40,64}$/.test(sha)) throw new Error('Invalid commit ID')
  const value = commitRecords(await git(cwd, ['show', '-s', '-z', `--format=${FORMAT}`, sha]))[0]
  if (!value) throw new Error('Commit unavailable')
  return value
}
export async function browseWorktrees(cwd: string): Promise<BrowseWorktree[]> {
  const raw = await git(cwd, ['worktree', 'list', '--porcelain', '-z'])
  const result: BrowseWorktree[] = []
  for (const field of raw.split('\0')) {
    if (field.startsWith('worktree ')) result.push({ path: field.slice(9), branch: '(detached)' })
    if (field.startsWith('branch ') && result.length) result[result.length - 1]!.branch = field.slice(7).replace(/^refs\/heads\//, '')
  }
  return result
}
function safePath(path: string) {
  if (isAbsolute(path) || path.split('/').some(part => part === '..' || part === '.git') || path.includes('\0')) throw new Error('Invalid repository path')
}
export async function browseDirectory(cwd: string, revision: string | null, path = ''): Promise<BrowseEntry[]> {
  safePath(path)
  let entries: BrowseEntry[]
  if (revision) {
    if (!/^[a-f0-9]{40,64}$/.test(revision)) throw new Error('Invalid revision')
    const raw = await git(cwd, ['ls-tree', '-z', `${revision}${path ? `:${path}` : ''}`])
    entries = raw.split('\0').filter(Boolean).map(record => {
      const tab = record.indexOf('\t'), [mode, type, oid] = record.slice(0, tab).split(' '), name = record.slice(tab + 1)
      return { name, path: path ? `${path}/${name}` : name, oid, kind: mode === '120000' ? 'symlink' : type === 'commit' ? 'submodule' : type === 'tree' ? 'tree' : 'blob' }
    })
  } else {
    if (path) {
      const base = await realpath(cwd), target = await realpath(join(cwd, path)), within = relative(base, target)
      if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within) || (await lstat(join(cwd, path))).isSymbolicLink()) throw new Error('Directory is outside the worktree or a symbolic link')
    }
    // Git supplies the visible paths; ignored directories are never walked.
    const [raw, staged] = await Promise.all([
      git(cwd, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']),
      git(cwd, ['ls-files', '--stage', '-z']),
    ])
    const modules = new Set(staged.split('\0').filter(record => record.startsWith('160000 ')).map(record => record.slice(record.indexOf('\t') + 1)))
    const children = new Map<string, BrowseEntry>(), prefix = path ? `${path}/` : ''
    for (const file of raw.split('\0')) {
      if (!file.startsWith(prefix) || !file || file.includes('/.git/')) continue
      const name = file.slice(prefix.length).split('/')[0]!
      if (!name || children.has(name)) continue
      const childPath = prefix + name
      if (modules.has(childPath)) { children.set(name, { name, path: childPath, kind: 'submodule' }); continue }
      try {
        const stat = await lstat(join(cwd, childPath))
        children.set(name, { name, path: childPath, kind: stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'tree' : 'blob' })
      } catch { /* Deleted tracked files have no local contents. */ }
    }
    entries = [...children.values()]
    // A nested repository is a submodule/opaque entry, never traversed.
    for (const entry of entries) if (entry.kind === 'tree') {
      try { if ((await readdir(join(cwd, entry.path))).includes('.git')) entry.kind = 'submodule' } catch { /* Unavailable directory is reported on opening. */ }
    }
  }
  return entries.sort((a, b) => Number(b.kind === 'tree') - Number(a.kind === 'tree') || a.name.localeCompare(b.name))
}
export async function browseBlob(cwd: string, entry: BrowseEntry): Promise<string> {
  safePath(entry.path)
  if (entry.kind === 'submodule') return `Submodule ${entry.path}\n${entry.oid ?? 'Local checkout'}`
  if (entry.kind === 'symlink') return 'Symbolic link (not followed).'
  let bytes: Buffer, truncated = false
  if (entry.oid) {
    if (!/^[a-f0-9]{40,64}$/.test(entry.oid)) throw new Error('Invalid object ID')
    const size = Number(await git(cwd, ['cat-file', '-s', entry.oid]))
    if (size > PREVIEW_LIMIT) return 'Preview truncated: file exceeds 1 MiB.'
    bytes = (await gitBytes(cwd, ['cat-file', 'blob', entry.oid])).stdout
  } else {
    const repository = await realpath(cwd), target = await realpath(join(cwd, entry.path))
    const within = relative(repository, target)
    if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new Error('File is outside the worktree')
    const handle = await open(join(cwd, entry.path), constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = await handle.stat()
      if (!stat.isFile()) return 'Not a regular file.'
      const buffer = Buffer.alloc(Math.min(stat.size, PREVIEW_LIMIT))
      const read = await handle.read(buffer, 0, buffer.length, 0)
      bytes = buffer.subarray(0, read.bytesRead); truncated = stat.size > PREVIEW_LIMIT
    } finally { await handle.close() }
  }
  if (bytes.includes(0)) return 'Binary file — no text preview.'
  return bytes.toString('utf8') + (truncated ? '\nPreview truncated at 1 MiB.' : '')
}

export type BrowseChangedFile = { status: string; path: string; previousPath?: string }
export async function browseChangedFiles(cwd: string, commit: BrowseCommit): Promise<BrowseChangedFile[]> {
  const raw = await git(cwd, ['diff', '--name-status', '-z', '-M', commit.parents[0] ?? EMPTY_TREE, commit.sha, '--'])
  const fields = raw.split('\0'), files: BrowseChangedFile[] = []
  for (let i = 0; i < fields.length - 1;) {
    const status = fields[i++]!, first = fields[i++]!
    if (status.startsWith('R') || status.startsWith('C')) files.push({ status, previousPath: first, path: fields[i++]! })
    else files.push({ status, path: first })
  }
  return files
}
