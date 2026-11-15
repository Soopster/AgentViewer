// Reads a repository's history for `lib/whatsNew.ts`. One `git log` with
// numstat: the only per-commit facts the highlights need are the message, the
// date, the tags on it and which files changed by how much.
//
// A directory that is not a repository, or a git that is missing, is an error
// the caller can say; it never reads as "no changes".

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { buildWhatsNew, type WhatsNew, type WhatsNewCommit } from './whatsNew'
import { findRepoRoot } from './worktreeTasks'

const execFileAsync = promisify(execFile)
const GIT_TIMEOUT_MS = 15_000
export const WHATS_NEW_MAX_COMMITS = 1500
const BODY_LIMIT = 800
const START = '\x1e'
const FIELD = '\x1f'
const END = '\x1d'

/** Parses `git log --format=<START>%H<F>%ct<F>%an<F>%D<F>%s<F>%b<END> --numstat`. Exported for the smoke. */
export function parseWhatsNewLog(output: string): WhatsNewCommit[] {
  const commits: WhatsNewCommit[] = []
  for (const record of output.split(START)) {
    const end = record.indexOf(END)
    if (end < 0) continue
    const [sha, seconds, author, refs, subject, ...bodyParts] = record.slice(0, end).split(FIELD)
    if (!sha || !seconds) continue
    const tags = (refs ?? '').split(',').map(ref => ref.trim()).filter(ref => ref.startsWith('tag: ')).map(ref => ref.slice(5))
    const files: WhatsNewCommit['files'] = []
    for (const line of record.slice(end + 1).split('\n')) {
      const match = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line)
      if (!match) continue
      // A rename prints `old => new` (or `{a => b}`); the destination is what exists now.
      const path = match[3]!.replace(/\{[^}]* => ([^}]*)\}/, '$1').replace(/^.* => /, '').replace(/\/\//g, '/')
      files.push({ path, added: match[1] === '-' ? 0 : Number(match[1]), removed: match[2] === '-' ? 0 : Number(match[2]) })
    }
    commits.push({
      sha, subject: subject ?? '', author: author ?? '', timestampMs: Number(seconds) * 1000, tags, files,
      body: bodyParts.join(FIELD).trim().slice(0, BODY_LIMIT),
    })
  }
  return commits
}

export type WhatsNewReadOptions = {
  /** Any directory inside the repository; defaults to the process's. */
  cwd?: string
  /** How many revisions to return. */
  limit?: number
}

export async function readWhatsNew(options: WhatsNewReadOptions = {}): Promise<WhatsNew> {
  const start = options.cwd ?? process.cwd()
  const root = (await findRepoRoot(start)) ?? start
  let stdout: string
  try {
    ;({ stdout } = await execFileAsync('git', [
      'log', '--no-merges', `--max-count=${WHATS_NEW_MAX_COMMITS + 1}`, '--decorate=short', '--numstat',
      `--format=${START}%H${FIELD}%ct${FIELD}%an${FIELD}%D${FIELD}%s${FIELD}%b${END}`,
    ], { cwd: root, timeout: GIT_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' }))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(/not a git repository/i.test(message) ? 'This directory is not a git repository.' : `Could not read the history: ${message.split('\n')[0]}`)
  }
  const commits = parseWhatsNewLog(stdout)
  const truncated = commits.length > WHATS_NEW_MAX_COMMITS
  return buildWhatsNew(truncated ? commits.slice(0, WHATS_NEW_MAX_COMMITS) : commits, { limit: options.limit, truncated })
}
