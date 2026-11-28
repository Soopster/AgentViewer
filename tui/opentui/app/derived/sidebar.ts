/** @jsxImportSource @opentui/react */
import type { WaitingSession } from '../../../../lib/sessionRuntime'
import type { ViewerAttentionNote } from '../../../../lib/viewerAttention'
import type { RefObject } from 'react'
import React from 'react'
import { type RunningSessionRef } from '../../../../lib/types'
import { attentionItemNeedsInput, type AttentionItem } from '../../AttentionInboxPopover'
import { sessionKey } from '../sessionList'

export type SidebarSessionActivityContext = {
  attentionItems: AttentionItem[]
  runningSessions: RunningSessionRef[]
  waitingSessions: WaitingSession[]
  viewerAttentionNotes: ViewerAttentionNote[]
  sidebarSessionActivityRef: React.RefObject<Map<string, 'waiting' | 'needs-input' | 'running'>>
}

export function runSidebarSessionActivity(ctx: SidebarSessionActivityContext) {
  const {
    attentionItems, runningSessions, waitingSessions, viewerAttentionNotes,
    sidebarSessionActivityRef,
  } = ctx
  const needsInputKeys = new Set(
    attentionItems.filter(attentionItemNeedsInput).map((item) => item.sessionKey),
  )
  const activity = new Map<string, 'needs-input' | 'running' | 'waiting'>()
  for (const running of runningSessions) {
    const key = sessionKey(running)
    activity.set(key, needsInputKeys.has(key) ? 'needs-input' : 'running')
  }
  for (const waiting of waitingSessions) {
    const key = sessionKey(waiting)
    if (!activity.has(key)) activity.set(key, needsInputKeys.has(key) ? 'needs-input' : 'waiting')
  }
  for (const note of viewerAttentionNotes) {
    const key = sessionKey(note)
    if (!activity.has(key)) activity.set(key, 'needs-input')
  }
  // The same map when nothing changed: the attention items are rebuilt on
  // every selection (they name the composer's target), and a new map here
  // rebuilt every sidebar row.
  const previous = sidebarSessionActivityRef.current
  if (previous.size === activity.size && [...activity].every(([key, value]) => previous.get(key) === value)) return previous
  sidebarSessionActivityRef.current = activity
  return activity
}
