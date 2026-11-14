/** One-line, human reading of a shell command made only of read-only lookups. */
import { shellWrittenFiles } from '../../../lib/turnEditStats'

export interface ShellSummary { verb: 'Read' | 'Searched' | 'Listed' | 'Edited'; detail: string; /** The file a Read or Edited summary names, in full. */ path?: string }

type Step = { verb: ShellSummary['verb']; detail: string; path?: string }

/** Splits on whitespace outside quotes; returns null on constructs we do not model (heredocs, redirects, substitutions). */
function tokenize(statement: string): string[] | null {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let started = false
  for (let i = 0; i < statement.length; i++) {
    const ch = statement[i]!
    if (quote) {
      if (ch === quote) quote = null
      else current += ch
    } else if (ch === '"' || ch === "'") { quote = ch; started = true }
    else if (/\s/.test(ch)) { if (started || current) tokens.push(current); current = ''; started = false }
    else if (ch === '>' || ch === '<' || ch === '`' || (ch === '$' && statement[i + 1] === '(')) return null
    else current += ch
  }
  if (quote) return null
  if (started || current) tokens.push(current)
  return tokens
}

/** Statements split on ; && || and newlines; pipes stay inside a statement. */
function splitStatements(command: string): string[] | null {
  const statements: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!
    if (quote) { current += ch; if (ch === quote) quote = null; continue }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue }
    const two = command.slice(i, i + 2)
    if (two === '&&' || two === '||') { statements.push(current); current = ''; i++; continue }
    if (ch === ';' || ch === '\n') { statements.push(current); current = ''; continue }
    if (ch === '&') return null
    current += ch
  }
  statements.push(current)
  return statements.map(s => s.trim()).filter(Boolean)
}

const baseName = (path: string) => path.replace(/\/+$/, '').split('/').pop() || path
const isFlag = (token: string) => token.startsWith('-')

function stepFor(statement: string): Step | null {
  // Only the head of a pipeline names what is being looked at; head/sort/wc after it just trim.
  const head = splitPipeline(statement)[0] ?? ''
  const tokens = tokenize(head)
  if (!tokens || tokens.length === 0) return null
  const [cmd, ...args] = tokens
  const operands = args.filter(t => !isFlag(t))
  switch (cmd) {
    case 'sed': {
      if (!args.includes('-n')) return null
      const range = /^(\d+)(?:,(\d+))?p$/.exec(operands[0] ?? '')
      const file = operands[1]
      if (!range || !file) return null
      return { verb: 'Read', detail: `${baseName(file)}:${range[1]}${range[2] ? `–${range[2]}` : ''}`, path: file }
    }
    case 'cat': case 'head': case 'tail': case 'bat': case 'less': case 'nl': {
      const file = [...operands].reverse().find(t => !/^[+-]?\d+$/.test(t))
      return file ? { verb: 'Read', detail: baseName(file), path: file } : null
    }
    case 'grep': case 'rg': case 'ag': {
      const pattern = operands[0]
      return pattern ? { verb: 'Searched', detail: `"${pattern.length > 32 ? `${pattern.slice(0, 31)}…` : pattern}"` } : null
    }
    case 'ls': case 'tree': return { verb: 'Listed', detail: operands[0] ? baseName(operands[0]) : '.' }
    case 'find': return { verb: 'Listed', detail: operands[0] && !operands[0].startsWith('-') ? baseName(operands[0]) : '.' }
    default: return null
  }
}

function splitPipeline(statement: string): string[] {
  const parts: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  for (let i = 0; i < statement.length; i++) {
    const ch = statement[i]!
    if (quote) { current += ch; if (ch === quote) quote = null; continue }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue }
    if (ch === '|') { parts.push(current); current = ''; continue }
    current += ch
  }
  parts.push(current)
  return parts
}

/** Returns null unless every statement is a recognised read-only lookup, so a write is never softened. */
export function summarizeShellCommand(rawCommand: string): ShellSummary | null {
  // Row text arrives as `$ command`, and cut to width with a trailing `…`.
  let command = rawCommand.replace(/^\$\s+/, '')
  const cut = command.endsWith('…')
  if (cut) {
    command = command.slice(0, -1)
    // Drop the statement the cut landed in; it is counted as one more below.
    const lastBreak = Math.max(command.lastIndexOf(';'), command.lastIndexOf('&&'), command.lastIndexOf('||'))
    if (lastBreak < 0) return summarizeWrites(rawCommand.replace(/^\$\s+/, ''))
    command = command.slice(0, lastBreak)
  }
  const statements = splitStatements(command)
  if (!statements || statements.length === 0) return null
  const steps: Step[] = []
  for (const statement of statements) {
    const step = stepFor(statement)
    if (!step) return summarizeWrites(rawCommand.replace(/^\$\s+/, ''))
    steps.push(step)
  }
  const first = steps[0]!
  const more = steps.length - 1 + (cut ? 1 : 0)
  return { verb: first.verb, detail: `${first.detail}${more > 0 ? ` · ${more} more` : ''}`, path: first.path }
}

/** A command that visibly rewrites files reads as the edit it is. */
function summarizeWrites(command: string): ShellSummary | null {
  const files = shellWrittenFiles(command.replace(/…$/, ''))
  if (files.length === 0) return null
  return { verb: 'Edited', detail: `${baseName(files[0]!.path)}${files.length > 1 ? ` · ${files.length - 1} more` : ''}` }
}
