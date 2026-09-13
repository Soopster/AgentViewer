import { randomUUID } from 'node:crypto'
import type { AgentProvider } from './types'

export type ViewerAttentionNote = {
  id: string
  sessionId: string
  provider: AgentProvider
  title: string
  detail?: string
  createdAt: number
}

const MAX_NOTES = 100
const NOTE_TTL_MS = 24 * 60 * 60 * 1000

declare global {
  // eslint-disable-next-line no-var
  var __agentViewerAttentionNotes: Map<string, ViewerAttentionNote> | undefined
}

function notes(): Map<string, ViewerAttentionNote> {
  return (globalThis.__agentViewerAttentionNotes ??= new Map())
}

function prune(now = Date.now()): void {
  const store = notes()
  for (const [id, note] of store) {
    if (now - note.createdAt > NOTE_TTL_MS) store.delete(id)
  }
  while (store.size > MAX_NOTES) {
    const oldest = store.keys().next().value
    if (oldest === undefined) break
    store.delete(oldest)
  }
}

export function postViewerAttention(input: {
  sessionId: string
  provider?: AgentProvider
  title: string
  detail?: string
}): ViewerAttentionNote {
  const note: ViewerAttentionNote = {
    id: randomUUID(),
    sessionId: input.sessionId,
    provider: input.provider ?? 'claude',
    title: input.title.trim().slice(0, 160),
    detail: input.detail?.trim().slice(0, 1000) || undefined,
    createdAt: Date.now(),
  }
  notes().set(note.id, note)
  prune(note.createdAt)
  return note
}

export function listViewerAttention(): ViewerAttentionNote[] {
  prune()
  return [...notes().values()].sort((a, b) => b.createdAt - a.createdAt)
}

export function dismissViewerAttention(id: string): boolean {
  return notes().delete(id)
}
