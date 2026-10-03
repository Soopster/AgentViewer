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
