// Terminal formatting for plugin-contributed tool calls and blocks. tui/format.ts
// still formats the built-in tools itself, but asks this registry first, so a
// plugin can draw a tool the host knows nothing about (or replace a built-in
// card's lines) without touching the formatter. Both the Ink and OpenTUI
// transcripts read the same lines. Newest registration for a name wins;
// unregistering restores the previous one.
import type { ToolThread } from '../../lib/threading'
import type { TuiTranscriptCardLine } from './types'

export type TuiToolFormatter = {
  /** The collapsed card; null defers to the built-in formatting. */
  readonly preview?: (thread: ToolThread) => readonly TuiTranscriptCardLine[] | null
  /** The expanded card; null defers to the built-in formatting. */
  readonly expanded?: (thread: ToolThread) => readonly TuiTranscriptCardLine[] | null
}

type Entry = { readonly id: number; readonly formatter: TuiToolFormatter }
const entries = new Map<string, Entry[]>()
let nextId = 0
let version = 0

export function registerTuiToolFormatter(toolNames: readonly string[], formatter: TuiToolFormatter): () => void {
  const id = nextId++
  for (const name of toolNames) entries.set(name, [...(entries.get(name) ?? []), { id, formatter }])
  version++
  return () => {
    for (const name of toolNames) {
      const rest = (entries.get(name) ?? []).filter(entry => entry.id !== id)
      if (rest.length) entries.set(name, rest); else entries.delete(name)
    }
    version++
  }
}

/** Changes whenever a formatter is added or removed; a cache of formatted cards must key on it. */
export function tuiToolFormattersVersion(): number { return version }

function run(thread: ToolThread, mode: 'preview' | 'expanded'): TuiTranscriptCardLine[] | null {
  const stack = entries.get(thread.toolUse.name)
  if (!stack?.length) return null
  // Newest first; a formatter that declines (null) or throws hands the call to the next one, then to the built-ins.
  for (let at = stack.length - 1; at >= 0; at--) {
    try {
      const lines = stack[at]!.formatter[mode]?.(thread)
      if (lines) return [...lines]
    } catch { /* a faulty plugin formatter must not blank the transcript */ }
  }
  return null
}

export const formatRegisteredToolPreview = (thread: ToolThread) => run(thread, 'preview')
export const formatRegisteredToolExpanded = (thread: ToolThread) => run(thread, 'expanded')
