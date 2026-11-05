/** @jsxImportSource @opentui/react */
import type { RefObject } from 'react'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { SyntaxStyle } from '@opentui/core'
import type { TuiThemePalette } from '../../../theme'
import type { ProviderComposerConfig } from '../../../../lib/providerComposer'
import type { QuietWorkspaceState } from '../../workspaceContext'
import React from 'react'
import { type TextareaRenderable } from '@opentui/core'
import { type TuiTranscriptCard } from '../../../format'
import { type TuiTranscriptView } from '../../../theme'
import { type WindowChrome } from '../../windowChrome'
import { type ContextUsage, type SendAttachment, type Session } from '../../../../lib/types'
import { type RewindCandidate } from '../../rewindTargets'
import { type SlashCommandSuggestion } from '../../../../lib/slashCommands'
import { type ComposerPromptPart, type QueuedComposerSend, type ComposerDraftSnapshot, type TuiMentionResult } from '../types'
import { type InlineTextSegment } from '../inlineText'
import { runRenderComposerSlashPanel, runRenderComposerHistoryPanel, runRenderComposerStashPanel, runRenderComposerMentionPanel, runRenderComposerQueuePanel, runRenderComposerRewindPanel, runRenderComposerTextarea } from '../actions/composerPanels'
import { runReaderHeaderChrome, runEmbeddedComposerChrome, runReaderFooterChrome } from '../derived/readerChrome'

export type UseSubmitComposerFromDockGroupContext = {
  pickSlashInsteadOfSubmit: () => boolean
  sendComposerMessage: (draftOverride?: string, attachmentsOverride?: SendAttachment[], isRetry?: boolean, promptPartsOverride?: ComposerPromptPart[], retryTurnRequestId?: string) => Promise<void>
  composerTextareaRef: React.RefObject<TextareaRenderable | null>
  composerDraft: string
  composerTargetSession: Session | null
  rememberComposerCursor: () => void
  setComposerWindowOpen: React.Dispatch<React.SetStateAction<boolean>>
  composerActive: boolean
  windowControlMode: 'identify' | 'manage' | null
  composerPlaceholder: string
  composerSyntaxStyle: SyntaxStyle
  theme: TuiThemePalette
  handleComposerContentChange: () => void
  composerChatTextareaStyle: { backgroundColor: string; focusedBackgroundColor: string; flexGrow: number; textColor: string; focusedTextColor: string; placeholderColor: string; }
  composerBaseTextareaStyle: { backgroundColor: string; textColor: string; focusedBackgroundColor: string; focusedTextColor: string; placeholderColor: string; }
  composerDockTextareaStyle: { backgroundColor: string; focusedBackgroundColor: string; flexGrow: number; textColor: string; focusedTextColor: string; placeholderColor: string; }
  composerMention: { start: number; query: string; } | null
  composerMentionVisibleCount: number
  composerMentionResults: TuiMentionResult[]
  composerMentionIndex: number
  composerAccentColor: string
  composerConfig: ProviderComposerConfig
  composerProvider: 'claude' | 'acp' | 'codex' | 'opencode' | 'copilot' | 'pi' | 'lmstudio' | 'claude-acp' | 'codex-acp' | null
  composerSlashOpen: boolean
  composerSlashVisibleCount: number
  composerSlashCommands: SlashCommandSuggestion[]
  composerSlashIndex: number
  composerHistoryOpen: boolean
  composerHistoryVisibleCount: number
  sentHistory: ComposerDraftSnapshot[]
  composerHistoryIndex: number
  composerRewindItems: RewindCandidate[] | null
  composerRewindVisibleCount: number
  composerRewindIndex: number
  composerStashOpen: boolean
  composerStashVisibleCount: number
  composerStash: ComposerDraftSnapshot[]
  composerStashIndex: number
  activeQueuedComposerSends: QueuedComposerSend[]
  composerQueueDurable: boolean
  composerWindowOpen: boolean
  composerHidden: boolean
  presentationHidesComposer: boolean
  embeddedComposer: boolean
  composerDockHeight: number
  chatComposerFocused: boolean
  setComposerActive: React.Dispatch<React.SetStateAction<boolean>>
  composerDockTextareaHeight: number
  chatComposerStatusWidth: number
  chatComposerStatsWidth: number
  composerSlashHint: string
  clickComposerStatus: (event: { button: number; x: number; currentTarget: { x: number; } | null; stopPropagation: () => void; }, segments: InlineTextSegment[], width: number) => void
  composerDockStatsFor: (draftLength: number) => InlineTextSegment[]
  composerDraftState: QuietWorkspaceState
  hoverComposerStatus: (site: 'chat' | 'dock', event: { x: number; currentTarget: { x: number; } | null; }, segments: InlineTextSegment[], width: number) => void
  setComposerStatusHover: React.Dispatch<React.SetStateAction<{ site: 'chat' | 'dock'; index: number; } | null>>
  composerStatusHover: { site: 'chat' | 'dock'; index: number; } | null
  chatComposerHintWidth: number
  visibleComposerSending: boolean
  composerDockSendingHintSegments: InlineTextSegment[] | null
  chatComposerHintFitted: string
  presentationFocusMode: boolean
  isStreamView: boolean
  contextUsage: ContextUsage | null
  selectedSession: Session | null
  contextUsageStatus: 'idle' | 'loading' | 'unavailable' | 'ready'
  followTail: boolean
  isScrollbackView: boolean
  pendingNewCount: number
  isCopilotView: boolean
  fleetStripVisible: boolean
  error: string | null
  showToolCalls: boolean
  normalizedSearchQuery: string
  providerAccent: string
  showTabs: boolean
  transcriptView: TuiTranscriptView
  readerTitle: string
  readerContextMeta: string
  fleetStripSegments: InlineTextSegment[]
  setShowToolCalls: React.Dispatch<React.SetStateAction<boolean>>
  setError: React.Dispatch<React.SetStateAction<string | null>>
  searchQuery: string
  searchMatches: number[]
  searchMatchIndex: number
  visibleTranscriptCards: TuiTranscriptCard[]
  turnRunningForComposer: boolean
  chatTurnStatusRows: 1 | 0
  densityState: { cardGap: number; bodyIndent: number; bodyLines: number; headerRows: number; bodyPad: number; streamGap: number; streamUserGap: number; }
  composerSendStartedAt: number | null
  composerWaitingStatusSeed: string
  composerWaitingSuffix: string | null
  composerWaitingOnUser: 'Waiting for your answer' | 'Waiting for your approval' | null
  visibleAwaitingPersistedTurn: boolean
  selectedSessionKey: string | null
}

export function useSubmitComposerFromDockGroup(ctx: UseSubmitComposerFromDockGroupContext) {
  const {
    pickSlashInsteadOfSubmit, sendComposerMessage, composerTextareaRef, composerDraft,
    composerTargetSession, rememberComposerCursor, setComposerWindowOpen, composerActive,
    windowControlMode, composerPlaceholder, composerSyntaxStyle, theme,
    handleComposerContentChange, composerChatTextareaStyle, composerBaseTextareaStyle,
    composerDockTextareaStyle, composerMention, composerMentionVisibleCount,
    composerMentionResults, composerMentionIndex, composerAccentColor, composerConfig,
    composerProvider, composerSlashOpen, composerSlashVisibleCount, composerSlashCommands,
    composerSlashIndex, composerHistoryOpen, composerHistoryVisibleCount, sentHistory,
    composerHistoryIndex, composerRewindItems, composerRewindVisibleCount, composerRewindIndex,
    composerStashOpen, composerStashVisibleCount, composerStash, composerStashIndex,
    activeQueuedComposerSends, composerQueueDurable, composerWindowOpen, composerHidden,
    presentationHidesComposer, embeddedComposer, composerDockHeight, chatComposerFocused,
    setComposerActive, composerDockTextareaHeight, chatComposerStatusWidth, chatComposerStatsWidth,
    composerSlashHint, clickComposerStatus, composerDockStatsFor, composerDraftState,
    hoverComposerStatus, setComposerStatusHover, composerStatusHover, chatComposerHintWidth,
    visibleComposerSending, composerDockSendingHintSegments, chatComposerHintFitted,
    presentationFocusMode, isStreamView, contextUsage, selectedSession, contextUsageStatus,
    followTail, isScrollbackView, pendingNewCount, isCopilotView, fleetStripVisible, error,
    showToolCalls, normalizedSearchQuery, providerAccent, showTabs, transcriptView, readerTitle,
    readerContextMeta, fleetStripSegments, setShowToolCalls, setError, searchQuery, searchMatches,
    searchMatchIndex, visibleTranscriptCards, turnRunningForComposer, chatTurnStatusRows,
    densityState, composerSendStartedAt, composerWaitingStatusSeed, composerWaitingSuffix,
    composerWaitingOnUser, visibleAwaitingPersistedTurn, selectedSessionKey,
  } = ctx

  const submitComposerFromDock = () => {
    if (pickSlashInsteadOfSubmit()) return
    void sendComposerMessage(composerTextareaRef.current?.plainText ?? composerDraft)
  }
  const submitComposerFromWindow = () => {
    if (pickSlashInsteadOfSubmit()) return
    const draft = composerTextareaRef.current?.plainText ?? composerDraft
    if (draft.trim() && composerTargetSession) {
      rememberComposerCursor()
      setComposerWindowOpen(false)
    }
    void sendComposerMessage(draft)
  }
  // Same test the send path applies (`bangShell`).
  const composerShellDraft = composerDraft.startsWith('!')
  const renderComposerTextarea = (onSubmit: () => void, options?: { height?: number; width?: number; variant?: 'chat'; background?: string }) => runRenderComposerTextarea({
    composerTextareaRef, composerActive, windowControlMode, composerPlaceholder, composerDraft,
    composerSyntaxStyle, composerShellDraft, theme, handleComposerContentChange,
    composerChatTextareaStyle, composerBaseTextareaStyle, composerDockTextareaStyle,
  }, onSubmit, options)
  const renderComposerMentionPanel = (panelWidth: number, rowWidth: number) => runRenderComposerMentionPanel({
    composerActive, composerMention, composerMentionVisibleCount, composerMentionResults,
    composerMentionIndex, theme, composerAccentColor, composerConfig, composerProvider,
  }, panelWidth, rowWidth)
  const renderComposerSlashPanel = (panelWidth: number, rowWidth: number) => runRenderComposerSlashPanel({
    composerActive, composerSlashOpen, composerSlashVisibleCount, composerMention,
    composerSlashCommands, composerSlashIndex, theme, composerAccentColor, composerConfig,
  }, panelWidth, rowWidth)
  const renderComposerHistoryPanel = (panelWidth: number, rowWidth: number) => runRenderComposerHistoryPanel({
    composerActive, composerHistoryOpen, composerHistoryVisibleCount, composerMention, sentHistory,
    composerHistoryIndex, theme, composerAccentColor,
  }, panelWidth, rowWidth)
  const renderComposerRewindPanel = (panelWidth: number, rowWidth: number) => runRenderComposerRewindPanel({
    composerActive, composerRewindItems, composerRewindVisibleCount, composerRewindIndex, theme,
    composerAccentColor,
  }, panelWidth, rowWidth)
  const renderComposerStashPanel = (panelWidth: number, rowWidth: number) => runRenderComposerStashPanel({
    composerActive, composerStashOpen, composerStashVisibleCount, composerMention, composerStash,
    composerStashIndex, theme, composerAccentColor,
  }, panelWidth, rowWidth)
  // Always-visible queued-send list (no modal): shows what will fire after the
  // current turn, in order, with the ⌃Y edit / ⇧⌃Y clear hint.
  const renderComposerQueuePanel = (panelWidth: number, rowWidth: number) => runRenderComposerQueuePanel({
    composerActive, activeQueuedComposerSends, theme, composerQueueDurable, composerAccentColor,
  }, panelWidth, rowWidth)


  // The active transcript uses the same controls in a tiled or floating window,
  // independently of the tool tab displayed elsewhere in the layout.
  // Chat and Agents: the composer is the transcript window's own trailing child
  // — a full-width highlighted bar in the same style as a user message row,
  // inside the same border as the transcript, so it reads as the next line of
  // the conversation rather than a docked control.
  const embeddedComposerChrome: WindowChrome | null = runEmbeddedComposerChrome({
    composerWindowOpen, composerHidden, presentationHidesComposer, embeddedComposer,
    composerDockHeight, theme, chatComposerFocused, composerActive, setComposerActive,
    composerTextareaRef, renderComposerTextarea, submitComposerFromDock,
    composerDockTextareaHeight, chatComposerStatusWidth, chatComposerStatsWidth, composerSlashHint,
    clickComposerStatus, composerDockStatsFor, composerDraftState, hoverComposerStatus,
    setComposerStatusHover, composerAccentColor, composerStatusHover, chatComposerHintWidth,
    visibleComposerSending, composerDockSendingHintSegments, chatComposerHintFitted,
  })
  // The reader's chrome above and below the transcript, as rows the window
  // holding the transcript gives up (counted from the conditions that draw it).
  const contextRowShown = !presentationFocusMode && !isStreamView && (Boolean(contextUsage)
    || (selectedSession?.provider === 'claude' && (contextUsageStatus === 'loading' || contextUsageStatus === 'unavailable')))
  const tailBannerShown = !followTail && (!isScrollbackView || pendingNewCount > 0)
  const readerHeaderChrome: WindowChrome = runReaderHeaderChrome({
    presentationFocusMode, isCopilotView, isStreamView, contextRowShown, fleetStripVisible, error,
    showToolCalls, tailBannerShown, normalizedSearchQuery, theme, providerAccent, showTabs,
    transcriptView, followTail, readerTitle, readerContextMeta, contextUsage, selectedSession,
    contextUsageStatus, fleetStripSegments, setShowToolCalls, setError, isScrollbackView,
    pendingNewCount, searchQuery, searchMatches, searchMatchIndex,
  })
  const idleTickerShown = followTail && visibleTranscriptCards.length > 0 && !turnRunningForComposer && !embeddedComposer && !isStreamView
  const readerFooterChrome: WindowChrome = runReaderFooterChrome({
    chatTurnStatusRows, idleTickerShown, embeddedComposerChrome, densityState, theme,
    visibleComposerSending, composerSendStartedAt, composerWaitingStatusSeed,
    composerWaitingSuffix, composerWaitingOnUser, visibleAwaitingPersistedTurn, followTail,
    visibleTranscriptCards, turnRunningForComposer, embeddedComposer, isStreamView,
    selectedSessionKey,
  })

  return {
    submitComposerFromDock, submitComposerFromWindow, renderComposerTextarea,
    renderComposerMentionPanel, renderComposerSlashPanel, renderComposerHistoryPanel,
    renderComposerRewindPanel, renderComposerStashPanel, renderComposerQueuePanel,
    readerHeaderChrome, readerFooterChrome,
  }
}
