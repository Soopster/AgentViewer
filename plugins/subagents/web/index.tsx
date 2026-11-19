'use client'

// Web entry for Subagent transcripts: a session's captured subagents, and the
// conversation of the one selected — what each was asked, every tool call it
// made with its result, and what it answered.
import { useEffect, useState } from 'react'
import { PLUGIN_API_VERSION, type PluginViewModule } from '@/lib/plugins/types'
import type { WebPluginView, WebPluginViewProps } from '@/components/shell/pluginTypes'
import type { SessionMessage, SubagentSummary } from '@/lib/types'

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
type Block = { type?: string; text?: string; name?: string; input?: Record<string, unknown>; content?: unknown; is_error?: boolean }
const blocksOf = (entry: SessionMessage): Block[] => {
  const content = (entry.message as { content?: unknown } | undefined)?.content
  return Array.isArray(content) ? content as Block[] : typeof content === 'string' ? [{ type: 'text', text: content }] : []
}
const resultText = (content: unknown): string => typeof content === 'string' ? content
  : Array.isArray(content) ? content.map(part => (part as { text?: string }).text ?? '').join('\n') : ''
const clip = (text: string, max = 1200) => (text.length > max ? `${text.slice(0, max)}\n… ${text.length - max} more characters` : text)
const subject = (input: Record<string, unknown> = {}) => ['command', 'file_path', 'path', 'pattern', 'url', 'description', 'prompt'].map(key => input[key]).find((value): value is string => typeof value === 'string' && value.trim().length > 0) ?? ''

function Transcript({ messages }: { messages: SessionMessage[] }) {
  const rows = messages.flatMap(entry => blocksOf(entry).map((block, index) => ({ key: `${entry.uuid}:${index}`, role: entry.type, block })))
  if (rows.length === 0) return <div style={{ color: 'var(--text-2)' }}>No messages were captured for this subagent.</div>
  return <>{rows.map(({ key, role, block }) => {
    if (block.type === 'text' && block.text?.trim()) {
      return <div key={key} data-subagent-row={role} style={{ margin: '8px 0', whiteSpace: 'pre-wrap', color: role === 'user' ? 'var(--text)' : 'var(--text-2)' }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: role === 'user' ? 'var(--cyan, #39c5cf)' : 'var(--green, #3fb950)' }}>{role === 'user' ? 'Asked' : 'Answered'}</div>
        {clip(block.text)}
      </div>
    }
    if (block.type === 'tool_use') {
      return <div key={key} data-subagent-tool={block.name} style={{ margin: '4px 0', fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}>
        <span style={{ color: 'var(--amber, #d29922)' }}>{block.name}</span> <span style={{ color: 'var(--text-2)' }}>{clip(subject(block.input), 200)}</span>
      </div>
    }
    if (block.type === 'tool_result') {
      const text = resultText(block.content).trim()
      return text ? <pre key={key} style={{ margin: '2px 0 6px 14px', fontSize: 11, maxHeight: 160, overflow: 'auto', whiteSpace: 'pre-wrap', color: block.is_error ? 'var(--red, #f85149)' : 'var(--text-2)', borderLeft: '2px solid var(--border)', paddingLeft: 8 }}>{clip(text, 2000)}</pre> : null
    }
    return null
  })}</>
}

function Subagents({ services, placement, close, useState: useScopedState }: WebPluginViewProps) {
  const session = services.session?.session ?? null
  const transcripts = services['subagent-transcript']!
  const docked = placement !== 'overlay'
  const [list, setList] = useState<SubagentSummary[] | null>(null)
  const [selected, setSelected] = useScopedState<string | null>('agent', null)
  const [messages, setMessages] = useState<SessionMessage[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setList(null)
    if (!session) return undefined
    const controller = new AbortController()
    transcripts.list(session, controller.signal)
      .then(next => { if (!controller.signal.aborted) { setList(next); if (!next.some(agent => agent.agentId === selected)) setSelected(next[0]?.agentId ?? null) } })
      .catch(cause => { if (!controller.signal.aborted) setError(message(cause)) })
    return () => controller.abort()
  }, [transcripts, session?.provider, session?.sessionId])
  useEffect(() => {
    setMessages(null)
    if (!session || !selected) return undefined
    const controller = new AbortController()
    transcripts.load(session, selected, controller.signal)
      .then(next => { if (!controller.signal.aborted) setMessages(next) })
      .catch(cause => { if (!controller.signal.aborted) setError(message(cause)) })
    return () => controller.abort()
  }, [transcripts, session?.provider, session?.sessionId, selected])
  useEffect(() => {
    if (docked) return undefined
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [docked, close])

  const body = (
    <div data-plugin-view="subagents" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--surface)', color: 'var(--text)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontWeight: 600, flex: 1 }}>Subagent transcripts{list ? ` · ${list.length}` : ''}</span>
        {!docked ? <button type="button" aria-label="Close" onClick={close} style={{ fontSize: 12 }}>✕</button> : null}
      </div>
      {!session ? <div style={{ padding: 14, color: 'var(--text-2)' }}>Select a session.</div>
        : error ? <div role="status" style={{ padding: 14, color: 'var(--red, #f85149)' }}>{error}</div>
        : list === null ? <div style={{ padding: 14, color: 'var(--text-2)' }}>Reading subagents…</div>
        : list.length === 0 ? <div style={{ padding: 14, color: 'var(--text-2)' }}>This session started no subagents.</div>
        : (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 280px) 1fr', minHeight: 0, flex: 1 }}>
            <div style={{ overflow: 'auto', borderRight: '1px solid var(--border)' }}>
              {list.map(agent => (
                <button key={agent.agentId} type="button" data-subagent={agent.agentId} onClick={() => setSelected(agent.agentId)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 12px', border: 'none', borderBottom: '1px solid var(--border)', background: agent.agentId === selected ? 'var(--surface-3)' : 'transparent', color: 'var(--text)', cursor: 'pointer' }}>
                  <div style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{agent.taskDescription || agent.agentId}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-2)' }}>{agent.messageCount} messages · {Math.round((agent.usage.totalTokens ?? agent.usage.inputTokens + agent.usage.outputTokens) / 1000)}k tokens</div>
                </button>
              ))}
            </div>
            <div style={{ overflow: 'auto', padding: '10px 14px', fontSize: 13, minWidth: 0 }}>
              {messages === null ? <div style={{ color: 'var(--text-2)' }}>Reading the transcript…</div> : <Transcript messages={messages} />}
            </div>
          </div>
        )}
    </div>
  )
  if (docked) return body
  return (
    <div role="dialog" aria-label="Subagent transcripts" onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)' }}>
      <div onClick={event => event.stopPropagation()} style={{ width: 'min(1000px, calc(100vw - 32px))', height: 'min(740px, calc(100vh - 48px))', border: '1px solid var(--border-2)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 16px 48px var(--shadow, rgba(0,0,0,0.3))' }}>{body}</div>
    </div>
  )
}

export const module: PluginViewModule<WebPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'subagents',
  views: { subagents: Subagents },
}
