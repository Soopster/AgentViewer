import { execFile, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, lstat, mkdtemp, readFile, readlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

export function resultGit(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => execFile('git', args, { cwd, env, encoding: 'utf8', timeout: 15_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) reject(new Error(stderr.trim() || error.message))
    else resolve(stdout)
  }))
}

/** Capture reviewed working files without changing their index or HEAD. */
export async function snapshotDependencySource(cwd: string, head: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'av-dependency-index-'))
  const index = path.join(directory, 'index')
  const env = { ...process.env, GIT_INDEX_FILE: index }
  try {
    const original = (await resultGit(cwd, ['rev-parse', '--git-path', 'index'])).trim()
    await copyFile(path.resolve(cwd, original), index).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
      await resultGit(cwd, ['read-tree', head], env)
    })
    await resultGit(cwd, ['add', '-A'], env)
    const tree = (await resultGit(cwd, ['write-tree'], env)).trim()
    return (await resultGit(cwd, ['commit-tree', tree, '-p', head, '-m', 'Coordinator reviewed source snapshot'])).trim()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

export type StagedDependency = { target: string; base: string; tree: string; ref?: string; commit?: string }

export function coordinatorDependencyRef(runId: string): string {
  return `refs/agent-viewer/dependencies/${createHash('sha256').update(runId).digest('hex')}`
}

export async function readDependencyTip(target: string, ref: string): Promise<string | undefined> {
  const refs = await resultGit(target, ['for-each-ref', '--format=%(objectname) %(refname)', ref])
  return refs.split('\n').find(line => line.endsWith(` ${ref}`))?.split(' ')[0]
}

/** Find the reviewed ancestor inherited by a downstream checkout. */
export async function inheritedDependencyBase(cwd: string, head: string, base: string, dependencyTip?: string): Promise<string> {
  if (!dependencyTip) return base
  const inherited = (await resultGit(cwd, ['merge-base', head, dependencyTip])).trim()
  return checkoutContainsDependencySync(cwd, base, inherited) ? inherited : base
}

/** Resolve a reviewed squash to a commit in the target's current history. */
export function committedDependencySync(proof: StagedDependency): string | undefined {
  const sha = /^[a-f0-9]{40,64}$/
  if (!path.isAbsolute(proof.target) || !sha.test(proof.base) || !sha.test(proof.tree)) return
  if (proof.ref) {
    if (!/^refs\/agent-viewer\/dependencies\/[a-f0-9]{64}$/.test(proof.ref) || !proof.commit || !sha.test(proof.commit)) return
    return checkoutContainsDependencySync(proof.target, proof.commit, proof.ref) ? proof.commit : undefined
  }
  try {
    const entries = execFileSync('git', ['--no-optional-locks', 'log', '--ancestry-path', '--format=%H %T', `${proof.base}..HEAD`], {
      cwd: proof.target, encoding: 'utf8', timeout: 1500, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    })
    return entries.split('\n').find(line => line.endsWith(` ${proof.tree}`))?.split(' ')[0]
  } catch { return undefined }
}

export function checkoutContainsDependencySync(cwd: string, commit: string, revision = 'HEAD'): boolean {
  try {
    execFileSync('git', ['--no-optional-locks', 'merge-base', '--is-ancestor', commit, revision], {
      cwd, timeout: 1500, stdio: 'ignore',
    })
    return true
  } catch { return false }
}

/** Read-only identity of HEAD, index, tracked edits and untracked file contents. */
export async function coordinatorCheckoutRevision(cwd: string): Promise<string> {
  const [head, diff, index, status, untracked] = await Promise.all([
    resultGit(cwd, ['rev-parse', 'HEAD']),
    resultGit(cwd, ['diff', '--no-ext-diff', '--no-textconv', '--binary', 'HEAD', '--']),
    resultGit(cwd, ['diff', '--no-ext-diff', '--no-textconv', '--binary', '--cached', '--']),
    resultGit(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    resultGit(cwd, ['ls-files', '--others', '--exclude-standard', '-z']),
  ])
  const hash = createHash('sha256')
  for (const value of [head, diff, index, status]) hash.update(value).update('\0')
  for (const file of untracked.split('\0').filter(Boolean).sort()) {
    const absolute = path.join(cwd, file)
    const stat = await lstat(absolute)
    if (stat.size > 16 * 1024 * 1024) throw new Error(`File too large to fingerprint: ${file}`)
    hash.update(file).update('\0').update(String(stat.mode)).update('\0')
    if (stat.isSymbolicLink()) hash.update(await readlink(absolute))
    else if (stat.isFile()) hash.update(await readFile(absolute))
    else throw new Error(`Cannot fingerprint ${file}`)
    hash.update('\0')
  }
  return hash.digest('hex')
}

/**
 * Files a squash-merge of `branch` into `target`'s HEAD would conflict in,
 * found without touching either checkout (`git merge-tree --write-tree`, which
 * only writes objects). Exit 0 is a clean merge, 1 a conflicted one with the
 * paths listed after the tree id; anything else — an old git, an unrelated
 * history — is "unknown", never "clean": a preview that guesses clean sends the
 * engineer into an integration that fails, which is the thing it exists to avoid.
 */
export function previewMergeConflicts(target: string, branch: string, base = 'HEAD'): Promise<{ conflicts: string[] } | null> {
  return new Promise((resolve) => execFile(
    'git', ['merge-tree', '--write-tree', '--name-only', '--no-messages', base, branch],
    { cwd: target, encoding: 'utf8', timeout: 15_000, maxBuffer: 16 * 1024 * 1024 },
    (error, stdout) => {
      const code = error ? (error as { code?: unknown }).code : 0
      // A refused merge (unknown ref, unrelated history) also exits 1, but only
      // a real result starts with the tree id — that, not the exit code, says
      // git actually merged.
      if ((code !== 0 && code !== 1) || !/^[0-9a-f]{40,64}$/.test(stdout.split('\n')[0] ?? '')) return resolve(null)
      resolve({ conflicts: code === 0 ? [] : parseMergeTreeConflicts(stdout) })
    },
  ))
}

/** `merge-tree --name-only` prints the result tree id, then the conflicted paths one per line. */
export function parseMergeTreeConflicts(output: string): string[] {
  const [, ...rest] = output.split('\n')
  const blank = rest.indexOf('')
  return [...new Set((blank < 0 ? rest : rest.slice(0, blank)).map((line) => line.trim()).filter(Boolean))]
}
