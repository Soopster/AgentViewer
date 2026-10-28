import type { ComposerSessions } from '../../../../lib/composerSessions'
/** @jsxImportSource @opentui/react */
import { useComposerSessionState } from '../../../../lib/composerSessions'
import React, { useRef, useState } from 'react'
import { type TuiLiveToolActivity, type TuiEffort, type TuiPermissionMode, type TuiCodexApproval } from '../types'

export type UseLiveTurnStateContext = {
  composerSessions: ComposerSessions
  composerOwnerKey: string
}

export function useLiveTurnState(ctx: UseLiveTurnStateContext) {
  const {
    composerSessions, composerOwnerKey,
  } = ctx

  const [livePromptSuggestion, setLivePromptSuggestion] = useComposerSessionState<string | null>(composerSessions, composerOwnerKey, 'livePromptSuggestion', null)
  const [liveStatus, setLiveStatus] = useComposerSessionState<'requesting' | 'compacting' | 'retrying' | null>(composerSessions, composerOwnerKey, 'liveStatus', null)
  const [liveSubagentText, setLiveSubagentText] = useComposerSessionState<Record<string, string>>(composerSessions, composerOwnerKey, 'liveSubagentText', {})
  const [liveOutputTokens, setLiveOutputTokens] = useComposerSessionState(composerSessions, composerOwnerKey, 'liveOutputTokens', 0)
  const [liveToolActivities, setLiveToolActivities] = useComposerSessionState<TuiLiveToolActivity[]>(composerSessions, composerOwnerKey, 'liveToolActivities', [])
  const [taskBudgetTokens, setTaskBudgetTokens] = useState<number | null>(null)
  const [composerEnableWorkflow, setComposerEnableWorkflow] = useState(false)
  // Provider-agnostic send knobs. Forwarded into the streamTuiSessionTurn
  // body so the TUI composer matches the web composer's send-time controls
  // (model / reasoning effort / provider permission mode). Defaults of `auto`
  // / `default` mean "let the SDK keep whatever the session was using".
  const [tuiEffort, setTuiEffort] = useState<TuiEffort>('auto')
  const [tuiPermissionModeByKey, setTuiPermissionModeByKey] = useState<Record<string, TuiPermissionMode>>({})
  const tuiPermissionModeByKeyRef = useRef<Record<string, TuiPermissionMode>>({})
  const [tuiCodexApprovalByKey, setTuiCodexApprovalByKey] = useState<Record<string, TuiCodexApproval>>({})
  // Codex's collaboration mode per session (the CLI's ⇧Tab Plan/Default). Read
  // through the ref at send time, so `/plan <goal>` sends in the mode it just set.
  // /add-dir roots per Claude session; sent with every turn (spawn-time option).
  const [tuiAddedDirsByKey, setTuiAddedDirsByKey] = useState<Record<string, string[]>>({})
  const tuiAddedDirsByKeyRef = useRef(tuiAddedDirsByKey)

  return {
    livePromptSuggestion, setLivePromptSuggestion, liveStatus, setLiveStatus, liveSubagentText,
    setLiveSubagentText, liveOutputTokens, setLiveOutputTokens, liveToolActivities,
    setLiveToolActivities, taskBudgetTokens, composerEnableWorkflow, setComposerEnableWorkflow,
    tuiEffort, setTuiEffort, tuiPermissionModeByKey, setTuiPermissionModeByKey,
    tuiPermissionModeByKeyRef, tuiCodexApprovalByKey, setTuiCodexApprovalByKey, tuiAddedDirsByKey,
    setTuiAddedDirsByKey, tuiAddedDirsByKeyRef,
  }
}
