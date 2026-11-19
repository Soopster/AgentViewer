/** @jsxImportSource @opentui/react */
import type { TuiThemePalette } from '../../../theme'
import type { ProviderComposerConfig } from '../../../../lib/providerComposer'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import React, { useMemo } from 'react'
import { type Session } from '../../../../lib/types'
import { fitText } from '../../textLayout'
import { type RewindCandidate } from '../../rewindTargets'
import { type SlashCommandSuggestion } from '../../../../lib/slashCommands'
import { join } from 'node:path'
import { type InlineTextSegment, composerSendingHintSegments } from '../inlineText'
import { footerDockStatsReserve, fitHintText } from '../contextMeter'
import { mixHexColor } from '../transcriptStyle'

export type UseComposerDockStatsForGroupContext = {
  buildComposerStatsSegments: (lineCount: number, draftLength: number) => InlineTextSegment[]
  composerVisualLineCount: number
  composerDraft: string
  composerKnobSegments: InlineTextSegment[]
  theme: TuiThemePalette
  composerLocationSegments: InlineTextSegment[]
  composerWindowVisualLineCount: number
  composerAttachmentLabel: string | null
  composerActive: boolean
  composerFocusBlocked: boolean
  fullscreenMode: boolean
  composerAccentColor: string
  routeComposerToBridge: boolean
  routeComposerToIde: boolean
  visibleComposerSending: boolean
  reattachedRunning: boolean
  composerDockTextareaWidth: number
  composerWindowWidth: number
  interruptPressActive: boolean
  composerConfig: ProviderComposerConfig
  composerTargetSession: Session | null
  visibleRunningToolCount: number
  canUseChannelBridge: boolean
  canUseIdeBridge: boolean
  composerKeysTargetTurn: boolean
  composerIdleFooterHint: string
  statusBarInDock: boolean
  commandChordPending: boolean
  splitChordPending: boolean
  attentionNeedsInputCount: number
  footerSegments: InlineTextSegment[]
  rightPaneWidth: number
  composerSlashHint: string
  composerWindowContentWidth: number
  composerRewindItems: RewindCandidate[] | null
  composerRewindIndex: number
  setComposerRewindItems: React.Dispatch<React.SetStateAction<RewindCandidate[] | null>>
  rewindToPrompt: (chosen: RewindCandidate, options?: { restoreFiles?: boolean; }) => Promise<void>
  composerSlashOpen: boolean
  composerSlashCommands: SlashCommandSuggestion[]
  composerFirstLine: string
  composerSlashIndex: number
  insertSlashAtCursor: (command: string) => void
}

export function useComposerDockStatsForGroup(ctx: UseComposerDockStatsForGroupContext) {
  const {
    buildComposerStatsSegments, composerVisualLineCount, composerDraft, composerKnobSegments,
    theme, composerLocationSegments, composerWindowVisualLineCount, composerAttachmentLabel,
    composerActive, composerFocusBlocked, fullscreenMode, composerAccentColor,
    routeComposerToBridge, routeComposerToIde, visibleComposerSending, reattachedRunning,
    composerDockTextareaWidth, composerWindowWidth, interruptPressActive, composerConfig,
    composerTargetSession, visibleRunningToolCount, canUseChannelBridge, canUseIdeBridge,
    composerKeysTargetTurn, composerIdleFooterHint, statusBarInDock, commandChordPending,
    splitChordPending, attentionNeedsInputCount, footerSegments, rightPaneWidth, composerSlashHint,
    composerWindowContentWidth, composerRewindItems, composerRewindIndex, setComposerRewindItems,
    rewindToPrompt, composerSlashOpen, composerSlashCommands, composerFirstLine,
    composerSlashIndex, insertSlashAtCursor,
  } = ctx

  // The stats row shows the character count, which changes on every key; the rows that draw it
  // take a builder and subscribe to the length themselves (DraftLengthSpans), so a keystroke
  // repaints them without rendering the root. The array below is the draft as of this render, for
  // the widths and hit-tests that only need it when something else has already rendered.
  const composerDockStatsFor = (draftLength: number): InlineTextSegment[] => buildComposerStatsSegments(composerVisualLineCount, draftLength)
  const composerDockStatsSegments = composerDockStatsFor(composerDraft.length)
  const composerWindowMetaSegments = useMemo<InlineTextSegment[]>(() => {
    const segments: InlineTextSegment[] = []
    composerKnobSegments.forEach((segment, index) => {
      if (index > 0) segments.push({ text: ' · ', fg: theme.dim })
      segments.push(segment)
    })
    if (composerLocationSegments.length > 0) {
      if (segments.length > 0) segments.push({ text: ' · ', fg: theme.dim })
      segments.push(...composerLocationSegments)
    }
    return segments
  }, [composerKnobSegments, composerLocationSegments, theme.dim])
  const composerWindowDraftFor = (draftLength: number): InlineTextSegment[] => {
    const segments: InlineTextSegment[] = [
      { text: `${composerWindowVisualLineCount} line${composerWindowVisualLineCount === 1 ? '' : 's'}`, fg: theme.dim },
      { text: ` · ${draftLength} chars`, fg: theme.dim },
    ]
    if (composerAttachmentLabel) {
      segments.push({ text: ' · ', fg: theme.dim })
      segments.push({ text: composerAttachmentLabel, fg: theme.cyan })
    }
    return segments
  }
  const composerBaseTextareaStyle = {
    backgroundColor: theme.surface,
    textColor: theme.text,
    focusedBackgroundColor: theme.surface,
    focusedTextColor: theme.text,
    placeholderColor: theme.dim,
  }
  const composerDockTextareaStyle = {
    ...composerBaseTextareaStyle,
    backgroundColor: theme.surface2,
    focusedBackgroundColor: theme.surface3,
    flexGrow: 1,
  }
  const chatComposerFocused = composerActive && !composerFocusBlocked
  // Fullscreen has no border to light up, so a focused composer is told apart
  // by its ground: a wash of its accent over the surface, dock and draft alike.
  const composerDockBackground = fullscreenMode && chatComposerFocused
    ? mixHexColor(composerAccentColor, theme.surface, 0.12) ?? theme.surface3
    : theme.surface
  // The textarea paints its own background over whatever the parent draws, so
  // chat mode's highlighted bar needs the textarea itself tinted to match —
  // otherwise the bar only shows through the "› " prefix and padding slivers.
  const composerChatTextareaStyle = {
    ...composerBaseTextareaStyle,
    // Focused, the draft area drops to the theme's own ground so it reads as a
    // well you can type into rather than another band of panel. Unfocused it
    // stays flush with the surrounding chat surface — the transcript's last
    // row, not a control. Neither state uses the theme's brighter
    // user-message background, which washes the whole input out.
    backgroundColor: chatComposerFocused ? theme.bg : theme.surface2,
    focusedBackgroundColor: theme.bg,
    flexGrow: 1,
  }
  const composerDockHeaderStatus = routeComposerToBridge
    ? 'BRIDGE'
    : routeComposerToIde
    ? 'IDE'
    : visibleComposerSending
    ? 'SENDING'
    : reattachedRunning
    ? 'REATTACHED'
    : composerActive
    ? 'FOCUSED'
    : 'READY'
  const composerDockTitleLeft = '◆ COMPOSER'
  const composerDockTitleWidth = Math.max(composerDockTextareaWidth - 2, 12)
  const composerDockTitleGap = composerDockTitleWidth - composerDockTitleLeft.length - composerDockHeaderStatus.length
  const composerDockRouted = routeComposerToBridge || routeComposerToIde
  // Lit only while the composer can actually take a key: an accent border on
  // an open-but-unfocused prompt reads as a second focused pane.
  const composerDockEmphasized = composerDockRouted || (composerActive && !composerFocusBlocked)
  const composerDockTitleRule = composerDockRouted ? '━' : '─'
  const composerDockBorderTitle = composerDockTitleGap > 0
    ? `${composerDockTitleLeft}${composerDockTitleRule.repeat(composerDockTitleGap)}${composerDockHeaderStatus}`
    : fitText(`${composerDockTitleLeft} · ${composerDockHeaderStatus}`, composerDockTitleWidth)
  const composerWindowHeaderStatus = visibleComposerSending
    ? 'SENDING'
    : reattachedRunning
    ? 'REATTACHED'
    : 'EXPANDED'
  const composerWindowTitleLeft = '◆ COMPOSER'
  const composerWindowTitleWidth = Math.max(composerWindowWidth - 4, 12)
  const composerWindowTitleGap = composerWindowTitleWidth - composerWindowTitleLeft.length - composerWindowHeaderStatus.length
  const composerWindowBorderTitle = composerWindowTitleGap > 0
    ? `${composerWindowTitleLeft}${'━'.repeat(composerWindowTitleGap)}${composerWindowHeaderStatus}`
    : fitText(`${composerWindowTitleLeft} · ${composerWindowHeaderStatus}`, composerWindowTitleWidth)
  const sendingHintBase = interruptPressActive
    ? composerConfig.footerHintSending.replace('⌃C cancel', '⌃C again to interrupt')
    : composerTargetSession?.provider === 'claude' && visibleRunningToolCount > 0
    ? `${composerConfig.footerHintSending} · ⌃B background`
    : composerConfig.footerHintSending
  const composerWorkflowFooterHint = composerTargetSession?.provider === 'claude' ? ' · ⌃W workflow' : ''
  const composerDockFooterHint = canUseChannelBridge && routeComposerToBridge
    ? '● → live CLI bridge · ⌃R off · ⇧C panel'
    : canUseIdeBridge && routeComposerToIde
    ? '● → IDE @mentions · ⇧I panel'
    : composerKeysTargetTurn
    ? sendingHintBase
    : `${composerIdleFooterHint}${composerWorkflowFooterHint} · ⌃R search · ⌃G editor · ⌃O expand`
  const composerDockSendingHintSegments = composerKeysTargetTurn
    ? composerSendingHintSegments(composerDockFooterHint, theme)
    : null
  // Size the hint box to exactly fit its text, capped by available width minus
  // 24 chars reserved for the stats side. Avoids the old proportional cap (62
  // chars) that truncated the full idle hint (~72 chars on most terminals).
  // The dock border carries the status bar whenever the composer is not what
  // the keys reach: the reader's keys, a pending chord, the attention badge.
  const dockShowsStatusBar = statusBarInDock
    && (commandChordPending || splitChordPending || (!composerActive && !composerKeysTargetTurn && !routeComposerToBridge && !routeComposerToIde))
  // The attention badge rides the stats while the composer holds the hint slot:
  // it must stay visible in every mode.
  const dockFooterStatsFor = (draftLength: number): InlineTextSegment[] => statusBarInDock && !dockShowsStatusBar && attentionNeedsInputCount > 0
    ? [{ text: `⚠ ${attentionNeedsInputCount} `, fg: theme.amber }, ...composerDockStatsFor(draftLength)]
    : composerDockStatsFor(draftLength)
  const dockStatusBarLength = dockShowsStatusBar ? footerSegments.reduce((n, segment) => n + segment.text.length, 0) : 0
  const composerDockFooterHintWidth = Math.max(
    18,
    Math.min((dockShowsStatusBar ? dockStatusBarLength : composerDockFooterHint.length) + 1, composerDockTextareaWidth - footerDockStatsReserve(composerDockTextareaWidth)),
  )
  const composerDockFooterStatsWidth = Math.max(composerDockTextareaWidth - composerDockFooterHintWidth - 1, 8)
  const composerWindowFooterHint = composerKeysTargetTurn
    ? `${sendingHintBase} · ⌃O dock`
    : `⏎ send · ⌥M settings · ⇧⏎ newline${composerWorkflowFooterHint} · ⌃O dock · Esc close`
  const composerWindowSendingHintSegments = composerKeysTargetTurn
    ? composerSendingHintSegments(composerWindowFooterHint, theme)
    : null
  const chatComposerFooterHint = chatComposerFocused
    ? composerKeysTargetTurn || composerDockRouted
      ? composerDockFooterHint
      : '⏎ send · ⇧⏎ newline · ⌥M settings'
    : 'c compose'
  // The chat composer's status row is painted into its bottom border, so its
  // budget is that border's horizontal run less a column of inset at each end —
  // the reader's frame, the chat dock's own border, and its padding.
  const chatComposerStatusWidth = Math.max(rightPaneWidth - 8, 12)
  // Both halves are sized to their own content rather than to a fixed share of
  // the row. Both renderers pad to the width they are given, so a fixed share
  // paints a blank band of panel background over the border — and the two
  // states have very different hints (`c compose` against the
  // full key list), so a fixed share left the unfocused hint stranded mid-row
  // instead of against the right end where the focused one sits.
  // Stats take what they need up to their old share of the row; the hint takes
  // what is left, so a long key list still truncates before it can crowd them.
  // `||`, not `??`: the render picks between these two by truthiness, so an
  // empty slash hint must fall through to the stats segments here as well.
  const chatComposerStatsText = composerSlashHint
    || composerDockStatsSegments.map((segment) => segment.text).join('')
  const chatComposerStatsWidth = Math.max(
    Math.min(chatComposerStatsText.length, Math.max(
      Math.floor(chatComposerStatusWidth * 0.55),
      chatComposerStatusWidth - chatComposerFooterHint.length - 2,
    )),
    8,
  )
  const chatComposerHintText = chatComposerFocused && composerDockSendingHintSegments
    ? composerDockSendingHintSegments.map((segment) => segment.text).join('')
    : chatComposerFooterHint
  // Fit once and measure the result: `fitHintText` pads to whatever width it is
  // given, so sizing the box from the raw length leaves a run of blank panel
  // background where the border should be whenever the hint had to truncate.
  const chatComposerHintFitted = fitHintText(
    chatComposerHintText,
    Math.max(chatComposerStatusWidth - chatComposerStatsWidth - 2, 0),
  ).trimEnd()
  const chatComposerHintWidth = chatComposerHintFitted.length
  const composerWindowFooterHintWidth = Math.max(
    18,
    Math.min(composerWindowFooterHint.length + 1, composerWindowContentWidth - 16),
  )
  const composerWindowFooterStatsWidth = Math.max(composerWindowContentWidth - composerWindowFooterHintWidth - 1, 8)
  // Enter on a partial command name picks the highlighted menu entry, as the
  // native menus do, instead of sending "/co" as an unknown command. A name
  // typed in full (with or without arguments) sends as usual. This lives in the
  // submit path because the textarea handles Enter before the app's key handler.
  const pickSlashInsteadOfSubmit = (): boolean => {
    // The textarea takes Enter before the key handler, so an open /rewind
    // picker is answered here.
    if (composerRewindItems && composerRewindItems.length > 0) {
      const chosen = composerRewindItems[composerRewindIndex]
      setComposerRewindItems(null)
      if (chosen) void rewindToPrompt(chosen)
      return true
    }
    if (!composerSlashOpen || composerSlashCommands.length === 0) return false
    const typed = composerFirstLine.trim().split(/\s/)[0]?.toLowerCase() ?? ''
    if (composerSlashCommands.some((entry) => entry.command.toLowerCase() === typed)) return false
    const entry = composerSlashCommands[composerSlashIndex] ?? composerSlashCommands[0]
    // Only a completion of what was typed: a full command the menu does not
    // list (a CLI built-in such as /status) must send as typed, not be swapped
    // for a fuzzy match like /codex:status.
    if (!entry || !entry.command.toLowerCase().startsWith(typed)) return false
    insertSlashAtCursor(entry.command)
    return true
  }

  return {
    composerDockStatsFor, composerWindowMetaSegments, composerWindowDraftFor,
    composerBaseTextareaStyle, composerDockTextareaStyle, chatComposerFocused,
    composerDockBackground, composerChatTextareaStyle, composerDockTitleWidth, composerDockRouted,
    composerDockEmphasized, composerDockBorderTitle, composerWindowBorderTitle,
    composerDockFooterHint, composerDockSendingHintSegments, dockShowsStatusBar,
    dockFooterStatsFor, composerDockFooterHintWidth, composerDockFooterStatsWidth,
    composerWindowFooterHint, composerWindowSendingHintSegments, chatComposerStatusWidth,
    chatComposerStatsWidth, chatComposerHintFitted, chatComposerHintWidth,
    composerWindowFooterHintWidth, composerWindowFooterStatsWidth, pickSlashInsteadOfSubmit,
  }
}
