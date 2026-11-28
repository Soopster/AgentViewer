// Finding the newest error in a process's output, so it can be handed to an
// agent with the frames that name the project's own files.
//
// Pure string work over log lines. It is run on demand (a key press), never per
// rendered line, so it can afford to scan the whole retained buffer.

import { codeFenceFor } from './selectionAsk'

export type StackFrame = {
  /** As printed: absolute, or relative to the process's directory. */
  path: string
  line: number
  column?: number
  /** A frame inside a dependency or the runtime, not the project's own code. */
  external: boolean
}

export type StackTrace = {
  /** Index range in the lines it was found in, inclusive. */
  startIndex: number
  endIndex: number
  lines: string[]
  frames: StackFrame[]
  /** The line that says what went wrong: the error message, or the first line. */
  headline: string
}

// Each pattern captures path, line and (optionally) column. Ordered by how
// specific the surrounding syntax is, so a Python frame is not also read as a
// generic `path:line`.
const FRAME_PATTERNS: RegExp[] = [
  // Node / V8 / Bun: "    at fn (/abs/file.ts:12:5)" or "    at /abs/file.ts:12:5"
  /^\s*at (?:.*?\()?(?:file:\/\/)?((?:node:|[A-Za-z]:)?[^\s():]+):(\d+):(\d+)\)?\s*$/,
  // Python: '  File "/abs/x.py", line 12, in fn'
  /^\s*File "([^"]+)", line (\d+)/,
  // JVM: "\tat com.x.Y.fn(Y.java:12)"
  /^\s+at [\w$.<>/]+\(([\w$-]+\.(?:java|kt|kts|scala|groovy)):(\d+)\)/,
  // Go: "\t/abs/main.go:12 +0x1d"
  /^\s+((?:[A-Za-z]:)?\/[^\s:]+\.go):(\d+)(?:\s|$)/,
  // Rust: "thread 'main' panicked at src/main.rs:12:5:" and "   at ./src/x.rs:12:5"
  /panicked at ([^\s:]+\.rs):(\d+):(\d+)/,
  /^\s+at \.?\/?([^\s:]+\.rs):(\d+):(\d+)/,
  // tsc: "src/a.ts(12,5): error TS2322: …"
  /^((?:[A-Za-z]:)?[^\s(:]+\.[A-Za-z]{1,5})\((\d+),(\d+)\): (?:error|warning)/,
  // Ruby: "/abs/x.rb:12:in `fn'"
  /^\s*((?:[A-Za-z]:)?[^\s:]+\.rb):(\d+):in /,
]

// A generic "path:line[:col]" on a line that also reads as an error (esbuild,
// vite, eslint, gcc, pytest's short form, …).
const GENERIC_LOCATION = /((?:\.{1,2}\/|\/|[A-Za-z]:[\\/])?(?:[\w@.-]+[\\/])*[\w@.-]+\.[A-Za-z]{1,6}):(\d+)(?::(\d+))?/
const ERRORISH = /\b(?:error|exception|traceback|panic(?:ked)?|fatal|failed|failure|unhandled|uncaught|segmentation fault|assertion)\b|^\s*\w*(?:Error|Exception)\b|^E\s{2,}/i
const EXTERNAL = /(?:^|[\\/])(?:node_modules|site-packages|dist-packages|\.cargo|go[\\/]pkg[\\/]mod|vendor)[\\/]|^node:|^internal[\\/]|^<anonymous>|^\/rustc\//

const BARE_LOCATION = /^(?:file:\/\/)?(?:[A-Za-z]:)?[^\s:]+\.[A-Za-z]{1,6}:\d+(?::\d+)?$/
const MAX_TRACE_LINES = 80
const MAX_GAP = 1

export function parseStackFrame(line: string): StackFrame | null {
  for (const pattern of FRAME_PATTERNS) {
    const match = pattern.exec(line)
    if (!match) continue
    const path = match[1]!
    return {
      path,
      line: Number(match[2]),
      ...(match[3] ? { column: Number(match[3]) } : {}),
      external: EXTERNAL.test(path),
    }
  }
  if (!ERRORISH.test(line)) return null
  const match = GENERIC_LOCATION.exec(line)
  if (!match) return null
  const path = match[1]!
  // A version number or a time ("1.2.3:4") is not a location.
  if (/^\d/.test(path)) return null
  return { path, line: Number(match[2]), ...(match[3] ? { column: Number(match[3]) } : {}), external: EXTERNAL.test(path) }
}

function isErrorish(line: string): boolean {
  return ERRORISH.test(line)
}

function isBlank(line: string): boolean {
  return line.trim() === ''
}

/**
 * The newest error in `lines`: the last frame or error line, grown to the block
 * of frames, messages and indented context around it. Null when nothing in the
 * output reads as an error.
 */
export function findLatestStackTrace(lines: readonly string[]): StackTrace | null {
  let anchor = -1
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]!
    if (parseStackFrame(line) || isErrorish(line)) { anchor = index; break }
  }
  if (anchor < 0) return null

  // Frames, error lines, indented context, a caret under the failing column, and
  // a line that is only a location (Node prints the throwing line's above its excerpt).
  const belongs = (line: string) => Boolean(parseStackFrame(line)) || isErrorish(line) || /^\s+\S/.test(line)
    || /^\s*\^+\s*$/.test(line) || BARE_LOCATION.test(line)
  let start = anchor
  let end = anchor
  // Grow upwards across frames, messages and indented context, bridging one
  // blank line (Node prints one between the source excerpt and the error).
  for (let gap = 0; start > 0 && anchor - start < MAX_TRACE_LINES;) {
    const above = lines[start - 1]!
    if (isBlank(above)) {
      if (gap >= MAX_GAP) break
      const beyond = lines[start - 2]
      if (beyond === undefined || !belongs(beyond)) break
      gap += 1
      start -= 1
      continue
    }
    if (!belongs(above)) {
      // The message line of a trace is often unindented and says nothing that
      // reads as an error ("boom"), but it sits directly above the first frame.
      if (parseStackFrame(lines[start]!)) start -= 1
      break
    }
    start -= 1
  }
  for (; end < lines.length - 1 && end - start < MAX_TRACE_LINES;) {
    const below = lines[end + 1]!
    if (isBlank(below) || !belongs(below)) break
    end += 1
  }
  while (start < end && isBlank(lines[start]!)) start += 1

  const block = lines.slice(start, end + 1)
  const frames: StackFrame[] = []
  const seen = new Set<string>()
  for (const line of block) {
    const frame = parseStackFrame(line)
    if (!frame) continue
    const id = `${frame.path}:${frame.line}`
    if (seen.has(id)) continue
    seen.add(id)
    frames.push(frame)
  }
  // The message is the error line at the margin; an indented one is source
  // context ("    throw new Error(…)") that merely mentions an error.
  const message = (line: string) => isErrorish(line) && !parseStackFrame(line)
  const headline = block.find((line) => message(line) && !/^\s/.test(line))
    ?? block.find(message)
    ?? block.find((line) => !isBlank(line))
    ?? ''
  return { startIndex: start, endIndex: end, lines: block, frames, headline: headline.trim() }
}

export type StackTracePromptInput = {
  trace: StackTrace
  /** The process's name and command, as the user configured it. */
  processName: string
  command: string
  cwd: string
}

const MAX_PROMPT_TRACE_CHARS = 12_000

/** The prompt that hands an error to an agent: where it came from, the trace, and the project's own frames first. */
export function buildStackTracePrompt({ trace, processName, command, cwd }: StackTracePromptInput): string {
  const own = trace.frames.filter((frame) => !frame.external)
  let text = trace.lines.join('\n').replace(/\s+$/, '')
  if (text.length > MAX_PROMPT_TRACE_CHARS) text = `${text.slice(0, MAX_PROMPT_TRACE_CHARS)}\n… trace cut short`
  const fence = codeFenceFor(text)
  const lines = [
    `This error came out of the \`${processName}\` process (\`${command}\`, run in ${cwd}). Find the cause in this project's code and fix it. Read the code at the frames below before changing anything, and say what was wrong.`,
    '',
  ]
  if (own.length > 0) {
    lines.push('Frames in this project:')
    for (const frame of own.slice(0, 8)) lines.push(`- ${frame.path}:${frame.line}${frame.column ? `:${frame.column}` : ''}`)
    lines.push('')
  }
  lines.push(`${fence}text`, text, fence)
  return lines.join('\n')
}
