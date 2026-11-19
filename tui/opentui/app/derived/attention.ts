/** @jsxImportSource @opentui/react */
import type { RefObject } from 'react'
import type { WaitingSession } from '../../../../lib/sessionRuntime'
import type { ViewerAttentionNote } from '../../../../lib/viewerAttention'
import React from 'react'
import { formatSessionTitle } from '../../../format'
import { type AgentProvider, type Session } from '../../../../lib/types'
import { type AttentionItem } from '../../AttentionInboxPopover'
import { type PendingPermission } from '../../../../lib/permissions'
import { join } from 'node:path'
import { sessionKey } from '../sessionList'

export type AttentionItemsContext = {
  pendingPermissions: PendingPermission[]
  backgroundPrompts: PendingPermission[]
  composerTargetSession: Session | null
  sessionsByKeyRef: React.RefObject<Map<string, Session>>
  waitingSessions: WaitingSession[]
  viewerAttentionNotes: ViewerAttentionNote[]
  attentionDone: { key: string; sessionId: string; provider: AgentProvider; sessionKey: string; title: string; createdAt: number; }[]
}

export function runAttentionItems(ctx: AttentionItemsContext) {
  const {
    pendingPermissions, backgroundPrompts, composerTargetSession, sessionsByKeyRef,
    waitingSessions, viewerAttentionNotes, attentionDone,
  } = ctx
  const items: AttentionItem[] = []
  const seenPromptIds = new Set<string>()
  for (const prompt of [...pendingPermissions, ...backgroundPrompts]) {
    if (!prompt.id || seenPromptIds.has(prompt.id)) continue
    seenPromptIds.add(prompt.id)
    const promptProvider = prompt.provider ?? composerTargetSession?.provider ?? 'claude'
    // Stream-delivered prompts without a session id ride the composer's
    // current target — that is the turn that produced them.
    const sessionId = prompt.sessionId ?? composerTargetSession?.sessionId ?? ''
    const key = sessionKey({ sessionId, provider: promptProvider })
    const session = sessionsByKeyRef.current.get(key)
    items.push({
      key: `prompt:${prompt.id}`,
      kind: prompt.questions && prompt.questions.length > 0
        ? 'question'
        : prompt.toolName === 'ExitPlanMode'
        ? 'plan'
        : 'permission',
      sessionId,
      provider: promptProvider,
      sessionKey: key,
      sessionTitle: session ? formatSessionTitle(session) : sessionId.slice(-8) || 'unknown session',
      title: prompt.title,
      detail: prompt.detail ?? prompt.command ?? prompt.paths?.[0] ?? prompt.url,
      permission: prompt,
      createdAt: 0,
    })
  }
  for (const waiting of waitingSessions) {
    const key = sessionKey(waiting)
    const session = sessionsByKeyRef.current.get(key)
    const taskCount = waiting.backgroundTasks.length
    const cronCount = waiting.sessionCrons.length
    const details = [
      ...waiting.backgroundTasks.map((task) => task.description || `${task.type} ${task.status}`),
      ...waiting.sessionCrons.map((cron) => `scheduled ${cron.schedule}`),
    ]
    items.push({
      key: `waiting:${key}`,
      kind: 'waiting',
      sessionId: waiting.sessionId,
      provider: waiting.provider,
      sessionKey: key,
      sessionTitle: session ? formatSessionTitle(session) : waiting.sessionId.slice(-8),
      title: `${taskCount} background task${taskCount === 1 ? '' : 's'}, ${cronCount} scheduled wakeup${cronCount === 1 ? '' : 's'}`,
      detail: details.slice(0, 2).join(' · '),
      createdAt: waiting.updatedAt,
    })
  }
  for (const note of viewerAttentionNotes) {
    const key = sessionKey(note)
    const session = sessionsByKeyRef.current.get(key)
    items.push({
      key: `viewer:${note.id}`,
      kind: 'viewer-note',
      sessionId: note.sessionId,
      provider: note.provider,
      sessionKey: key,
      sessionTitle: session ? formatSessionTitle(session) : note.sessionId.slice(-8),
      title: note.title,
      detail: note.detail,
      attentionId: note.id,
      createdAt: note.createdAt,
    })
  }
  for (const done of attentionDone) {
    items.push({
      key: done.key,
      kind: 'turn-done',
      sessionId: done.sessionId,
      provider: done.provider,
      sessionKey: done.sessionKey,
      sessionTitle: done.title,
      title: 'Turn finished',
      createdAt: done.createdAt,
    })
  }
  return items
// eslint-disable-next-line react-hooks/exhaustive-deps
}
