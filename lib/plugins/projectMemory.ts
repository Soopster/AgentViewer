import type { PluginSessionRef } from './bookmarks'
import type { SessionMessage } from '../types'
export type ProjectMemorySource = PluginSessionRef & { messageUuid?: string }
export type MemoryKind = 'decision' | 'convention' | 'lesson'
/** `author` missing means a person wrote it (every note stored before agents could write). */
export type ProjectMemoryNote = { id: string; version: number; title: string; body: string; kind: MemoryKind; pinned: boolean; reviewed: boolean; author?: 'person' | 'agent'; source?: ProjectMemorySource; createdAt: number; updatedAt: number }
/** `agentMemory` missing means on: agents keep their own memory unless a person turned it off for the project. */
export type ProjectMemorySnapshot = { sequence: number; autoRecall: boolean; agentMemory?: boolean; notes: ProjectMemoryNote[] }
export type MemoryDraft = Pick<ProjectMemoryNote, 'id' | 'title' | 'body' | 'kind' | 'pinned' | 'source'> & { expectedVersion: number }
export type MemoryOperation =
  | { type: 'save'; note: MemoryDraft }
  | { type: 'review'; id: string; expectedVersion: number; reviewed: boolean }
  | { type: 'delete'; id: string; expectedVersion: number }
  | { type: 'settings'; autoRecall?: boolean; agentMemory?: boolean; expectedSequence: number }
  /** An agent's own note, upserted by title. Never rewrites a person's note. */
  | { type: 'agent-remember'; title: string; body: string; kind: MemoryKind; source?: ProjectMemorySource }
  /** Deletes an agent's note by title. A person's note is refused. */
  | { type: 'agent-forget'; title: string }
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
export const isAgentNote = (note: ProjectMemoryNote): boolean => note.author === 'agent'
export const agentMemoryOn = (snapshot: Pick<ProjectMemorySnapshot, 'agentMemory'>): boolean => snapshot.agentMemory !== false
/** One spelling per title, so an agent remembering the same thing twice updates it. */
export const memoryTitleKey = (title: string): string => title.trim().toLowerCase().replace(/\s+/g, ' ')
/** Approved person notes when automatic recall is on; agent notes whenever agent memory is on. */
export function isRecallable(snapshot: ProjectMemorySnapshot, note: ProjectMemoryNote): boolean {
  return isAgentNote(note) ? agentMemoryOn(snapshot) : snapshot.autoRecall && note.reviewed
}
export const memoryRecallKey = (note: ProjectMemoryNote): string => `${note.id}@${note.version}`
const noteOrigin = (note: ProjectMemoryNote) => {
  const at = note.source ? `${note.source.provider}@${note.source.providerInstanceId ?? note.source.provider}/${note.source.sessionId}${note.source.messageUuid ? `#${note.source.messageUuid}` : ''}` : ''
  return isAgentNote(note) ? `agent-written${at ? ` in ${at}` : ''}` : at || 'user-maintained note'
}

/** How an agent writes to memory. Kept free of a complete tag, so this text is never itself parsed as one. */
export const MEMORY_PROTOCOL = [
  'You have a persistent memory for this project that survives across sessions and providers.',
  'When you learn something a future session would otherwise have to rediscover (a decision and its reason, a project convention, a gotcha or a fix that took real effort), save it by writing a memory tag in your reply: open with memory title="short unique title" kind="decision|convention|lesson" in angle brackets, put the note body after it, and close with /memory in angle brackets.',
  'Reusing a title updates that memory. To delete one of your memories that has become wrong, write forget title="its title" as a self-closing tag.',
  'Keep each memory short and self-contained. Never store secrets, credentials or personal data, and never store progress on the current task.',
].join(' ')

export type MemoryRecall = { text: string; keys: string[] }
/**
 * What to put in front of an agent. Bodies of the notes most relevant to `query` that it has not been shown
 * (`seen` holds `id@version`), and on a session's first turn an index of every recallable title plus the protocol.
 */
export function projectMemoryRecall(snapshot: ProjectMemorySnapshot, query: string, options: { first?: boolean; seen?: ReadonlySet<string> } = {}): MemoryRecall {
  const recallable = snapshot.notes.filter(note => isRecallable(snapshot, note))
  const seen = options.seen ?? new Set<string>()
  const parts: string[] = [], keys: string[] = []; let remaining = 8000
  for (const note of rankProjectMemory(recallable.filter(note => !seen.has(memoryRecallKey(note))), query).slice(0, 6)) {
    if (remaining < 200) break
    const entry = `### ${note.title}\nMemory ${note.id} v${note.version} · ${note.kind} · ${noteOrigin(note)}\n${note.body}`
    const included = entry.slice(0, remaining); parts.push(included); keys.push(memoryRecallKey(note)); remaining -= included.length + 2
  }
  const sections: string[] = []
  if (parts.length) sections.push(`Project memory notes. Use where relevant; the current request and session instructions take precedence.\n\n${parts.join('\n\n')}`)
  if (options.first) {
    const shown = new Set(keys), index: string[] = []; let budget = 2500
    for (const note of [...recallable].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)) {
      if (shown.has(memoryRecallKey(note))) continue
      const line = `- ${note.title} (${note.kind}${isAgentNote(note) ? ', agent' : ''})`
      if (line.length > budget) { index.push(`- …and ${recallable.length - shown.size - index.length} more`); break }
      index.push(line); budget -= line.length + 1
    }
    if (index.length) sections.push(`Other memories for this project (ask about any by title, or search with the project_memory_recall tool if you have it):\n${index.join('\n')}`)
    if (agentMemoryOn(snapshot)) sections.push(MEMORY_PROTOCOL)
  }
  return { text: sections.join('\n\n'), keys }
}
/** The memory most relevant to `query`, for a single read (the panel's preview and older callers). */
export function projectMemoryContext(snapshot: ProjectMemorySnapshot, query: string): string {
  return projectMemoryRecall(snapshot, query).text
}

export type MemoryTag = { op: 'remember'; title: string; kind: MemoryKind; body: string } | { op: 'forget'; title: string }
export const MEMORY_TAG_LIMITS = Object.freeze({ perTurn: 5, title: 200, body: 4000 })
const MEMORY_TAG = /<memory\s+title="([^"\n]{1,200})"(?:\s+kind="([a-z]+)")?\s*>([\s\S]*?)<\/memory>|<forget\s+title="([^"\n]{1,200})"\s*\/?>(?:<\/forget>)?/g
/** Memory tags an agent wrote in a reply. Code (fenced or inline) is skipped: an agent explaining the syntax is not using it. */
export function parseMemoryTags(text: string): MemoryTag[] {
  const prose = text.slice(0, 200_000).replace(/```[\s\S]*?(```|$)/g, match => ' '.repeat(match.length)).replace(/`[^`\n]*`/g, match => ' '.repeat(match.length))
  const tags: MemoryTag[] = []
  for (const match of prose.matchAll(MEMORY_TAG)) {
    if (tags.length >= MEMORY_TAG_LIMITS.perTurn) break
    if (match[4]) { tags.push({ op: 'forget', title: match[4].trim() }); continue }
    const title = match[1].trim(), body = match[3].trim().slice(0, MEMORY_TAG_LIMITS.body)
    const kind: MemoryKind = match[2] === 'decision' || match[2] === 'convention' ? match[2] : 'lesson'
    if (title && body) tags.push({ op: 'remember', title, kind, body })
  }
  return tags
}
/** The assistant text of the newest turn: every assistant message after the last prompt a person (or plugin) sent. */
export function latestTurnReply(messages: readonly SessionMessage[]): { text: string; uuid: string } | null {
  const texts: string[] = []; let uuid = ''
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i], content = message.message.content
    if (message.type === 'user') {
      const prompt = typeof content === 'string' || (Array.isArray(content) && content.some(part => part.type === 'text') && !content.some(part => part.type === 'tool_result'))
      if (prompt) break
      continue
    }
    if (message.type !== 'assistant' || message.ephemeral) continue
    const text = typeof content === 'string' ? content : Array.isArray(content) ? content.filter(part => part.type === 'text').map(part => 'text' in part ? part.text : '').join('\n\n') : ''
    if (text.trim()) { texts.unshift(text); uuid ||= message.uuid }
  }
  return texts.length ? { text: texts.join('\n\n'), uuid } : null
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
