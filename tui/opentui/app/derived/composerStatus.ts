/** @jsxImportSource @opentui/react */
import type { TuiThemePalette } from '../../../theme'
import { type ClaudePlanLimits } from '../../../../lib/claudePlanLimits'
import { type ContextUsage, type Session } from '../../../../lib/types'
import { type TuiEffort, type TuiCodexApproval, type TuiCopilotPermissionMode, type TuiCopilotContextTier } from '../types'
import { type InlineTextSegment } from '../inlineText'
import { contextBarColor, formatContextUsageChip, planLimitSegment } from '../contextMeter'
import { PERMISSION_MODE_GLYPH, PERMISSION_MODE_LABEL } from '../pickers'

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
