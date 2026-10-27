/** @jsxImportSource @opentui/react */
import type { RefObject } from 'react'
import type { TuiThemePalette } from '../../../theme'
import type { SessionInfo } from '../../../../lib/types'
import React, { useMemo, useState } from 'react'
import { type SelectOption } from '@opentui/core'
import { type ClaudePlanLimits } from '../../../../lib/claudePlanLimits'
import { type ContextUsage, type Session } from '../../../../lib/types'
import { type GitSummary } from '../../../../lib/gitProvider'
import { type TuiEffort, type TuiCodexApproval, type TuiCopilotPermissionMode, type TuiCopilotContextTier } from '../types'
import { sessionKey } from '../sessionList'
import { runComposerKnobSegments } from '../derived/composerStatus'

export type UseModelPickerFocusedDescriptionGroupContext = {
  modelPickerFocusedOption: SelectOption
  composerTargetSession: Session | null
  selectedSessionKey: string | null
  contextUsage: ContextUsage | null
  sessionContextUsageCacheRef: React.RefObject<Map<string, ContextUsage | null>>
  composerPermissionMode: 'auto' | 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions'
  theme: TuiThemePalette
  composerCurrentModel: string | null
  composerAccentColor: string
  composerModelLookupSettled: boolean
  tuiEffort: TuiEffort
  tuiOpenCodeAgent: string
  composerCodexMode: 'default' | 'plan'
  composerCodexApproval: TuiCodexApproval
  tuiCopilotMode: 'interactive' | 'plan' | 'autopilot' | 'shell'
  composerCopilotPermissionMode: TuiCopilotPermissionMode
  composerCopilotContextTier: TuiCopilotContextTier
  composerEnableWorkflow: boolean
  composerTargetSessionInfo: SessionInfo | null
}

export function useModelPickerFocusedDescriptionGroup(ctx: UseModelPickerFocusedDescriptionGroupContext) {
  const {
    modelPickerFocusedOption, composerTargetSession, selectedSessionKey, contextUsage,
    sessionContextUsageCacheRef, composerPermissionMode, theme, composerCurrentModel,
    composerAccentColor, composerModelLookupSettled, tuiEffort, tuiOpenCodeAgent,
    composerCodexMode, composerCodexApproval, tuiCopilotMode, composerCopilotPermissionMode,
    composerCopilotContextTier, composerEnableWorkflow, composerTargetSessionInfo,
  } = ctx

  const modelPickerFocusedDescription = modelPickerFocusedOption?.description
    || String(modelPickerFocusedOption?.value ?? '')
  const composerContextUsage = useMemo(() => {
    if (!composerTargetSession) return null
    const targetKey = sessionKey(composerTargetSession)
    const usage = selectedSessionKey === targetKey
      ? contextUsage
      : sessionContextUsageCacheRef.current.get(targetKey) ?? null
    return usage ?? null
  }, [composerTargetSession, contextUsage, selectedSessionKey])
  const [composerPlanLimits, setComposerPlanLimits] = useState<ClaudePlanLimits | null>(null)
  // One-line chip summarising the active model, explicit effort, and any
  // provider-specific send knobs.
  const composerKnobSegments = useMemo(() => runComposerKnobSegments({
    composerTargetSession, composerPermissionMode, theme, composerCurrentModel,
    composerAccentColor, composerModelLookupSettled, composerContextUsage, composerPlanLimits,
    tuiEffort, tuiOpenCodeAgent, composerCodexMode, composerCodexApproval, tuiCopilotMode,
    composerCopilotPermissionMode, composerCopilotContextTier, composerEnableWorkflow,
  }), [composerAccentColor, composerCodexApproval, composerCodexMode, composerContextUsage, composerPlanLimits, theme, composerCopilotContextTier, composerCopilotPermissionMode, composerCurrentModel, composerEnableWorkflow, composerModelLookupSettled, composerPermissionMode, composerTargetSession?.provider, theme.amber, theme.cyan, theme.dim, theme.green, theme.red, theme.violet, tuiCopilotMode, tuiEffort, tuiOpenCodeAgent])
  const composerWorkingDirectory = composerTargetSessionInfo?.cwd ?? composerTargetSession?.cwd ?? null
  const composerGitBranch = composerTargetSessionInfo?.gitBranch ?? null
  const [composerGitSummary, setComposerGitSummary] = useState<GitSummary | null>(null)

  return {
    modelPickerFocusedDescription, setComposerPlanLimits, composerKnobSegments,
    composerWorkingDirectory, composerGitBranch, composerGitSummary, setComposerGitSummary,
  }
}
