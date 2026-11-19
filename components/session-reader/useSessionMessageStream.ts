import { useEffect, useState, type RefObject } from 'react'
import type { Todo as OpenCodeTodo } from '@opencode-ai/sdk'
import { sessionIdentityKey } from '@/lib/sessionIdentity'
import type { Session } from '@/lib/types'
import {
  connectSessionMessageStream,
  MESSAGE_POLL_BACKFILL,
  type MessageStreamPayload,
  type SessionPlan,
} from './messageStream'

type StreamSnapshot = {
  key: string
  todos?: OpenCodeTodo[]
  plan?: SessionPlan
}

type SessionMessageStreamOptions = {
  session: Session | null
  enabled: boolean
  messageCountRef: RefObject<number>
  onMessages: (payload: MessageStreamPayload, session: Session) => void
  poll: (session: Session, signal: AbortSignal) => Promise<void>
}

/** Stream metadata belongs to the complete provider/session identity. The
 * page supplies transcript updates; this hook owns task state and connection
 * lifetime without depending on reader layout or navigation state. */
export function useSessionMessageStream({
  session, enabled, messageCountRef, onMessages, poll,
}: SessionMessageStreamOptions) {
  const [snapshot, setSnapshot] = useState<StreamSnapshot | null>(null)
  const sessionId = session?.sessionId
  const provider = session?.provider
  const providerInstanceId = session?.providerInstanceId
  const pending = session?.isPending
  const key = session ? sessionIdentityKey(session) : null

  useEffect(() => {
    if (!sessionId || !key || !enabled || pending) return
    // Construct from identity fields so metadata refreshes do not reconnect.
    const target: Session = { sessionId, provider, providerInstanceId }
    setSnapshot({ key })
    return connectSessionMessageStream({
      session: target,
      getOffset: () => Math.max(0, messageCountRef.current - MESSAGE_POLL_BACKFILL),
      onMessages,
      poll,
      onTodos: todos => setSnapshot(previous => ({
        ...(previous?.key === key ? previous : { key }), todos,
      })),
      onPlan: plan => setSnapshot(previous => ({
        ...(previous?.key === key ? previous : { key }), plan,
      })),
    })
  }, [sessionId, provider, providerInstanceId, pending, key, enabled, messageCountRef, onMessages, poll])

  const current = snapshot?.key === key ? snapshot : null
  return {
    todos: current?.todos,
    plan: current?.plan?.plan.length ? current.plan : undefined,
  }
}
