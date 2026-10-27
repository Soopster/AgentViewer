/** @jsxImportSource @opentui/react */
import { useMemo } from 'react'
import { type SendState } from '../../../../lib/types'
import { type RewindCandidate } from '../../rewindTargets'
import { type SlashCommandSuggestion } from '../../../../lib/slashCommands'
import { type ComposerDraftSnapshot, type TuiLiveToolActivity, type TuiMentionResult } from '../types'

export type UseComposerMentionVisibleCountGroupContext = {
  composerMentionResults: TuiMentionResult[]
  composerSlashCommands: SlashCommandSuggestion[]
  sentHistory: ComposerDraftSnapshot[]
  composerStash: ComposerDraftSnapshot[]
  composerRewindItems: RewindCandidate[] | null
  presentationHidesComposer: boolean
  composerWindowOpen: boolean
  composerActive: boolean
  composerMention: { start: number; query: string; } | null
  composerSlashOpen: boolean
  composerHistoryOpen: boolean
  composerStashOpen: boolean
  liveSubagentText: Record<string, string>
  liveToolActivities: TuiLiveToolActivity[]
  composerActivitySessionKey: string | null
  selectedSessionIdentity: string | null
  composerSendState: SendState
}

export function useComposerMentionVisibleCountGroup(ctx: UseComposerMentionVisibleCountGroupContext) {
  const {
    composerMentionResults, composerSlashCommands, sentHistory, composerStash, composerRewindItems,
    presentationHidesComposer, composerWindowOpen, composerActive, composerMention,
    composerSlashOpen, composerHistoryOpen, composerStashOpen, liveSubagentText,
    liveToolActivities, composerActivitySessionKey, selectedSessionIdentity, composerSendState,
  } = ctx

  const composerMentionVisibleCount = Math.min(composerMentionResults.length, 5)
  const composerSlashVisibleCount = Math.min(composerSlashCommands.length, 5)
  const composerHistoryVisibleCount = Math.min(sentHistory.length, 6)
  const composerStashVisibleCount = Math.min(composerStash.length, 6)
  const composerRewindVisibleCount = Math.min(composerRewindItems?.length ?? 0, 6)
  const composerPopoverHeight = presentationHidesComposer ? 0 : (!composerWindowOpen && composerActive && composerMention && composerMentionVisibleCount > 0)
    ? composerMentionVisibleCount + 3
    : (!composerWindowOpen && composerActive && composerSlashOpen && composerSlashVisibleCount > 0 && !composerMention && !composerHistoryOpen && !composerStashOpen)
    ? composerSlashVisibleCount + 3
    : (!composerWindowOpen && composerActive && composerHistoryOpen && composerHistoryVisibleCount > 0 && !composerMention)
    ? composerHistoryVisibleCount + 3
    : (!composerWindowOpen && composerActive && composerStashOpen && composerStashVisibleCount > 0 && !composerMention)
    ? composerStashVisibleCount + 3
    : (!composerWindowOpen && composerActive && composerRewindVisibleCount > 0)
    ? composerRewindVisibleCount + 3
    : 0
  // Status indicators (requesting spinner, subagent tail, live-prompt
  // suggestion, composer status, auto-targeting note) render as siblings
  // *between* the scrollbox and the composer. They each take fixed rows when
  // visible — we must subtract them from mainContentHeight so the transcript
  // shrinks instead of pushing the composer off-screen.
  const hasSubagentTail = useMemo(
    () => Object.values(liveSubagentText).some((t) => t.trim().length > 0),
    [liveSubagentText],
  )
  const activeRunningToolCount = useMemo(
    () => liveToolActivities.reduce((n, a) => (a.status === 'running' ? n + 1 : n), 0),
    [liveToolActivities],
  )
  const composerActivityVisible = Boolean(
    composerActivitySessionKey
    && selectedSessionIdentity === composerActivitySessionKey,
  )
  const visibleComposerSending = composerActivityVisible && composerSendState === 'sending'

  return {
    composerMentionVisibleCount, composerSlashVisibleCount, composerHistoryVisibleCount,
    composerStashVisibleCount, composerRewindVisibleCount, composerPopoverHeight, hasSubagentTail,
    activeRunningToolCount, composerActivityVisible, visibleComposerSending,
  }
}
