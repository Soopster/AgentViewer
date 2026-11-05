import type { TuiTranscriptCardLine, TuiTranscriptLineTone } from './types'
import { line, truncateLine, compactOneLine } from './text'

type TodoStatus = 'completed' | 'in_progress' | 'pending' | 'other'

type NormalizedTodo = { status: TodoStatus; content: string; activeForm: string }

// Mirrors the web TodoWriteCard's glyphs (components/MessageItem.tsx) so a todo
// list reads the same on both surfaces. All BMP so Windows terminals keep them.
const TODO_GLYPH: Record<TodoStatus, string> = {
  completed: '✓',
  in_progress: '◐',
  pending: '○',
  other: '·',
}

const TODO_TONE: Record<TodoStatus, TuiTranscriptLineTone> = {
  completed: 'dim',
  in_progress: 'default',
  pending: 'muted',
  other: 'muted',
}

function readTodoItems(input: Record<string, unknown>): NormalizedTodo[] {
  const todos = Array.isArray(input.todos) ? input.todos : []
  return todos.map((todo): NormalizedTodo => {
    if (!todo || typeof todo !== 'object' || Array.isArray(todo)) {
      return { status: 'other', content: '', activeForm: '' }
    }
    const record = todo as Record<string, unknown>
    const raw = typeof record.status === 'string' ? record.status.toLowerCase() : ''
    const status: TodoStatus = raw === 'completed' || raw === 'done'
      ? 'completed'
      : raw === 'in_progress' || raw === 'running' || raw === 'active'
        ? 'in_progress'
        : raw === 'pending' || raw === 'todo'
          ? 'pending'
          : 'other'
    return {
      status,
      content: typeof record.content === 'string' ? record.content : '',
      activeForm: typeof record.activeForm === 'string' ? record.activeForm : '',
    }
  })
}

export function formatTodoCounts(input: Record<string, unknown>): string | null {
  const items = readTodoItems(input)
  if (items.length === 0) return null
  const counts = { completed: 0, in_progress: 0, pending: 0, other: 0 }
  for (const item of items) counts[item.status] += 1
  const parts = [
    counts.completed > 0 ? `${counts.completed} done` : '',
    counts.in_progress > 0 ? `${counts.in_progress} active` : '',
    counts.pending > 0 ? `${counts.pending} pending` : '',
    counts.other > 0 ? `${counts.other} other` : '',
  ].filter(Boolean)
  return parts.join(' · ') || `${items.length} todo${items.length === 1 ? '' : 's'}`
}

/**
 * The checklist itself, one line per todo. Previews stay two lines like every
 * other tool here, so this is what expanding a TodoWrite card reveals — the
 * plan, not just a tally of it.
 */
export function formatTodoChecklist(input: Record<string, unknown>): TuiTranscriptCardLine[] {
  return readTodoItems(input).map((item) => {
    const text = item.content.trim() || item.activeForm.trim()
    return line(`  ${TODO_GLYPH[item.status]} ${truncateLine(text || '(untitled todo)')}`, TODO_TONE[item.status])
  })
}

/**
 * Preview subtitle: name the todo actually being worked on rather than only
 * tallying statuses. That one line is what the native CLI keeps on screen, and
 * it is the difference between "3 todos" and knowing what the agent is doing.
 */
export function formatTodoSubtitle(input: Record<string, unknown>): string | null {
  const counts = formatTodoCounts(input)
  const active = readTodoItems(input).find((item) => item.status === 'in_progress')
  const label = active ? (active.activeForm.trim() || active.content.trim()) : ''
  if (!label) return counts
  return `${TODO_GLYPH.in_progress} ${compactOneLine(label, 72)}${counts ? ` · ${counts}` : ''}`
}
