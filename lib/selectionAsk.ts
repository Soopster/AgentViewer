// Prompts that hand an agent a precise piece of code: an editor selection, a
// line under the Git panel's diff cursor, or one step of a file's checkpoint
// history. Every surface builds through here so the agent always gets the
// same shape — what to do, which file and lines, the code itself, and whatever
// history explains who wrote it — and never a bare paste with no location.
//
// No Node imports: the TUI's editor and popovers build prompts on the render
// thread, and the data that needs a disk or the index arrives as arguments.

export type SelectionAskIntent = 'explain' | 'fix' | 'test' | 'review' | 'why' | 'ask'

export const SELECTION_ASK_INTENTS: ReadonlyArray<{ intent: SelectionAskIntent; label: string; key: string }> = [
  { intent: 'explain', label: 'Explain', key: 'e' },
  { intent: 'fix', label: 'Fix', key: 'f' },
  { intent: 'test', label: 'Write tests', key: 't' },
  { intent: 'review', label: 'Review', key: 'r' },
  { intent: 'why', label: 'Why was this written', key: 'w' },
  { intent: 'ask', label: 'Ask…', key: 'a' },
]

const INSTRUCTIONS: Record<Exclude<SelectionAskIntent, 'ask'>, string> = {
  explain: 'Explain what this code does, how it fits into the surrounding code, and anything non-obvious about it. Do not change any files.',
  fix: 'Find and fix what is wrong with this code. Read the surrounding code first, keep the change as small as the fix allows, and say what was wrong.',
  test: 'Write tests for this code that would catch a regression in it. Follow the conventions of the tests already in this repository, and run them.',
  review: 'Review this code for correctness bugs, unhandled cases and anything that would surprise the next reader. List findings most severe first; do not change any files.',
  why: 'Explain why this code was written the way it is. The recorded history of these lines is below — use it, and the sessions it names if you can read them, as the reason, and say plainly where it does not account for the code.',
}

/** One recorded writer of the lines: an agent turn, or a commit. */
export type SelectionHistoryEntry = {
  /** 1-based inclusive, in the code shown. Omitted when it covers all of it. */
  startLine?: number
  endLine?: number
  /** "Claude session \"title\"", "commit 1a2b3c4", … */
  source: string
  /** The prompt that started the turn, or the commit's subject. */
  text: string | null
  timestampMs?: number | null
}

export type SelectionAskInput = {
  intent: SelectionAskIntent
  filePath: string
  /** 1-based inclusive. */
  startLine: number
  endLine: number
  code: string
  /** The code is a unified diff rather than file content. */
  isDiff?: boolean
  language?: string
  /** Where the selection came from, so the agent can say what it was looking at. */
  origin?: string
  /** The editor holds edits the file on disk does not have yet. */
  unsaved?: boolean
  history?: SelectionHistoryEntry[]
}

const MAX_CODE_CHARS = 20_000
const MAX_HISTORY_ENTRIES = 12
const MAX_HISTORY_TEXT_CHARS = 400

/** A fence longer than any run of backticks inside the code, so the code cannot close it. */
export function codeFenceFor(code: string): string {
  let longest = 0
  for (const match of code.matchAll(/`+/g)) longest = Math.max(longest, match[0].length)
  return '`'.repeat(Math.max(3, longest + 1))
}

export function formatLineRange(startLine: number, endLine: number): string {
  return startLine === endLine ? `L${startLine}` : `L${startLine}-L${endLine}`
}

function trimCode(code: string): string {
  if (code.length <= MAX_CODE_CHARS) return code
  const head = Math.floor(MAX_CODE_CHARS * 0.65)
  const tail = MAX_CODE_CHARS - head
  return `${code.slice(0, head).trimEnd()}\n\n... ${code.length - MAX_CODE_CHARS} chars omitted ...\n\n${code.slice(code.length - tail).trimStart()}`
}

function formatHistoryEntry(entry: SelectionHistoryEntry): string {
  const range = entry.startLine !== undefined && entry.endLine !== undefined
    ? `${formatLineRange(entry.startLine, entry.endLine)}: `
    : ''
  const when = entry.timestampMs ? ` (${new Date(entry.timestampMs).toISOString().slice(0, 16).replace('T', ' ')})` : ''
  const raw = (entry.text ?? '').replace(/\s+/g, ' ').trim()
  const text = raw.length > MAX_HISTORY_TEXT_CHARS ? `${raw.slice(0, MAX_HISTORY_TEXT_CHARS - 1)}…` : raw
  return `- ${range}${entry.source}${when}${text ? ` — "${text}"` : ''}`
}

export function buildSelectionAskPrompt(input: SelectionAskInput): string {
  const lines: string[] = []
  if (input.intent !== 'ask') lines.push(INSTRUCTIONS[input.intent], '')
  lines.push(`File: ${input.filePath || '(unknown file)'}`)
  const notes = [input.origin, input.unsaved ? 'includes unsaved edits' : null].filter(Boolean)
  lines.push(`Lines: ${formatLineRange(input.startLine, input.endLine)}${notes.length > 0 ? ` (${notes.join('; ')})` : ''}`)

  if (input.intent === 'why' || (input.history && input.history.length > 0)) {
    lines.push('', 'History of these lines:')
    const history = input.history ?? []
    if (history.length === 0) lines.push('- No recorded agent turn or commit wrote these lines.')
    for (const entry of history.slice(0, MAX_HISTORY_ENTRIES)) lines.push(formatHistoryEntry(entry))
    if (history.length > MAX_HISTORY_ENTRIES) lines.push(`- … ${history.length - MAX_HISTORY_ENTRIES} more`)
  }

  const code = trimCode(input.code.replace(/\s+$/, ''))
  const fence = codeFenceFor(code)
  lines.push('', `${fence}${input.isDiff ? 'diff' : input.language ?? ''}`, code, fence)
  // A free question goes last, after the context, where the composer's cursor lands.
  if (input.intent === 'ask') lines.push('', 'Question: ')
  return lines.join('\n')
}
