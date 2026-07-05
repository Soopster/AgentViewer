import { createContext } from 'react'
import type { ThreadedMessage } from '@/lib/threading'
import type { PierreChangeStyle, PierreInlineDiffStyle } from './PierreDiffView'

export const LiveSubagentTextContext = createContext<Record<string, string>>({})
export const TaskActiveFormsContext = createContext<Map<string, string>>(new Map())

export type DiffOptions = {
  changeStyle: PierreChangeStyle
  inlineDiffStyle: PierreInlineDiffStyle
  showBackgrounds: boolean
  wrap: boolean
  showLineNumbers: boolean
  showHunkHeaders: boolean
}

export const DEFAULT_DIFF_OPTIONS: DiffOptions = {
  changeStyle: 'classic',
  inlineDiffStyle: 'word-alt',
  showBackgrounds: true,
  wrap: true,
  showLineNumbers: true,
  showHunkHeaders: true,
}

export type DiffCommentComposerSend = (prompt: string) => void

export const DiffCommentComposerContext = createContext<DiffCommentComposerSend | null>(null)

/**
 * Scan threaded messages for TaskCreate/TaskUpdate calls and build a
 * taskId → activeForm map reflecting the most recent activeForm set for each
 * task. Used by the TaskList renderer to substitute the present-continuous form
 * when a task is in_progress.
 */
export function buildTaskActiveFormsForWeb(messages: ThreadedMessage[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const m of messages) {
    for (const b of m.blocks) {
      if (b.type !== 'tool_thread') continue
      const name = b.toolUse.name
      if (name === 'TaskCreate') {
        const inp = b.toolUse.input as { activeForm?: string }
        const af = typeof inp.activeForm === 'string' ? inp.activeForm.trim() : ''
        if (!af || !b.result) continue
        const text = typeof b.result.content === 'string'
          ? b.result.content
          : Array.isArray(b.result.content)
          ? b.result.content.map((c) => (c && typeof c === 'object' && 'text' in c && typeof (c as { text: unknown }).text === 'string') ? (c as { text: string }).text : '').join('')
          : ''
        try {
          const parsed = JSON.parse(text) as { task?: { id?: string } }
          const id = parsed?.task?.id
          if (typeof id === 'string' && id) map.set(id, af)
        } catch { /* skip */ }
      } else if (name === 'TaskUpdate') {
        const inp = b.toolUse.input as { taskId?: string; activeForm?: string }
        const af = typeof inp.activeForm === 'string' ? inp.activeForm.trim() : ''
        if (typeof inp.taskId === 'string' && af) map.set(inp.taskId, af)
      }
    }
  }
  return map
}
