import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, readFile, readlink } from 'node:fs/promises'
import path from 'node:path'

export function resultGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => execFile('git', args, { cwd, encoding: 'utf8', timeout: 15_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) reject(new Error(stderr.trim() || error.message))
    else resolve(stdout)
  }))
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
export function previewMergeConflicts(target: string, branch: string): Promise<{ conflicts: string[] } | null> {
  return new Promise((resolve) => execFile(
    'git', ['merge-tree', '--write-tree', '--name-only', '--no-messages', 'HEAD', branch],
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
