import type { PluginSessionRef } from './bookmarks'
import type { SessionMessage } from '../types'
export type ProjectMemorySource = PluginSessionRef & { messageUuid?: string }
export type ProjectMemoryNote = { id: string; version: number; title: string; body: string; kind: 'decision' | 'convention' | 'lesson'; pinned: boolean; reviewed: boolean; source?: ProjectMemorySource; createdAt: number; updatedAt: number }
export type ProjectMemorySnapshot = { sequence: number; autoRecall: boolean; notes: ProjectMemoryNote[] }
export type MemoryDraft = Pick<ProjectMemoryNote, 'id' | 'title' | 'body' | 'kind' | 'pinned' | 'source'> & { expectedVersion: number }
export type MemoryOperation =
  | { type: 'save'; note: MemoryDraft }
  | { type: 'review'; id: string; expectedVersion: number; reviewed: boolean }
  | { type: 'delete'; id: string; expectedVersion: number }
  | { type: 'settings'; autoRecall: boolean; expectedSequence: number }
export type ProjectMemoryService = {
  read(cwd: string, signal?: AbortSignal): Promise<ProjectMemorySnapshot>
  mutate(cwd: string, requestId: string, operation: MemoryOperation, signal?: AbortSignal): Promise<ProjectMemorySnapshot>
}
export function blankMemory(): MemoryDraft { return { id: crypto.randomUUID(), expectedVersion: 0, title: '', body: '', kind: 'lesson', pinned: false } }
export function memoryDraft(note: ProjectMemoryNote): MemoryDraft { const { id, version, title, body, kind, pinned, source } = note; return { id, expectedVersion: version, title, body, kind, pinned, source } }
export function rankProjectMemory(notes: ProjectMemoryNote[], query: string, reviewedOnly = false): ProjectMemoryNote[] {
  const words = [...new Set(query.toLowerCase().slice(0, 10_000).match(/[\p{L}\p{N}]{3,}/gu) ?? [])].filter(word => !['the', 'and', 'for', 'this', 'that', 'with', 'from', 'please'].includes(word)).slice(0, 100)
  return notes.filter(note => !reviewedOnly || note.reviewed).map(note => {
    const title = note.title.toLowerCase(), body = note.body.toLowerCase()
    const matches = words.reduce((score, word) => score + (title.includes(word) ? 5 : body.includes(word) ? 1 : 0), 0)
    return { note, score: (note.pinned ? 10000 : 0) + matches }
  }).filter(item => !query.trim() || item.score > 0).sort((a, b) => b.score - a.score || b.note.updatedAt - a.note.updatedAt).map(item => item.note)
}
export function projectMemoryContext(snapshot: ProjectMemorySnapshot, query: string): string {
  if (!snapshot.autoRecall) return ''
  const parts: string[] = []; let remaining = 8000
  for (const note of rankProjectMemory(snapshot.notes, query, true).slice(0, 6)) {
    const origin = note.source ? `${note.source.provider}@${note.source.providerInstanceId ?? note.source.provider}/${note.source.sessionId}${note.source.messageUuid ? `#${note.source.messageUuid}` : ''}` : 'user-maintained note'
    const entry = `### ${note.title}\nMemory ${note.id} v${note.version} · ${note.kind} · ${origin}\n${note.body}`
    if (remaining < 200) break
    const included = entry.slice(0, remaining); parts.push(included); remaining -= included.length + 2
  }
  return parts.length ? `Reviewed project reference notes. Use where relevant; the current request and session instructions take precedence.\n\n${parts.join('\n\n')}` : ''
}
export function captureMemoryReply(messages: readonly SessionMessage[]): { text: string; uuid: string } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.type !== 'assistant' || message.ephemeral) continue
    const content = message.message.content
    const text = typeof content === 'string' ? content : Array.isArray(content) ? content.filter(part => part.type === 'text').map(part => 'text' in part ? part.text : '').join('\n\n') : ''
    if (text.trim()) return { text: text.slice(0, 6000), uuid: message.uuid }
  }
  return null
}
