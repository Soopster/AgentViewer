/** @jsxImportSource @opentui/react */
import type { TuiThemePalette } from '../../../theme'
import { type ClaudePlanLimits } from '../../../../lib/claudePlanLimits'
import { type ContextUsage, type Session } from '../../../../lib/types'
import { type TuiEffort, type TuiCodexApproval, type TuiCopilotPermissionMode, type TuiCopilotContextTier } from '../types'
import { type InlineTextSegment } from '../inlineText'
import { contextBarColor, formatContextUsageChip, planLimitSegment } from '../contextMeter'
import { PERMISSION_MODE_GLYPH, PERMISSION_MODE_LABEL } from '../pickers'
import { type PendingQuestion, type PendingPermission } from '../../../../lib/permissions'
import { type TuiSessionDetail } from '../../../../lib/tui/service'
import { type SendState } from '../../../../lib/types'
import { type TuiLiveToolActivity } from '../types'
import { LIVE_PREVIEW_HEIGHT } from '../inlineText'

export type ComposerKnobSegmentsContext = {
  composerTargetSession: Session | null
  composerPermissionMode: 'default' | 'acceptEdits' | 'auto' | 'plan' | 'bypassPermissions'
  theme: TuiThemePalette
  composerCurrentModel: string | null
  composerAccentColor: string
  composerModelLookupSettled: boolean
  composerContextUsage: ContextUsage | null
  composerPlanLimits: ClaudePlanLimits | null
  tuiEffort: TuiEffort
  tuiOpenCodeAgent: string
  composerCodexMode: 'default' | 'plan'
  composerCodexApproval: TuiCodexApproval
  tuiCopilotMode: 'plan' | 'interactive' | 'autopilot' | 'shell'
  composerCopilotPermissionMode: TuiCopilotPermissionMode
  composerCopilotContextTier: TuiCopilotContextTier
  composerEnableWorkflow: boolean
}

export function runComposerKnobSegments(ctx: ComposerKnobSegmentsContext) {
  const {
    composerTargetSession, composerPermissionMode, theme, composerCurrentModel,
    composerAccentColor, composerModelLookupSettled, composerContextUsage, composerPlanLimits,
    tuiEffort, tuiOpenCodeAgent, composerCodexMode, composerCodexApproval, tuiCopilotMode,
    composerCopilotPermissionMode, composerCopilotContextTier, composerEnableWorkflow,
  } = ctx
  const parts: InlineTextSegment[] = []
  // The mode lives here rather than on a row of its own above the dock, and
  // first: the border fits one or two settings at common widths, and a
  // hidden bypass is the one that matters. Its colour still warns.
  if (composerTargetSession?.provider === 'claude' && composerPermissionMode !== 'default') {
    parts.push({
      text: `${PERMISSION_MODE_GLYPH[composerPermissionMode] ?? ''} ${PERMISSION_MODE_LABEL[composerPermissionMode] ?? composerPermissionMode}`.trim(),
      fg: composerPermissionMode === 'bypassPermissions' ? theme.red : composerPermissionMode === 'plan' ? theme.dim : theme.amber,
    })
  }
  const afterMode = parts.length
  if (composerCurrentModel) {
    parts.push({ text: `model:${composerCurrentModel}`, fg: composerAccentColor, action: 'model' })
  } else if (composerTargetSession?.provider && composerTargetSession.provider !== 'claude-acp' && composerTargetSession.provider !== 'codex-acp' && composerTargetSession.provider !== 'acp') {
    // Custom-model providers (LM Studio, opencode/copilot custom endpoints,
    // Claude on a non-default deployment) can take a moment to report their
    // current model on a cold session. Show the in-flight state, then settle
    // on "auto" when the provider intentionally reports no concrete model.
    parts.push({ text: composerModelLookupSettled ? 'model:auto' : 'model:loading…', fg: theme.dim, action: 'model' })
  }
  // Context and plan limit are meters: quiet while there is room, and moved
  // ahead of the model once either needs attention, since the border cuts
  // off whatever does not fit.
  const meters: InlineTextSegment[] = []
  let metersUrgent = false
  if (composerContextUsage) {
    const pct = Number.isFinite(composerContextUsage.percentage) ? composerContextUsage.percentage : 0
    metersUrgent ||= pct >= 60
    meters.push({ text: `ctx:${formatContextUsageChip(composerContextUsage)}`, fg: contextBarColor(pct, theme) })
  }
  const limitSegment = planLimitSegment(composerPlanLimits, theme)
  if (limitSegment) {
    metersUrgent ||= limitSegment.fg !== theme.dim
    meters.push(limitSegment)
  }
  if (metersUrgent) parts.splice(afterMode, 0, ...meters)
  else parts.push(...meters)
  parts.push({ text: `effort:${tuiEffort}`, fg: theme.dim, action: 'model' })
  if (composerTargetSession?.provider === 'opencode' && tuiOpenCodeAgent) {
    parts.push({ text: `agent:${tuiOpenCodeAgent}`, fg: theme.cyan })
  }
  if (composerTargetSession?.provider === 'codex' && composerCodexMode === 'plan') {
    parts.push({ text: 'mode:plan', fg: theme.cyan })
  }
  if (composerTargetSession?.provider === 'codex' && composerCodexApproval !== 'auto') {
    parts.push({ text: `approvals:${composerCodexApproval}`, fg: theme.violet })
  }
  if (composerTargetSession?.provider === 'copilot' && tuiCopilotMode !== 'interactive') {
    parts.push({ text: `mode:${tuiCopilotMode}`, fg: theme.cyan })
  }
  if (composerTargetSession?.provider === 'copilot' && composerCopilotPermissionMode !== 'off') {
    parts.push({ text: `permissions:${composerCopilotPermissionMode}`, fg: composerCopilotPermissionMode === 'on' ? theme.red : theme.amber })
  }
  if (composerTargetSession?.provider === 'copilot' && composerCopilotContextTier === 'long_context') {
    parts.push({ text: 'context:long', fg: theme.cyan })
  }
  if (composerTargetSession?.provider === 'claude' && composerEnableWorkflow) {
    parts.push({ text: 'workflow:on', fg: theme.cyan })
  }
  return parts
}

export type ComposerStatusBlockHeightContext = {
  presentationHidesComposer: boolean
  visibleComposerSending: boolean
  embeddedComposer: boolean
  composerTurnStatusInBorder: boolean
  composerActivityVisible: boolean
  hasSubagentTail: boolean
  visibleLiveToolActivities: TuiLiveToolActivity[]
  visibleRunningToolCount: number
  livePromptSuggestion: string | null
  composerSendState: SendState
  hasComposerStatusMessage: boolean
  visibleComposerLiveText: string
  visibleComposerError: string | null
  isChatLikeView: boolean
  liveAssistantTextCardVisible: boolean
  visibleAwaitingPersistedTurn: boolean
  liveStatus: 'requesting' | 'compacting' | 'retrying' | null
  composerLiveReasoning: string
  isStreamView: boolean
  reattachedRunning: boolean
  composerTargetSession: Session | null
  sessionDetail: TuiSessionDetail | null
  pendingPermissions: PendingPermission[]
  questionPickerPlan: { questions: PendingQuestion[]; focusIndex: number; collapsed: boolean; optionStart: number; optionCount: number; previewLines: string[]; rows: number; } | null
  width: number
}

export function runComposerStatusBlockHeight(ctx: ComposerStatusBlockHeightContext) {
  const {
    presentationHidesComposer, visibleComposerSending, embeddedComposer,
    composerTurnStatusInBorder, composerActivityVisible, hasSubagentTail,
    visibleLiveToolActivities, visibleRunningToolCount, livePromptSuggestion, composerSendState,
    hasComposerStatusMessage, visibleComposerLiveText, visibleComposerError, isChatLikeView,
    liveAssistantTextCardVisible, visibleAwaitingPersistedTurn, liveStatus, composerLiveReasoning,
    isStreamView, reattachedRunning, composerTargetSession, sessionDetail, pendingPermissions,
    questionPickerPlan, width,
  } = ctx
return (() => {
  if (presentationHidesComposer) return 0
  let rows = 0
  // Keep in sync with the pinned turn-status row below (rendered for the
  // entire turn, not just the pre-output window).
  // Embedded composers own a compact status row in the reader, so it comes
  // out of transcriptViewportRows rather than this sibling-status budget.
  if (visibleComposerSending && !embeddedComposer && !composerTurnStatusInBorder) rows += 1
  if (composerActivityVisible && hasSubagentTail) rows += 2
  if (visibleLiveToolActivities.length > 0 && visibleRunningToolCount > 0) rows += 2
  if (livePromptSuggestion && composerSendState !== 'sending') rows += 2
  if (hasComposerStatusMessage) {
    const streamingResponse = visibleComposerSending && visibleComposerLiveText && !visibleComposerError
    rows += streamingResponse
      ? isChatLikeView || liveAssistantTextCardVisible ? 0 : LIVE_PREVIEW_HEIGHT
      : 2
  }
  if (visibleAwaitingPersistedTurn && !embeddedComposer) rows += 2
  if ((liveStatus === 'retrying' || liveStatus === 'compacting') && visibleComposerSending) rows += 2
  if (visibleComposerSending && composerLiveReasoning.trim() && !isStreamView) rows += LIVE_PREVIEW_HEIGHT
  // Reattached-turn banner (rendered when a turn runs without an owned stream).
  if (!visibleComposerSending && reattachedRunning && !visibleAwaitingPersistedTurn && !embeddedComposer) rows += 2
  // Codex external-writer banner — another Codex client owns the rollout,
  // so this transcript is a stale cached snapshot until it finishes.
  if (composerTargetSession?.provider === 'codex' && sessionDetail?.externalWriter) rows += 2
  if (pendingPermissions.length > 0) {
    const permission = pendingPermissions[0]!
    const questions = permission.questions ?? []
    if (questions.length > 0) {
      // Measured by questionPickerPlan, which the render reads too — a flat
      // budget leaves the card too few rows and the option lines composite
      // on top of the question line.
      rows += questionPickerPlan?.rows ?? 0
    } else {
      const permInnerWidth = Math.max(width - 8, 20)
      // border(2) + outer padding(1) + title(1) + options marginTop(1)
      // + options(1) + hint(1)
      let permRows = 7
      if (permission.toolName === 'ExitPlanMode') {
        const planLines = permission.plan ? permission.plan.split('\n') : []
        permRows += Math.min(planLines.length, 16)
        if (planLines.length > 16) permRows += 1
        if (permission.allowedPrompts && permission.allowedPrompts.length > 0) permRows += 1
      } else {
        // The reason renders with word wrap, so it can take several rows.
        if (permission.mcpServer) permRows += 1
        if (permission.reason) permRows += Math.max(Math.ceil(permission.reason.length / permInnerWidth), 1)
        if (permission.command) permRows += Math.min(permission.command.split('\n').length, 12)
        if (permission.url) permRows += 1
        if (permission.paths && permission.paths.length > 0) permRows += 1
        if (permission.diff) permRows += Math.min(permission.diff.split('\n').length, 12)
      }
      rows += permRows
    }
  }
  return rows
})()
}
