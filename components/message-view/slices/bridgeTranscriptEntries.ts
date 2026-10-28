import type { ComposerSessions } from '../../../lib/composerSessions'
import { type ContextComposerHandle } from '../../ContextComposer'
import { useState, useRef } from 'react'
import { type SendAttachment } from '@/lib/types'
import { type SlashCommandSuggestion } from '@/lib/slashCommands'

export type UseBridgeTranscriptEntriesGroupContext = {
  composerSessions: ComposerSessions
  composerOwnerKey: string
  inputText: string
}

export function useBridgeTranscriptEntriesGroup(ctx: UseBridgeTranscriptEntriesGroupContext) {
  const {
    composerSessions, composerOwnerKey, inputText,
  } = ctx

  // Track bridge entries (sent + replies) with timestamps for inline transcript display
  const [bridgeTranscriptEntries, setBridgeTranscriptEntries] = useState<
    Array<{ kind: 'sent' | 'reply'; text: string; timestamp: string }>
  >([])
  const persistedBridgeCountRef = useRef(0)
  const [slashOpen, setSlashOpen] = useState(false)
  const [slashActiveIndex, setSlashActiveIndex] = useState(0)
  const slashItemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [liveSlashCommands, setLiveSlashCommands] = useState<SlashCommandSuggestion[]>([])
  const textareaRef = composerSessions.ref<ContextComposerHandle | null>(composerOwnerKey, 'textareaRef', null)
  const composerPrewarmInFlightRef = useRef(new Set<string>())
  const isComposingRef = useRef(false)
  const timelineRef = useRef<HTMLDivElement>(null)
  const timelineContentRef = useRef<HTMLDivElement | null>(null)
  const lastTimelineRowRef = useRef<HTMLDivElement | null>(null)
  const abortControllerRef = composerSessions.ref<AbortController | null>(composerOwnerKey, 'abortControllerRef', null)
  const activeTurnRequestIdRef = composerSessions.ref<string | null>(composerOwnerKey, 'activeTurnRequestIdRef', null)
  const inputTextRef = composerSessions.ref(composerOwnerKey, 'inputTextRef', inputText)
  const suppressDraftSaveRef = useRef(false)
  const sendInFlightRef = composerSessions.ref(composerOwnerKey, 'sendInFlightRef', false)
  const awaitingPersistedTurnRef = composerSessions.ref(composerOwnerKey, 'awaitingPersistedTurnRef', false)
  const pushedCopilotAttachmentsRef = composerSessions.ref<SendAttachment[]>(composerOwnerKey, 'pushedCopilotAttachmentsRef', [])

  return {
    bridgeTranscriptEntries, setBridgeTranscriptEntries, persistedBridgeCountRef, slashOpen,
    setSlashOpen, slashActiveIndex, setSlashActiveIndex, slashItemRefs, liveSlashCommands,
    setLiveSlashCommands, textareaRef, composerPrewarmInFlightRef, isComposingRef, timelineRef,
    timelineContentRef, lastTimelineRowRef, abortControllerRef, activeTurnRequestIdRef,
    inputTextRef, suppressDraftSaveRef, sendInFlightRef, awaitingPersistedTurnRef,
    pushedCopilotAttachmentsRef,
  }
}
