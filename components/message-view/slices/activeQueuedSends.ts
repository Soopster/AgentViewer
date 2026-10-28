import type { ComposerSessions } from '../../../lib/composerSessions'
import { useMemo } from 'react'
import { useComposerSessionState } from '@/lib/composerSessions'
import { selectComposerQueueTarget } from '@/lib/composerAttachments'
import { type QueuedWebSend, type FailedSend } from '../types'

export type UseActiveQueuedSendsGroupContext = {
  queuedSends: QueuedWebSend[]
  composerQueueTargetKey: string | null
  composerSessions: ComposerSessions
  composerOwnerKey: string
}

export function useActiveQueuedSendsGroup(ctx: UseActiveQueuedSendsGroupContext) {
  const {
    queuedSends, composerQueueTargetKey, composerSessions, composerOwnerKey,
  } = ctx

  const activeQueuedSends = useMemo(
    () => selectComposerQueueTarget(queuedSends, composerQueueTargetKey),
    [composerQueueTargetKey, queuedSends],
  )
  // Last message delivered INTO the running turn via native steering — shown
  // in the composer status line while the turn is still streaming.
  const [steeredNotice, setSteeredNotice] = useComposerSessionState<string | null>(composerSessions, composerOwnerKey, 'steeredNotice', null)
  const [failedSend, setFailedSend] = useComposerSessionState<FailedSend | null>(composerSessions, composerOwnerKey, 'failedSend', null)

  return { activeQueuedSends, steeredNotice, setSteeredNotice, failedSend, setFailedSend }
}
