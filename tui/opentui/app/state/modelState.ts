/** @jsxImportSource @opentui/react */
import { useRef, useState } from 'react'
import { useWorkspaceState } from '../../workspaceContext'
import { readComposerSentHistory } from '../../../../lib/tuiComposerState'
import { type ScrollBoxRenderable, type SelectOption } from '@opentui/core'
import { type Session } from '../../../../lib/types'
import { type ComposerDraftSnapshot, type ModelPickerOption, type TuiCopilotPermissionMode, type TuiCopilotContextTier, type ModelPickerFocus } from '../types'

export function useModelState() {
  const [tuiCopilotPermissionModeByKey, setTuiCopilotPermissionModeByKey] = useState<Record<string, TuiCopilotPermissionMode>>({})
  // Mirrors web's CONTEXT selector (components/MessageView.tsx) — GitHub
  // Copilot's long-context tier. Toggled with ⌃L while the model picker is
  // open; only reachable when the selected model reports supportsLongContext.
  const [tuiCopilotContextTierByKey, setTuiCopilotContextTierByKey] = useState<Record<string, TuiCopilotContextTier>>({})
  const [tuiCopilotMode, setTuiCopilotMode] = useState<'interactive' | 'plan' | 'autopilot' | 'shell'>('interactive')
  const [tuiOpenCodeAgent, setTuiOpenCodeAgent] = useState('')
  const [tuiModelOverride, setTuiModelOverride] = useState<Record<string, string>>({})
  // Provider-reported models are separate from explicit overrides: using the
  // latter for discovery would silently force a model on the next send. Keep
  // null as a settled "provider default" result so the footer cannot claim it
  // is loading forever after a completed lookup with no concrete model.
  const [tuiReportedModelByKey, setTuiReportedModelByKey] = useState<Record<string, string | null>>({})
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [modelPickerTarget, setModelPickerTarget] = useState<Session | null>(null)
  const [modelPickerFocus, setModelPickerFocus] = useState<ModelPickerFocus>('model')
  const [modelPickerOptions, setModelPickerOptions] = useState<ModelPickerOption[]>([])
  const [modelPickerPermissionOptions, setModelPickerPermissionOptions] = useState<SelectOption[]>([])
  const [modelPickerQuery, setModelPickerQuery] = useState('')
  const [modelPickerIndex, setModelPickerIndex] = useState(0)
  const [modelPickerEffortIndex, setModelPickerEffortIndex] = useState(0)
  const [modelPickerPermissionIndex, setModelPickerPermissionIndex] = useState(0)
  const [modelPickerLoading, setModelPickerLoading] = useState(false)
  const [modelPickerError, setModelPickerError] = useState<string | null>(null)
  const [sentHistory, setSentHistory] = useState<ComposerDraftSnapshot[]>(() =>
    readComposerSentHistory().map((text) => ({ text, attachments: [], promptParts: [] })),
  )
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [draftBeforeHistory, setDraftBeforeHistory] = useState<ComposerDraftSnapshot>({
    text: '',
    attachments: [],
    promptParts: [],
  })
  const [thinkingMode, setThinkingMode] = useState(false)

  // Store full Session objects so tabs retain provider context across
  // provider switches (looking them up in `sessions` loses other-provider tabs).
  const [openTabSessions, setOpenTabSessions] = useWorkspaceState<Session[]>('openTabSessions', [])

  const sidebarScrollRef = useRef<ScrollBoxRenderable>(null)
  // The window area's real height: the estimate from the content budget runs
  // a couple of rows short of what flex gives it.
  const [measuredWindowAreaHeight, setMeasuredWindowAreaHeight] = useState(0)
  // The cursor key SCROLLBACK last placed by scrolling. The reveal and recenter
  // effects skip a cursor that matches it: scrolling it back into view would
  // undo the scroll that moved it.
  const scrollbackSyncedCursorKeyRef = useRef<string | null>(null)

  return {
    tuiCopilotPermissionModeByKey, setTuiCopilotPermissionModeByKey, tuiCopilotContextTierByKey,
    setTuiCopilotContextTierByKey, tuiCopilotMode, setTuiCopilotMode, tuiOpenCodeAgent,
    setTuiOpenCodeAgent, tuiModelOverride, setTuiModelOverride, tuiReportedModelByKey,
    setTuiReportedModelByKey, modelPickerOpen, setModelPickerOpen, modelPickerTarget,
    setModelPickerTarget, modelPickerFocus, setModelPickerFocus, modelPickerOptions,
    setModelPickerOptions, modelPickerPermissionOptions, setModelPickerPermissionOptions,
    modelPickerQuery, setModelPickerQuery, modelPickerIndex, setModelPickerIndex,
    modelPickerEffortIndex, setModelPickerEffortIndex, modelPickerPermissionIndex,
    setModelPickerPermissionIndex, modelPickerLoading, setModelPickerLoading, modelPickerError,
    setModelPickerError, sentHistory, setSentHistory, historyIndex, setHistoryIndex,
    draftBeforeHistory, setDraftBeforeHistory, thinkingMode, setThinkingMode, openTabSessions,
    setOpenTabSessions, sidebarScrollRef, measuredWindowAreaHeight, setMeasuredWindowAreaHeight,
    scrollbackSyncedCursorKeyRef,
  }
}
