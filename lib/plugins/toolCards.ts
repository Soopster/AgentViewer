// Plugin tool cards on the read path. A transcript window is annotated with each
// plugin's presentation of its tool calls (ToolUseBlock.pluginCard) before it is
// returned, so the Web and the TUI — and a mod's server-side hook — share one
// answer, drawn by each renderer's generic plugin card.
//
// Reads run on every poll, so answers are cached per tool call (a call's input
// does not change once made) and nothing runs while no enabled plugin presents
// tool cards. Messages are copied before annotation: the transcript cache
// shares its objects with every reader.
import { subscribePluginEnablement } from './enablement'
import type { AgentProvider, ContentBlock, PluginToolCard, SessionMessage, ToolUseBlock } from '../types'

const CACHE_MAX = 4_000
const cache = new Map<string, PluginToolCard | null>()
// A plugin turned off or on changes what a call reads as.
subscribePluginEnablement(() => cache.clear())

export async function annotatePluginToolCards(provider: AgentProvider, providerInstanceId: string | undefined, sessionId: string, messages: SessionMessage[]): Promise<SessionMessage[]> {
  const { pluginBehaviorHost } = await import('./serverBehaviors')
  const host = pluginBehaviorHost()
  if (!host.presentsToolCards()) return messages
  const target = { provider, sessionId, ...(providerInstanceId ? { providerInstanceId } : {}) }
  const out: SessionMessage[] = []
  for (const message of messages) {
    const content = (message.message as { content?: unknown })?.content
    if (!Array.isArray(content) || !content.some((block: ContentBlock) => block?.type === 'tool_use')) { out.push(message); continue }
    let changed = false
    const next = await Promise.all((content as ContentBlock[]).map(async (block) => {
      if (block?.type !== 'tool_use') return block
      const tool = block as ToolUseBlock
      const key = `${provider}@${providerInstanceId ?? ''}:${sessionId}:${tool.id}`
      let card: PluginToolCard | null | undefined = cache.get(key)
      if (card === undefined) {
        const answered = await host.toolCard({ target, tool: { id: tool.id, name: tool.name, input: tool.input ?? {} } })
        const fresh: PluginToolCard | null = answered ? { pluginId: answered.pluginId, title: answered.title ?? tool.name, lines: answered.lines, tone: answered.tone } : null
        card = fresh
        cache.set(key, fresh)
        if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!)
      }
      if (!card) return block
      changed = true
      return { ...tool, pluginCard: card }
    }))
    out.push(changed ? { ...message, message: { ...(message.message as object), content: next } } as SessionMessage : message)
  }
  return out
}

/** Forget cached answers (a plugin turned off or on changes what a call reads as). */
export function clearPluginToolCardCache(): void { cache.clear() }
