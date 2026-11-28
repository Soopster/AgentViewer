import type { Session } from '../../../lib/types'
import { useState, useRef, useCallback } from 'react'
import { createComposerSessions } from '@/lib/composerSessions'
import { sessionIdentityKey } from '@/lib/sessionIdentity'

export type UseTeamAttentionGroupContext = {
  session: Session | null
}

export function useTeamAttentionGroup(ctx: UseTeamAttentionGroupContext) {
  const {
    session,
  } = ctx

  const [teamAttention, setTeamAttention] = useState({ sessionId: '', count: 0 })
  const updateTeamAttention = useCallback((count: number) => setTeamAttention(previous => previous.sessionId === session?.sessionId && previous.count === count ? previous : { sessionId: session?.sessionId ?? '', count }), [session?.sessionId])
  const [composerDock, setComposerDock] = useState({ sessionId: '', tab: 'chat' })
  const composerTab = composerDock.sessionId === session?.sessionId ? composerDock.tab : 'chat'
  const returnToChat = useCallback(() => setComposerDock({ sessionId: session?.sessionId ?? '', tab: 'chat' }), [session?.sessionId])
  const [composerSessions] = useState(createComposerSessions)
  const composerOwnerKey = session ? sessionIdentityKey(session) : 'unselected'
  const activeWebComposerOwnerRef = useRef(composerOwnerKey)

  return {
    teamAttention, updateTeamAttention, setComposerDock, composerTab, returnToChat,
    composerSessions, composerOwnerKey, activeWebComposerOwnerRef,
  }
}
