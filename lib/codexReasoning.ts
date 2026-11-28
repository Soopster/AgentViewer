import type { CodexNotification, CodexThreadTokenUsage } from './codexProtocol'
import type { ThinkingBlock, SessionMessage } from './types'

export type CodexReasoningMetadata = Record<string, NonNullable<ThinkingBlock['reasoning']>>
type Item = { id: string; summary: string[]; content: string[]; info: NonNullable<ThinkingBlock['reasoning']> & { startedAt: number } }

/** One tracker per owned turn. Counts are turn totals, never inferred from summary text. */
export function createCodexReasoningTracker(threadId: string, baseline?: CodexThreadTokenUsage) {
  const items = new Map<string, Item>()
  const emitted = new Map<string, string>()
  let initialTokens = baseline?.total?.reasoningOutputTokens
  let tokens: number | undefined
  let turnCompleted = false
  function messages(): SessionMessage[] {
    const entries = [...items.values()]
    return entries.map((item, index) => ({
      type: 'assistant', uuid: item.id, session_id: threadId, provider: 'codex', parent_tool_use_id: null,
      timestamp: new Date(item.info.startedAt).toISOString(),
      message: { role: 'assistant', content: [{ type: 'thinking', thinking: (item.summary.some(Boolean) ? item.summary : item.content).filter(Boolean).join('\n\n'),
        reasoningText: item.summary.some(Boolean) ? item.content.filter(Boolean).join('\n\n').trim() || undefined : undefined,
        reasoning: { ...item.info, ...(index === entries.length - 1 && tokens !== undefined ? { tokens, tokenScope: 'turn' as const } : {}) } }] },
    }))
  }
  return {
    update(notification: CodexNotification, now = Date.now()): SessionMessage[] {
      const p = notification.params as unknown as Record<string, unknown>
      const item = p.item as { id: string; type: string; summary?: string[]; content?: string[] } | undefined
      const turnId = typeof p.turnId === 'string' ? p.turnId : (p.turn as { id?: string } | undefined)?.id
      if (notification.method === 'thread/tokenUsage/updated') {
        const usage = p.tokenUsage as CodexThreadTokenUsage
        const total = usage.total?.reasoningOutputTokens
        const last = usage.last?.reasoningOutputTokens
        if (typeof total === 'number' && Number.isFinite(total)) {
          if (initialTokens === undefined) initialTokens = Math.max(0, total - (last ?? 0))
          if (total < initialTokens) initialTokens = Math.max(0, total - (last ?? 0))
          tokens = Math.max(0, total - initialTokens)
        }
      } else if (notification.method === 'turn/completed') {
        turnCompleted = true
        for (const entry of items.values()) entry.info.completedAt ??= now
      } else if (turnId) {
        const itemId = item?.id ?? (typeof p.itemId === 'string' ? p.itemId : undefined)
        const reasoningEvent = notification.method.startsWith('item/reasoning/') || item?.type === 'reasoning'
        if (!itemId || !reasoningEvent) return []
        const id = `${turnId}:${itemId}`
        let entry = items.get(id)
        if (!entry) {
          const startedAt = typeof p.startedAtMs === 'number' ? p.startedAtMs : now
          entry = { id, summary: [], content: [], info: { startedAt } }
          items.set(id, entry)
        }
        if (item?.type === 'reasoning') {
          entry.summary = [...(item.summary ?? entry.summary)]
          entry.content = [...(item.content ?? entry.content)]
        }
        if (typeof p.delta === 'string') {
          const summary = notification.method !== 'item/reasoning/textDelta'
          const parts = summary ? entry.summary : entry.content
          const index = Number(summary ? p.summaryIndex ?? 0 : p.contentIndex ?? 0)
          if (Number.isInteger(index) && index >= 0 && index < 10000) parts[index] = (parts[index] ?? '') + p.delta
        }
        if (notification.method === 'item/completed' || turnCompleted) entry.info.completedAt ??= typeof p.completedAtMs === 'number' ? p.completedAtMs : now
      } else return []
      return messages().filter(message => {
        const fingerprint = JSON.stringify(message)
        if (emitted.get(message.uuid) === fingerprint) return false
        emitted.set(message.uuid, fingerprint)
        return true
      })
    },
    metadata(): CodexReasoningMetadata {
      const entries = [...items.values()]
      return Object.fromEntries(entries.map((item, index) => [item.id, { ...item.info, ...(index === entries.length - 1 && tokens !== undefined ? { tokens, tokenScope: 'turn' as const } : {}) }]))
    },
  }
}
