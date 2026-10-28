'use client'

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import type { ProtocolAgent } from '@/lib/agentProtocol'
import type { Session, SessionMessage } from '@/lib/types'
import { sessionMessageWindowSignature } from '@/lib/sessionMessageWindow'
import { Button } from '@/components/ui/button'

const MessageView = dynamic(() => import('./MessageView'), { loading: () => <p role="status">Loading teammate conversation…</p> })

/** A separate mounted reader preserves the lead's composer and scroll anchor. */
export default function CoordinatorInspector({ agent, onClose }: { agent: ProtocolAgent; onClose: () => void }) {
  const [messages, setMessages] = useState<SessionMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const session = useMemo<Session>(() => ({
    sessionId: agent.sessionId, provider: agent.provider, cwd: agent.worktreePath,
    createdAt: 0, lastModified: 0, summary: agent.name,
  }), [agent.sessionId, agent.provider, agent.worktreePath, agent.name])
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function refresh() {
      try {
        const response = await fetch(`/api/sessions/${encodeURIComponent(session.sessionId)}/messages?provider=${session.provider}&tail=1&limit=500`, { signal: controller.signal, cache: 'no-store' })
        if (!response.ok) throw new Error('Could not load teammate transcript')
        const data = await response.json()
        if (!controller.signal.aborted) { setMessages(previous => previous.length === data.messages.length && previous.every((message, index) => message.uuid === data.messages[index].uuid && sessionMessageWindowSignature(message) === sessionMessageWindowSignature(data.messages[index])) ? previous : data.messages); setError(''); setLoading(false) }
      } catch (error) {
        if (!controller.signal.aborted) { setError(error instanceof Error ? error.message : 'Transcript unavailable'); setLoading(false) }
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(refresh, 2000)
      }
    }
    void refresh()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [session])
  return <section className="av-coord-inspector" aria-label={`${agent.name} conversation`}>
    <div className="av-coord-inspector-heading"><strong>{agent.name} · {agent.provider}</strong><Button variant="outline" size="sm" onClick={onClose}>Close teammate</Button></div>
    {error ? <p role="alert">{error}</p> : null}
    <div className="av-coord-inspector-body">
      <MessageView messages={messages} loading={loading} session={session} hideCoordinator maximized />
    </div>
  </section>
}
