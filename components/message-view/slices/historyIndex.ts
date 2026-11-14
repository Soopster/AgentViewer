import { sessionIdentityKey } from '@/lib/sessionIdentity'
import type { Session } from '../../../lib/types'
import { useState, useRef } from 'react'
import { usePresentationInterest } from '../../../lib/plugins/usePresentationInterest'
import { useChannelBridge } from '../../useChannelBridge'
import { type MentionResult } from '../types'

export type UseHistoryIndexGroupContext = {
  projectView: { key: string; sessionCount: number; providerMode: 'current' | 'all'; } | undefined
  session: Session | null
}

export function useHistoryIndexGroup(ctx: UseHistoryIndexGroupContext) {
  const {
    projectView, session,
  } = ctx

  const [historyIndex, setHistoryIndex] = useState(-1)
  const draftBeforeHistoryRef = useRef<{ text: string; cursorPos: number }>({ text: '', cursorPos: 0 })
  const [mentionQuery, setMentionQuery] = useState<{ start: number; query: string } | null>(null)
  const [mentionResults, setMentionResults] = useState<MentionResult[]>([])
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0)
  const mentionAbortRef = useRef<AbortController | null>(null)
  const mentionItemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const channelPresentation = usePresentationInterest()
  const canUseChannelBridge = !projectView && !!session && (session.provider ?? 'claude') === 'claude'
  const channelBridge = useChannelBridge({
    open: channelPresentation.count > 0,
    available: canUseChannelBridge,
    sessionId: session?.sessionId,
    ownerKey: session ? sessionIdentityKey(session) : undefined,
  })
  // Read the latest bridge controller from inside sendMessage without widening
  // its (already large) dependency array.
  const channelBridgeRef = useRef(channelBridge)

  return {
    historyIndex, setHistoryIndex, draftBeforeHistoryRef, mentionQuery, setMentionQuery,
    mentionResults, setMentionResults, mentionActiveIndex, setMentionActiveIndex, mentionAbortRef,
    mentionItemRefs, canUseChannelBridge, channelBridge, channelBridgeRef,
    acquireChannelBridgeView: channelPresentation.acquire,
  }
}
