/** @jsxImportSource @opentui/react */
import type { RefObject } from 'react'
import type { WaitingSession } from '../../../../lib/sessionRuntime'
import type { ViewerAttentionNote } from '../../../../lib/viewerAttention'
import React from 'react'
import { formatSessionTitle } from '../../../format'
import { type AgentProvider, type RunningSessionRef, type Session } from '../../../../lib/types'
import { attentionItemNeedsInput, type AttentionItem } from '../../AttentionInboxPopover'
import { sessionKey } from '../sessionList'

export type FleetEntriesContext = {
  attentionItems: AttentionItem[]
  runningSessions: RunningSessionRef[]
  sessionsByKeyRef: React.RefObject<Map<string, Session>>
  waitingSessions: WaitingSession[]
  viewerAttentionNotes: ViewerAttentionNote[]
  attentionDone: { key: string; sessionId: string; provider: AgentProvider; sessionKey: string; title: string; createdAt: number; }[]
}

export function runFleetEntries(ctx: FleetEntriesContext) {
  const {
    attentionItems, runningSessions, sessionsByKeyRef, waitingSessions, viewerAttentionNotes,
    attentionDone,
  } = ctx
  const needsInputKeys = new Set(
    attentionItems.filter(attentionItemNeedsInput).map((item) => item.sessionKey),
  )
  const entries: Array<{
    key: string
    sessionId: string
    provider: AgentProvider
    title: string
    status: 'needs-input' | 'running' | 'waiting' | 'done'
  }> = runningSessions.map((ref) => {
    const key = sessionKey({ sessionId: ref.sessionId, provider: ref.provider })
    const session = sessionsByKeyRef.current.get(key)
    return {
      key,
      sessionId: ref.sessionId,
      provider: ref.provider,
      title: session ? formatSessionTitle(session) : ref.sessionId.slice(-8),
      status: needsInputKeys.has(key) ? 'needs-input' as const : 'running' as const,
    }
  })
  const liveKeys = new Set(entries.map((entry) => entry.key))
  for (const waiting of waitingSessions) {
    const key = sessionKey(waiting)
    if (liveKeys.has(key)) continue
    const session = sessionsByKeyRef.current.get(key)
    entries.push({
      key,
      sessionId: waiting.sessionId,
      provider: waiting.provider,
      title: session ? formatSessionTitle(session) : waiting.sessionId.slice(-8),
      status: needsInputKeys.has(key) ? 'needs-input' : 'waiting',
    })
    liveKeys.add(key)
  }
  for (const note of viewerAttentionNotes) {
    const key = sessionKey(note)
    if (liveKeys.has(key)) continue
    const session = sessionsByKeyRef.current.get(key)
    entries.push({
      key,
      sessionId: note.sessionId,
      provider: note.provider,
      title: session ? formatSessionTitle(session) : note.sessionId.slice(-8),
      status: 'needs-input',
    })
    liveKeys.add(key)
  }
  for (const done of attentionDone) {
    if (liveKeys.has(done.sessionKey)) continue
    entries.push({
      key: done.sessionKey,
      sessionId: done.sessionId,
      provider: done.provider,
      title: done.title,
      status: 'done' as const,
    })
  }
  // Blocked cells first — they are why the strip exists.
  return entries.sort((a, b) => {
    const rank = (status: string) => (status === 'needs-input' ? 0 : status === 'running' ? 1 : status === 'waiting' ? 2 : 3)
    return rank(a.status) - rank(b.status)
  })
// eslint-disable-next-line react-hooks/exhaustive-deps
}
