import type { RefObject } from 'react'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { SessionComposerAgentOption } from '../../../lib/types'
import type { Session } from '../../../lib/types'
import { type MentionResult } from '../types'
import { type SlashCommandSuggestion } from '@/lib/slashCommands'
import { type MutableRefObject } from 'react'
import { type ContextComposerHandle } from '../../ContextComposer'
import { type SendState, type SendAttachment } from '@/lib/types'
import { type WebComposerQueueDurability } from '@/lib/webComposerQueue'
import { type QueuedWebSend } from '../types'
import { getWebComposerQueueStore } from '../composerStorage'

export type MentionSearchEffectContext = {
  mentionQuery: { start: number; query: string; } | null
  mentionAbortRef: RefObject<AbortController | null>
  setMentionResults: Dispatch<SetStateAction<MentionResult[]>>
  activeProvider: 'claude' | 'acp' | 'codex' | 'opencode' | 'copilot' | 'pi' | 'lmstudio' | 'claude-acp' | 'codex-acp' | undefined
  composerMentionAgentOptions: SessionComposerAgentOption[]
  session: Session | null
  setMentionActiveIndex: Dispatch<SetStateAction<number>>
}

export function runMentionSearchEffect(ctx: MentionSearchEffectContext) {
  const {
    mentionQuery, mentionAbortRef, setMentionResults, activeProvider, composerMentionAgentOptions,
    session, setMentionActiveIndex,
  } = ctx
  if (!mentionQuery) {
    mentionAbortRef.current?.abort()
    mentionAbortRef.current = null
    setMentionResults([])
    return
  }
  const agentMatches: MentionResult[] = activeProvider === 'opencode'
    ? composerMentionAgentOptions
        .filter((agent) => {
          const query = mentionQuery.query.toLowerCase()
          if (!query) return true
          return agent.value.toLowerCase().includes(query)
            || agent.label.toLowerCase().includes(query)
            || (agent.description?.toLowerCase().includes(query) ?? false)
        })
        .slice(0, 8)
        .map((agent) => ({
          kind: 'agent' as const,
          name: agent.value,
          description: agent.description,
          mode: agent.mode,
        }))
    : []
  const cwd = session?.cwd
  if (!cwd) {
    setMentionResults(agentMatches)
    setMentionActiveIndex(0)
    return
  }
  const controller = new AbortController()
  mentionAbortRef.current?.abort()
  mentionAbortRef.current = controller
  const url = `/api/files?cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent(mentionQuery.query)}`
  const handle = window.setTimeout(async () => {
    try {
      const res = await fetch(url, { signal: controller.signal })
      if (!res.ok) return
      const data = await res.json() as { files?: Array<{ path: string; basename: string }> }
      if (controller.signal.aborted) return
      const fileMatches: MentionResult[] = (data.files ?? []).map((file) => ({ kind: 'file', ...file }))
      setMentionResults([...agentMatches, ...fileMatches])
      setMentionActiveIndex(0)
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return
    }
  }, 80)
  return () => {
    window.clearTimeout(handle)
    controller.abort()
  }
}

export type SlashCommandsEffectContext = {
  commandSessionId: string | undefined
  setLiveSlashCommands: Dispatch<SetStateAction<SlashCommandSuggestion[]>>
  commandSessionProvider: 'claude' | 'acp' | 'codex' | 'opencode' | 'copilot' | 'pi' | 'lmstudio' | 'claude-acp' | 'codex-acp' | undefined
}

export function runSlashCommandsEffect(ctx: SlashCommandsEffectContext) {
  const {
    commandSessionId, setLiveSlashCommands, commandSessionProvider,
  } = ctx
  if (!commandSessionId) {
    setLiveSlashCommands([])
    return
  }
  const controller = new AbortController()
  const url = `/api/sessions/${commandSessionId}/commands?provider=${encodeURIComponent(commandSessionProvider ?? 'claude')}`
  void fetch(url, { signal: controller.signal })
    .then((res) => res.ok ? res.json() : null)
    .then((data) => {
      if (controller.signal.aborted || !data || !Array.isArray(data.commands)) return
      setLiveSlashCommands(data.commands.map((entry: { command: string; description: string; argumentHint?: string }) => ({
        command: entry.command,
        description: entry.description ?? '',
        argumentHint: entry.argumentHint && entry.argumentHint.trim() ? entry.argumentHint.trim() : undefined,
      })))
    })
    .catch(() => { /* ignore */ })
  return () => controller.abort()
}

export type QueuedSendsEffectContext = {
  activeQueuedSends: QueuedWebSend[]
  composerQueueStorageReady: boolean
  runningProbeReadyKey: string | null
  composerQueueTargetKey: string | null
  sendInFlightRef: MutableRefObject<boolean>
  awaitingPersistedTurnRef: MutableRefObject<boolean>
  reattachedRunning: boolean
  sendState: SendState
  awaitingPersistedTurn: boolean
  composerQueueClaimInFlightRef: RefObject<Set<string>>
  composerQueueCommitCounterRef: RefObject<number>
  queuedSendsRef: RefObject<QueuedWebSend[]>
  composerQueueMountedRef: RefObject<boolean>
  setQueuedSends: Dispatch<SetStateAction<QueuedWebSend[]>>
  setComposerQueueDurability: Dispatch<SetStateAction<WebComposerQueueDurability>>
  composerQueueTargetKeyRef: RefObject<string | null>
  commitQueuedSends: (next: QueuedWebSend[]) => void
  setInputText: Dispatch<SetStateAction<string>>
  inputTextRef: MutableRefObject<string>
  setAttachments: Dispatch<SetStateAction<SendAttachment[]>>
  textareaRef: MutableRefObject<ContextComposerHandle | null>
  resizeComposer: () => void
  sendMessage: (retryOverride?: { text: string; attachments: SendAttachment[]; turnRequestId?: string; }) => Promise<void>
}

export function runQueuedSendsEffect(ctx: QueuedSendsEffectContext) {
  const {
    activeQueuedSends, composerQueueStorageReady, runningProbeReadyKey, composerQueueTargetKey,
    sendInFlightRef, awaitingPersistedTurnRef, reattachedRunning, sendState, awaitingPersistedTurn,
    composerQueueClaimInFlightRef, composerQueueCommitCounterRef, queuedSendsRef,
    composerQueueMountedRef, setQueuedSends, setComposerQueueDurability, composerQueueTargetKeyRef,
    commitQueuedSends, setInputText, inputTextRef, setAttachments, textareaRef, resizeComposer,
    sendMessage,
  } = ctx
  if (activeQueuedSends.length === 0) return
  if (!composerQueueStorageReady || runningProbeReadyKey !== composerQueueTargetKey) return
  if (sendInFlightRef.current || awaitingPersistedTurnRef.current) return
  if (!composerQueueTargetKey) return
  // A turn we reattached to is still running server-side — flushing now would
  // start a second concurrent turn. Wait for the /running poll to clear.
  if (reattachedRunning) return
  // Gate on strict idle: flushing while sendState is 'error' would auto-fire
  // a queued send after a failed turn (and clobber the restored draft).
  if (sendState !== 'idle' || awaitingPersistedTurn) return
  const next = activeQueuedSends[0]!
  if (composerQueueClaimInFlightRef.current.has(next.id)) return
  composerQueueClaimInFlightRef.current.add(next.id)
  // Claim across browser tabs and persist the dequeue before provider I/O.
  // A stale tab that loses the claim updates to the authoritative queue and
  // never sends the same follow-up a second time.
  const claimedTargetKey = composerQueueTargetKey
  const store = getWebComposerQueueStore()
  void store.claim(claimedTargetKey, next.id).then((claim) => {
    composerQueueCommitCounterRef.current += 1
    queuedSendsRef.current = claim.entries
    if (composerQueueMountedRef.current) {
      setQueuedSends(claim.entries)
      setComposerQueueDurability(claim.durability)
    }
    if (!claim.claimed) return
    if (!composerQueueMountedRef.current || composerQueueTargetKeyRef.current !== claimedTargetKey) {
      // Navigation/session changes can occur while waiting for another tab's
      // lock. Put the unconsumed entry back instead of sending it through a
      // composer that now targets a different session.
      const restoredQueue = [next, ...claim.entries.filter((entry) => entry.id !== next.id)]
      if (composerQueueMountedRef.current) commitQueuedSends(restoredQueue)
      else store.commit(restoredQueue)
      return
    }
    setInputText(next.text)
    inputTextRef.current = next.text
    setAttachments(next.attachments)
    window.requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (ta) {
        ta.value = next.text
        ta.setSelectionRange(next.text.length, next.text.length)
      }
      resizeComposer()
      void sendMessage()
    })
  }).catch(() => {
    if (composerQueueMountedRef.current) setComposerQueueDurability('memory-only')
  }).finally(() => {
    composerQueueClaimInFlightRef.current.delete(next.id)
  })
}
