import type { TuiTranscriptCard } from '../../format'
import type { AgentToolGroupCard } from './types'

export type StripTodo = { status: 'completed' | 'in_progress' | 'pending' | 'other'; text: string }
export type TaskStripState = { done: number; total: number; active: string | null; todos: StripTodo[] }

const GLYPH_STATUS: Record<string, StripTodo['status']> = { '✓': 'completed', '◐': 'in_progress', '○': 'pending', '·': 'other' }
export const TODO_STRIP_GLYPH: Record<StripTodo['status'], string> = { completed: '✓', in_progress: '◐', pending: '○', other: '·' }

function todosOf(card: TuiTranscriptCard): StripTodo[] | null {
  const lines = card.expandedLines.length > 0 ? card.expandedLines : card.lines
  if (!lines[0]?.text.startsWith('tool TodoWrite')) return null
  const todos: StripTodo[] = []
  for (const line of lines) {
    const match = line.text.match(/^ {2}(\S) (.*)$/)
    const status = match ? GLYPH_STATUS[match[1]!] : undefined
    if (status) todos.push({ status, text: match![2]!.trim() })
  }
  return todos
}

/** The open session's current todo list, read from its newest TodoWrite call (each call restates the whole list).
 * Null when there is none, or nothing is left to do — a finished plan earns no row. */
export function latestTaskStrip(cards: readonly TuiTranscriptCard[]): TaskStripState | null {
  for (let index = cards.length - 1; index >= 0; index -= 1) {
    const card = cards[index]!
    const inner = (card as AgentToolGroupCard).agentToolCards ?? [card]
    for (let at = inner.length - 1; at >= 0; at -= 1) {
      const todos = todosOf(inner[at]!)
      if (!todos) continue
      const done = todos.filter((todo) => todo.status === 'completed').length
      if (todos.length === 0 || done === todos.length) return null
      return { done, total: todos.length, active: todos.find((todo) => todo.status === 'in_progress')?.text ?? todos.find((todo) => todo.status === 'pending')?.text ?? null, todos }
    }
  }
  return null
}

export const TASK_STRIP_EXPANDED_MAX = 8
/** Rows the strip takes out of the pane's body. */
export function taskStripRows(state: TaskStripState | null, expanded: boolean): number {
  if (!state) return 0
  return expanded ? 1 + Math.min(state.todos.length, TASK_STRIP_EXPANDED_MAX) : 1
}
