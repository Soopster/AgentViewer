import { spawn } from 'node:child_process'

export type EditorProjectSearchOptions = {
  regex: boolean
  matchCase: boolean
  wholeWord: boolean
  limit?: number
  signal?: AbortSignal
  /** Injected so win32 path handling is exercised from a posix machine. */
  platform?: NodeJS.Platform
}

/** No search backend is installed. Distinct from "the search itself failed". */
export class EditorProjectSearchUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EditorProjectSearchUnavailableError'
  }
}

// Every result path has to be comparable with an open buffer's path, and buffer
// paths come from `path.relative`, so they use the platform separator. The two
// backends agree with neither each other nor that: ripgrep echoes the './'
// prefix it was given (as '.\' on Windows) and git always reports forward
// slashes, on every platform. Left alone, a Windows search reported '.\a\b.ts'
// and 'a/b.ts' for the file the editor knows as 'a\b.ts' — so an open buffer's
// stale disk hits were never deduplicated away, and every path was displayed in
// a form the editor did not use.
function normalizeSearchPath(raw: string, platform: NodeJS.Platform): string {
  const stripped = raw.replace(/^\.[\\/]/, '')
  return platform === 'win32' ? stripped.replace(/\//g, '\\') : stripped
}

function isMissingCommand(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

export type EditorProjectSearchResult = {
  path: string
  line: number
  character: number
  preview: string
}

export type EditorProjectSearchBuffer = { path: string; content: string }

type SearchCommandResult = { code: number | null; stdout: string; stderr: string }

function runCommand(command: string, args: string[], cwd: string, signal?: AbortSignal): Promise<SearchCommandResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Project search cancelled', 'AbortError'))
      return
    }
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    const abort = () => child.kill()
    signal?.addEventListener('abort', abort, { once: true })
    child.once('error', (error) => {
      signal?.removeEventListener('abort', abort)
      reject(error)
    })
    child.once('exit', (code) => {
      signal?.removeEventListener('abort', abort)
      if (signal?.aborted) reject(new DOMException('Project search cancelled', 'AbortError'))
      else resolve({ code, stdout, stderr })
    })
  })
}

function parseRipgrepJson(output: string, limit: number, platform: NodeJS.Platform): EditorProjectSearchResult[] {
  const results: EditorProjectSearchResult[] = []
  for (const line of output.split('\n')) {
    if (!line || results.length >= limit) continue
    let event: unknown
    try { event = JSON.parse(line) } catch { continue }
    if (!event || typeof event !== 'object') continue
    const record = event as { type?: string; data?: Record<string, unknown> }
    if (record.type !== 'match' || !record.data) continue
    const path = record.data.path as { text?: unknown } | undefined
    const lines = record.data.lines as { text?: unknown } | undefined
    const submatches = record.data.submatches
    const lineNumber = record.data.line_number
    if (typeof path?.text !== 'string' || typeof lines?.text !== 'string'
      || typeof lineNumber !== 'number' || !Array.isArray(submatches)) continue
    const preview = lines.text.replace(/[\r\n]+$/, '')
    for (const rawMatch of submatches) {
      if (results.length >= limit || !rawMatch || typeof rawMatch !== 'object') break
      const byteOffset = (rawMatch as { start?: unknown }).start
      if (typeof byteOffset !== 'number') continue
      const character = Buffer.from(preview).subarray(0, byteOffset).toString('utf8').length
      results.push({ path: normalizeSearchPath(path.text, platform), line: lineNumber - 1, character, preview })
    }
  }
  return results
}

function parseGitGrep(output: string, query: string, matchCase: boolean, limit: number, platform: NodeJS.Platform): EditorProjectSearchResult[] {
  const results: EditorProjectSearchResult[] = []
  const needle = matchCase ? query : query.toLocaleLowerCase()
  for (const row of output.split('\n')) {
    if (!row || results.length >= limit) continue
    const match = /^(.*?):(\d+):(.*)$/.exec(row)
    if (!match) continue
    const preview = match[3]!
    const haystack = matchCase ? preview : preview.toLocaleLowerCase()
    const character = haystack.indexOf(needle)
    if (character >= 0) results.push({ path: normalizeSearchPath(match[1]!, platform), line: Number(match[2]) - 1, character, preview })
  }
  return results
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function advanceUnicodeOffset(value: string, offset: number): number {
  const first = value.charCodeAt(offset)
  return first >= 0xD800 && first <= 0xDBFF
    && value.charCodeAt(offset + 1) >= 0xDC00 && value.charCodeAt(offset + 1) <= 0xDFFF
    ? offset + 2
    : offset + 1
}

export function searchEditorBuffers(
  buffers: readonly EditorProjectSearchBuffer[],
  query: string,
  options: Omit<EditorProjectSearchOptions, 'signal'>,
): EditorProjectSearchResult[] {
  if (!query) return []
  const limit = options.limit ?? 500
  const source = options.regex ? query : escapeRegExp(query)
  const pattern = new RegExp(options.wholeWord ? `\\b(?:${source})\\b` : source, options.matchCase ? 'gu' : 'giu')
  const results: EditorProjectSearchResult[] = []
  for (const buffer of buffers) {
    for (const [line, preview] of buffer.content.split('\n').entries()) {
      pattern.lastIndex = 0
      for (let match = pattern.exec(preview); match && results.length < limit; match = pattern.exec(preview)) {
        results.push({ path: buffer.path, line, character: match.index, preview })
        if (match[0].length === 0) pattern.lastIndex = advanceUnicodeOffset(preview, pattern.lastIndex)
      }
      if (results.length >= limit) return results
    }
  }
  return results
}

export async function searchEditorProject(
  cwd: string,
  query: string,
  options: EditorProjectSearchOptions,
): Promise<EditorProjectSearchResult[]> {
  if (!query) return []
  const limit = options.limit ?? 500
  const platform = options.platform ?? process.platform
  const rgArgs = [
    '--json',
    '--color', 'never',
    '--glob', '!.git/**',
    ...(options.regex ? [] : ['--fixed-strings']),
    ...(options.matchCase ? ['--case-sensitive'] : ['--ignore-case']),
    ...(options.wholeWord ? ['--word-regexp'] : []),
    '--', query, '.',
  ]
  try {
    const result = await runCommand('rg', rgArgs, cwd, options.signal)
    if (result.code === 0 || result.code === 1) return parseRipgrepJson(result.stdout, limit, platform)
    throw new Error(result.stderr.trim() || `ripgrep exited with ${result.code}`)
  } catch (error) {
    if (!isMissingCommand(error)) throw error
  }

  if (options.regex || options.wholeWord) {
    throw new EditorProjectSearchUnavailableError('Regex and whole-word project search require ripgrep (rg) on PATH')
  }
  // `--no-color` because git grep honours a user's `color.grep = always`, which
  // would otherwise wrap every match in escapes and break the parse below.
  const gitArgs = ['grep', '--no-color', '-n', '-I', ...(options.matchCase ? [] : ['-i']), '-F', '--', query]
  let fallback: SearchCommandResult
  try {
    fallback = await runCommand('git', gitArgs, cwd, options.signal)
  } catch (error) {
    if (!isMissingCommand(error)) throw error
    throw new EditorProjectSearchUnavailableError('Project search needs ripgrep (rg) on PATH; neither rg nor git was found')
  }
  if (fallback.code === 0 || fallback.code === 1) return parseGitGrep(fallback.stdout, query, options.matchCase, limit, platform)
  const reason = fallback.stderr.trim()
  // Outside a repository git grep exits 128, which is not a search failure: it
  // means this folder has no backend at all until ripgrep is installed.
  if (fallback.code === 128 && /not a git repository/i.test(reason)) {
    throw new EditorProjectSearchUnavailableError('Project search needs ripgrep (rg) on PATH outside a git repository')
  }
  throw new Error(reason || `git grep exited with ${fallback.code}`)
}
