/** @jsxImportSource @opentui/react */
import type { TuiThemePalette } from '../../../theme'
import { useMemo } from 'react'
import { type Session } from '../../../../lib/types'
import { getProviderComposer, pickProviderExample } from '../../../../lib/providerComposer'
import { type TuiPermissionMode, type TuiCodexApproval, type TuiCopilotPermissionMode, type TuiCopilotContextTier } from '../types'
import { sessionKey } from '../sessionList'

export type UseComposerProviderGroupContext = {
  composerTargetSession: Session | null
  selectedSession: Session | null
  tuiPermissionModeByKey: Record<string, 'auto' | 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions'>
  tuiCodexApprovalByKey: Record<string, TuiCodexApproval>
  tuiCodexModeByKey: Record<string, 'default' | 'plan'>
  tuiCopilotPermissionModeByKey: Record<string, TuiCopilotPermissionMode>
  tuiCopilotContextTierByKey: Record<string, TuiCopilotContextTier>
  theme: TuiThemePalette
}

export function useComposerProviderGroup(ctx: UseComposerProviderGroupContext) {
  const {
    composerTargetSession, selectedSession, tuiPermissionModeByKey, tuiCodexApprovalByKey,
    tuiCodexModeByKey, tuiCopilotPermissionModeByKey, tuiCopilotContextTierByKey, theme,
  } = ctx

  const composerProvider = composerTargetSession?.provider ?? selectedSession?.provider ?? null
  const composerPermissionMode = useMemo<TuiPermissionMode>(() => {
    if (composerTargetSession?.provider !== 'claude') return 'default'
    return tuiPermissionModeByKey[sessionKey(composerTargetSession)] ?? 'auto'
  }, [composerTargetSession, tuiPermissionModeByKey])
  const composerCodexApproval = composerTargetSession?.provider === 'codex'
    ? tuiCodexApprovalByKey[sessionKey(composerTargetSession)] ?? 'auto'
    : 'auto'
  const composerCodexMode = composerTargetSession?.provider === 'codex'
    ? tuiCodexModeByKey[sessionKey(composerTargetSession)] ?? 'default'
    : 'default'
  const composerCopilotPermissionMode = composerTargetSession?.provider === 'copilot'
    ? tuiCopilotPermissionModeByKey[sessionKey(composerTargetSession)] ?? 'off'
    : 'off'
  const composerCopilotContextTier = composerTargetSession?.provider === 'copilot'
    ? tuiCopilotContextTierByKey[sessionKey(composerTargetSession)] ?? 'default'
    : 'default'
  const composerConfig = useMemo(() => getProviderComposer(composerProvider), [composerProvider])
  const composerExampleSeed = useMemo(() => {
    const source = composerTargetSession?.sessionId ?? composerProvider ?? ''
    let hash = 0
    for (let i = 0; i < source.length; i += 1) hash = ((hash << 5) - hash + source.charCodeAt(i)) | 0
    return hash
  }, [composerTargetSession?.sessionId, composerProvider])
  const composerExample = useMemo(
    () => pickProviderExample(composerProvider, composerExampleSeed),
    [composerProvider, composerExampleSeed],
  )
  const composerAccentColor = useMemo(() => {
    const key = composerConfig.tuiAccentKey
    const value = (theme as unknown as Record<string, string>)[key]
    return value ?? theme.cyan
  }, [composerConfig.tuiAccentKey, theme])

  return {
    composerProvider, composerPermissionMode, composerCodexApproval, composerCodexMode,
    composerCopilotPermissionMode, composerCopilotContextTier, composerConfig, composerExample,
    composerAccentColor,
  }
}
