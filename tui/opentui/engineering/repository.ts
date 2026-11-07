import { createHash } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { git } from '../../../lib/git/command'

export type EngineeringFile = { path: string; status: string; additions: string; deletions: string; version?: string }
export type EngineeringRepository = { root: string; branch: string; fingerprint: string; files: EngineeringFile[] }

/** All Git work is asynchronous. No transcript parsing or provider reads. */
export async function readEngineeringRepository(cwd: string): Promise<EngineeringRepository> {
  const root = (await git(cwd, ['rev-parse', '--show-toplevel']).catch(() => { throw new Error(`Not a git repository: ${cwd}`) })).trim()
  const [branch, head, status, unstaged, staged, stats, stagedStats] = await Promise.all([
    git(root, ['symbolic-ref', '--short', '-q', 'HEAD']).catch(() => '(detached)'),
    git(root, ['rev-parse', '--verify', 'HEAD']).catch(() => '(unborn)'),
    git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    git(root, ['diff', '--no-ext-diff', '--no-textconv', '--binary']),
    git(root, ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--binary']),
    git(root, ['diff', '--no-ext-diff', '--numstat', '-z', '--no-renames']),
    git(root, ['diff', '--cached', '--no-ext-diff', '--numstat', '-z', '--no-renames']),
  ])
  const counts = new Map<string, [number, number]>()
  for (const record of `${stats}${stagedStats}`.split('\0')) {
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(record)
    if (!match) continue
    const old = counts.get(match[3]!) ?? [0, 0]
    counts.set(match[3]!, [old[0] + Number(match[1]), old[1] + Number(match[2])])
  }
  const records = status.split('\0'), files: EngineeringFile[] = []
  for (let index = 0; index < records.length; index++) {
    const record = records[index]!
    if (!record) continue
    const state = record.slice(0, 2), path = record.slice(3)
    if (/[RC]/.test(state)) index++ // -z stores the source path in the next record.
    const count = counts.get(path)
    files.push({ path, status: state, additions: count ? Number.isFinite(count[0]) ? String(count[0]) : 'binary' : '?', deletions: count ? Number.isFinite(count[1]) ? String(count[1]) : 'binary' : '?' })
  }
  // Untracked contents are not in git diff. Include their filesystem version;
  // the UI calls this a working-state fingerprint, never a commit identity.
  const versions = await Promise.all(files.map(async file => {
    try { const stat = await lstat(join(root, file.path)); return [file.path, stat.size, stat.mtimeMs, stat.ctimeMs] }
    catch { return [file.path, 'missing'] }
  }))
  files.forEach((file, index) => { file.version = createHash('sha256').update(JSON.stringify([file.status, file.additions, file.deletions, versions[index]])).digest('hex') })
  const fingerprint = createHash('sha256').update(head).update(status).update(unstaged).update(staged).update(JSON.stringify(versions)).digest('hex')
  return { root, branch: branch.trim(), fingerprint, files }
}
