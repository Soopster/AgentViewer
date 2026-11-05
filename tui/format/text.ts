import type { TuiTranscriptCardLine, TuiTranscriptLineTone } from './types'

export const MAX_PREVIEW_CHARS = 160

export const MAX_BLOCK_LINES = 6

export const MAX_CARD_LINES = 4

export const ANSI_ESCAPE_PATTERN = /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g

// Everything sanitizeLine removes or rewrites is a C0 control other than a
// newline (ESC opens every ANSI sequence), so one probe decides whether its
// four replace passes have anything to do. Almost no line does.
const SANITIZE_PROBE = /[\u0000-\u0009\u000B-\u001F\u007F]/

// Reuse locale setup across transcript messages. toLocaleTimeString with
// options repeats it for every card, dominating large-session formatting.
const TIMESTAMP_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
})

export function sanitizeLine(value: string): string {
  if (!SANITIZE_PROBE.test(value)) return value
  return value
    .replace(ANSI_ESCAPE_PATTERN, '')
    .replace(/\r/g, '')
    .replace(/\t/g, '  ')
    .replace(/[\u0000-\u0008\u000B-\u001A\u001C-\u001F\u007F]/g, '')
}

export function formatTimestamp(value?: string): string {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  return TIMESTAMP_FORMATTER.format(parsed)
}

export function truncateLine(value: string, maxChars = MAX_PREVIEW_CHARS): string {
  const sanitized = sanitizeLine(value)
  if (sanitized.length <= maxChars) return sanitized
  return `${sanitized.slice(0, Math.max(maxChars - 1, 1))}…`
}

export function compactLines(text: string): string[] {
  const visible: string[] = []
  let count = 0
  let start = 0
  // Walk the source without allocating an array (and truncated copy) of every
  // line just to retain a handful of preview rows. Still normalize hidden rows
  // so ANSI-only and whitespace-only lines keep their original counting rules.
  while (start <= text.length) {
    const newline = text.indexOf('\n', start)
    const end = newline === -1 ? text.length : newline
    const normalized = sanitizeLine(text.slice(start, end).trimEnd())
    if (normalized.length > 0) {
      count++
      if (visible.length < MAX_BLOCK_LINES) {
        visible.push(normalized.length <= MAX_PREVIEW_CHARS
          ? normalized
          : `${normalized.slice(0, Math.max(MAX_PREVIEW_CHARS - 1, 1))}…`)
      }
    }
    if (newline === -1) break
    start = newline + 1
  }
  if (count > MAX_BLOCK_LINES) visible.push(`… ${count - MAX_BLOCK_LINES} more lines`)
  return visible
}

export function previewJson(value: unknown): string {
  try {
    return truncateLine(JSON.stringify(value))
  } catch {
    return truncateLine(String(value))
  }
}

export function line(text: string, tone: TuiTranscriptLineTone = 'default'): TuiTranscriptCardLine {
  return { text, tone }
}

export function compactOneLine(value: string, maxChars = MAX_PREVIEW_CHARS): string {
  // Only the first maxChars survive, so a long value (a heredoc command, a
  // whole file passed as an argument) need not be collapsed end to end.
  // Collapsing is local, so a prefix collapses to a prefix of the full result;
  // with no control character in it sanitizeLine leaves it alone, and no ANSI
  // sequence can begin there to be cut by the window. Anything else — a short
  // value, a mostly-whitespace prefix, a control character — takes the full path.
  const window = maxChars * 4 + 64
  if (value.length > window * 2) {
    const head = value.slice(0, window).replace(/\s+/g, ' ').trim()
    if (head.length > maxChars && !SANITIZE_PROBE.test(head)) {
      return `${head.slice(0, Math.max(maxChars - 1, 1))}…`
    }
  }
  return truncateLine(value.replace(/\s+/g, ' ').trim(), maxChars)
}

export const CODE_FENCE_RE = /^```([^\s`]*)[^\n]*\n([\s\S]*?)^```[ \t]*$/gm
