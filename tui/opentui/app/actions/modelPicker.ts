/** @jsxImportSource @opentui/react */
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import React from 'react'
import { type SelectOption } from '@opentui/core'
import { readTuiSessionMetadata, readTuiComposerOptions } from '../../../../lib/tui/service'
import { type Session } from '../../../../lib/types'
import { type ModelPickerOption, type TuiCopilotPermissionMode, type TuiCopilotContextTier, type ModelPickerFocus, type NoticeTone } from '../types'
import { sessionKey } from '../sessionList'
import { keepEmpty } from '../collections'

export async function openModelPicker({
  composerTargetSession, selectedSession, showNotice, setModelPickerTarget, setModelPickerFocus,
  setModelPickerError, setModelPickerOptions, setModelPickerPermissionOptions, setModelPickerQuery,
  setModelPickerIndex, setModelPickerPermissionIndex, setModelPickerLoading, setModelPickerOpen,
  setTuiCopilotPermissionModeByKey, tuiModelOverride, setTuiCopilotContextTierByKey
}: {
  composerTargetSession: Session | null
  selectedSession: Session | null
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  setModelPickerTarget: React.Dispatch<React.SetStateAction<Session | null>>
  setModelPickerFocus: React.Dispatch<React.SetStateAction<ModelPickerFocus>>
  setModelPickerError: React.Dispatch<React.SetStateAction<string | null>>
  setModelPickerOptions: React.Dispatch<React.SetStateAction<ModelPickerOption[]>>
  setModelPickerPermissionOptions: React.Dispatch<React.SetStateAction<SelectOption[]>>
  setModelPickerQuery: React.Dispatch<React.SetStateAction<string>>
  setModelPickerIndex: React.Dispatch<React.SetStateAction<number>>
  setModelPickerPermissionIndex: React.Dispatch<React.SetStateAction<number>>
  setModelPickerLoading: React.Dispatch<React.SetStateAction<boolean>>
  setModelPickerOpen: React.Dispatch<React.SetStateAction<boolean>>
  setTuiCopilotPermissionModeByKey: React.Dispatch<React.SetStateAction<Record<string, TuiCopilotPermissionMode>>>
  tuiModelOverride: Record<string, string>
  setTuiCopilotContextTierByKey: React.Dispatch<React.SetStateAction<Record<string, TuiCopilotContextTier>>>
}) {
  const target = composerTargetSession ?? selectedSession
  if (!target) {
    showNotice('info', 'Pick a session first')
    return
  }
  setModelPickerTarget(target)
  setModelPickerFocus('model')
  setModelPickerError(null)
  setModelPickerOptions(keepEmpty)
  setModelPickerPermissionOptions(keepEmpty)
  setModelPickerQuery('')
  setModelPickerIndex(0)
  setModelPickerPermissionIndex(0)
  setModelPickerLoading(true)
  setModelPickerOpen(true)
  try {
    const [meta, composerOptions] = await Promise.all([
      readTuiSessionMetadata(target),
      readTuiComposerOptions(target.sessionId, target.provider),
    ])
    const permissionOptions = (composerOptions.permissionModes ?? []).map((mode): SelectOption => ({
      name: mode.label,
      value: mode.value,
      description: mode.description ?? '',
    }))
    setModelPickerPermissionOptions(permissionOptions)
    const reportedPermissionMode = composerOptions.currentPermissionMode
    if (target.provider === 'copilot' && (reportedPermissionMode === 'off' || reportedPermissionMode === 'auto' || reportedPermissionMode === 'on')) {
      setTuiCopilotPermissionModeByKey((prev) => ({ ...prev, [sessionKey(target)]: reportedPermissionMode }))
    }
    const options = meta.models
      .filter((m): m is { value: string; displayName?: string; description?: string } & typeof m =>
        typeof m.value === 'string' && m.value.length > 0)
      .map((m): ModelPickerOption => ({
        name: m.displayName || m.value,
        value: m.value,
        description: m.description ?? '',
        supportsEffort: m.supportsEffort,
        supportedEffortLevels: m.supportedEffortLevels,
        supportsLongContext: m.supportsLongContext,
      }))
    if (options.length === 0) {
      setModelPickerError('No models reported by provider')
      setModelPickerOptions(keepEmpty)
      setModelPickerIndex(0)
      return
    }
    const currentValue = tuiModelOverride[sessionKey(target)] ?? meta.currentModel ?? options[0]!.value
    const idx = Math.max(0, options.findIndex((o) => o.value === currentValue))
    setModelPickerOptions(options)
    setModelPickerIndex(idx >= 0 ? idx : 0)
    // The stored tier only means anything for a model that reports long-context
    // support — dropping to a model that doesn't clears a stale 'long_context'.
    if (target.provider === 'copilot' && !options[idx >= 0 ? idx : 0]?.supportsLongContext) {
      setTuiCopilotContextTierByKey((prev) => (
        prev[sessionKey(target)] ? { ...prev, [sessionKey(target)]: 'default' } : prev
      ))
    }
  } catch (err) {
    setModelPickerError(err instanceof Error ? err.message : 'Failed to load models')
  } finally {
    setModelPickerLoading(false)
  }
}
