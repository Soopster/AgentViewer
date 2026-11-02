import type { TuiThemePalette } from '../../theme'
import type { TuiTranscriptCard } from '../../format'
import type { InlineTextSegment } from './inlineText'
import { agentsToolSummaryLine } from './transcriptRows'
import { summarizeShellCommand } from './shellSummary'

// Syntax colour for the code a tool prints (a file it read, lines a search matched). Line by line and
// stateless: a transcript row is one line, and a multi-line comment or string only colours its own lines.

type Lang = 'ts' | 'py' | 'sh' | 'json' | 'css' | 'md' | 'go' | 'rs' | 'c'

const EXTENSIONS: Record<string, Lang> = {
  ts: 'ts', tsx: 'ts', js: 'ts', jsx: 'ts', mjs: 'ts', cjs: 'ts', mts: 'ts',
  py: 'py', sh: 'sh', bash: 'sh', zsh: 'sh', json: 'json', jsonc: 'json', css: 'css', scss: 'css',
  md: 'md', go: 'go', rs: 'rs', c: 'c', h: 'c', cc: 'c', cpp: 'c', java: 'c', swift: 'c', kt: 'c',
}

export function languageForPath(path: string): Lang | null {
  const ext = /\.([A-Za-z0-9]+)$/.exec(path.replace(/[:#]\d+.*$/, ''))?.[1]?.toLowerCase()
  return ext ? EXTENSIONS[ext] ?? null : null
}

const KEYWORDS: Record<Lang, ReadonlySet<string>> = {
  ts: new Set('import export from default const let var function return if else for while do switch case break continue new class extends implements interface type enum async await try catch finally throw typeof instanceof in of as void null undefined true false this super static public private protected readonly yield delete'.split(' ')),
  py: new Set('import from def class return if elif else for while in not and or is None True False try except finally raise with as lambda yield pass break continue async await global nonlocal'.split(' ')),
  sh: new Set('if then else elif fi for while do done case esac function in export local return echo cd'.split(' ')),
  json: new Set(['true', 'false', 'null']),
  css: new Set<string>(),
  md: new Set<string>(),
  go: new Set('package import func return if else for range switch case break continue type struct interface map chan go defer var const nil true false select'.split(' ')),
  rs: new Set('use mod pub fn let mut const struct enum impl trait for while loop if else match return self Self true false as in move async await where'.split(' ')),
  c: new Set('if else for while do switch case break continue return static const struct class enum public private protected new this null true false void int char long float double bool include define typedef'.split(' ')),
}

// One alternation, longest-first by position: comment, string, number, JSX/HTML tag, word, anything else.
const TOKEN = /(\/\/.*$|#.*$|\/\*.*?\*\/)|("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|`(?:[^`\\]|\\.)*`?)|(\b\d[\d_.]*\b)|(<\/?[A-Za-z][\w.]*)|([A-Za-z_$][\w$]*)|(\s+)|([\s\S])/g

export function highlightCodeLine(text: string, lang: Lang, theme: TuiThemePalette): InlineTextSegment[] {
  if (lang === 'md') return [{ text, fg: /^\s*#/.test(text) ? theme.violet : theme.text }]
  const segments: InlineTextSegment[] = []
  const keywords = KEYWORDS[lang]
  const hashComments = lang === 'py' || lang === 'sh'
  const push = (value: string, fg: string) => {
    const last = segments[segments.length - 1]
    if (last && last.fg === fg) last.text += value
    else segments.push({ text: value, fg })
  }
  for (const match of text.matchAll(TOKEN)) {
    const [token, comment, string, number, tag, word, space] = match
    if (comment !== undefined) {
      // `#` starts a comment only in languages that have them; in the rest it is code (`#include`, `#id`).
      if (comment.startsWith('#') && !hashComments) push(token, lang === 'c' ? theme.pink : theme.text)
      else push(token, theme.dim)
    } else if (string !== undefined) push(token, lang === 'json' && text.slice((match.index ?? 0) + token.length).trimStart().startsWith(':') ? theme.cyan : theme.green)
    else if (number !== undefined) push(token, theme.amber)
    else if (tag !== undefined) push(token, theme.pink)
    else if (word !== undefined) {
      const next = text[(match.index ?? 0) + token.length]
      if (keywords.has(word)) push(token, theme.pink)
      else if (/^[A-Z][A-Za-z0-9]*$/.test(word) && lang !== 'sh') push(token, theme.cyan)
      else if (next === '(') push(token, theme.green)
      else push(token, theme.text)
    } else if (space !== undefined) push(token, theme.text)
    else push(token, /[{}()[\]]/.test(token) ? theme.muted : /[=+\-*/%<>!&|?:]/.test(token) ? theme.pink : theme.text)
  }
  return segments
}

/** What a tool's output lines are: a file's text, or `path:line:text` search hits. */
export type ToolOutputContext = { kind: 'code'; lang: Lang } | { kind: 'search' }

const contextCache = new WeakMap<TuiTranscriptCard, ToolOutputContext | null>()
export function toolOutputContext(card: TuiTranscriptCard): ToolOutputContext | null {
  if (contextCache.has(card)) return contextCache.get(card)!
  const context = readToolOutputContext(card)
  contextCache.set(card, context)
  return context
}
function readToolOutputContext(card: TuiTranscriptCard): ToolOutputContext | null {
  const summary = agentsToolSummaryLine(card).text.replace(/^tool\s+/i, '').trim()
  const colon = summary.indexOf(':')
  const name = (colon >= 0 ? summary.slice(0, colon) : summary.split(/\s+/, 1)[0] ?? '').trim().toLowerCase()
  const detail = colon >= 0 ? summary.slice(colon + 1).trim() : ''
  if (name === 'grep') return { kind: 'search' }
  if (name === 'read' || name === 'view') {
    const lang = languageForPath(detail.split(/\s+/)[0] ?? '')
    return lang ? { kind: 'code', lang } : null
  }
  if (name === 'bash') {
    const human = summarizeShellCommand(detail)
    if (human?.verb === 'Searched') return { kind: 'search' }
    const lang = human?.verb === 'Read' && human.path ? languageForPath(human.path) : null
    return lang ? { kind: 'code', lang } : null
  }
  return null
}

const SEARCH_HIT = /^(\s*)([^\s:][^:]*?\.[A-Za-z0-9]+)([:-])(\d+)([:-])(.*)$/
const LINE_NUMBER_PREFIX = /^(\s*\d+[→\t:|]\s?)(.*)$/

/** Segments for one output line, or null to leave it as plain text. */
export function highlightToolOutputLine(text: string, context: ToolOutputContext, theme: TuiThemePalette): InlineTextSegment[] | null {
  if (!text.trim()) return null
  if (context.kind === 'search') {
    const hit = SEARCH_HIT.exec(text)
    const lang = hit ? languageForPath(hit[2]!) : null
    if (!hit || !lang) return null
    return [
      { text: hit[1]! + hit[2]!, fg: theme.cyan },
      { text: `${hit[3]}${hit[4]}${hit[5]}`, fg: theme.dim },
      ...highlightCodeLine(hit[6]!, lang, theme),
    ]
  }
  const numbered = LINE_NUMBER_PREFIX.exec(text)
  if (numbered) return [{ text: numbered[1]!, fg: theme.dim }, ...highlightCodeLine(numbered[2]!, context.lang, theme)]
  return highlightCodeLine(text, context.lang, theme)
}
