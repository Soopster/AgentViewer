// The one place `gh` is spawned. Every GitHub feature goes through it so a
// missing, logged-out or rate-limited `gh` is classified the same way everywhere
// instead of each caller regex-matching stderr for itself.
import { execFile } from 'node:child_process'
import { scrubGithubText } from './text'

export type GhResult = { stdout: string; stderr: string; code: number }

export type GhUnavailableReason = 'missing' | 'unauthenticated' | 'no-remote' | 'rate-limited'

export type GhRunOptions = {
  maxBuffer?: number
  input?: string
  /** Kill `gh` after this long; the result then has a non-zero code. */
  timeoutMs?: number
}

export const GH_DEFAULT_TIMEOUT_MS = 20_000
const DEFAULT_MAX_BUFFER = 20 * 1024 * 1024

/** Never rejects: callers read `code`. Arguments are argv, never a shell string. */
export function runGh(cwd: string, args: string[], options: GhRunOptions = {}): Promise<GhResult> {
  return new Promise((resolve) => {
    const child = execFile(
      'gh',
      args,
      { cwd, encoding: 'utf8', maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER, timeout: options.timeoutMs ?? GH_DEFAULT_TIMEOUT_MS },
      (error, stdout, stderr) => {
        resolve({
          stdout: String(stdout ?? '').trim(),
          stderr: String(stderr || (error instanceof Error ? error.message : '')).trim(),
          code: typeof error === 'object' && error && 'code' in error && typeof error.code === 'number' ? error.code : error ? 1 : 0,
        })
      },
    )
    if (options.input != null && child.stdin) {
      child.stdin.write(options.input)
      child.stdin.end()
    }
  })
}

/** Why a failed `gh` call is not the caller's fault, or null when it is an ordinary failure. */
export function classifyGhFailure(result: GhResult): GhUnavailableReason | null {
  if (result.code === 0) return null
  const text = result.stderr
  if (/ENOENT|command not found|spawn gh/i.test(text)) return 'missing'
  if (/auth login|not logged in|gh auth|authentication/i.test(text)) return 'unauthenticated'
  if (/rate limit/i.test(text)) return 'rate-limited'
  if (/no git remotes|could not determine|none of the git remotes|not a git repository/i.test(text)) return 'no-remote'
  return null
}

export function ghUnavailableMessage(reason: GhUnavailableReason): string {
  switch (reason) {
    case 'missing': return 'GitHub CLI (gh) is not installed.'
    case 'unauthenticated': return 'Run gh auth login to use GitHub features.'
    case 'rate-limited': return 'GitHub rate limit reached; try again shortly.'
    case 'no-remote': return 'No GitHub repository found for this project.'
  }
}

export function parseJson<T>(text: string, fallback: T): T {
  try { return JSON.parse(text) as T } catch { return fallback }
}

/** The error a failed `gh` call becomes: the classified reason, else its scrubbed stderr, else `fallback`. */
export function ghFailure(result: GhResult, fallback: string): Error {
  const reason = classifyGhFailure(result)
  return new Error(reason ? ghUnavailableMessage(reason) : scrubGithubText(result.stderr) || fallback)
}

/** Only values `gh` takes as flag arguments; a leading dash would be read as another flag. */
export function flagValue(value: string, what: string): string {
  const trimmed = value.trim()
  if (!trimmed || trimmed.startsWith('-')) throw new Error(`Invalid ${what}.`)
  return trimmed
}

/** HTTP-ish failures that mean "this feature is not on for the repo", not "gh broke". */
export function isFeatureOff(result: GhResult): boolean {
  return /HTTP (403|404|451)|not enabled|disabled|Resource not accessible|Not Found/i.test(result.stderr)
}
