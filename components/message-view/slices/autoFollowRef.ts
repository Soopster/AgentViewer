import type { Session } from '../../../lib/types'
import type { SetStateAction } from 'react'
import type { MutableRefObject } from 'react'
import { useRef, useMemo } from 'react'
import { type SessionInfo, type SessionModelInfo, type SessionComposerOptions, type ReasoningEffortLevel } from '@/lib/types'
import { useComposerSessionState } from '@/lib/composerSessions'
import { getContinueInCliCommand } from '@/lib/cliContinue'
import { type TimelineRow } from '../types'
import { assistantDisplayName } from '../liveStream'
import { normalizeSelectValue } from '../composerUi'
import { composerDraftStorageKey } from '../composerStorage'

export type UseAutoFollowRefGroupContext = {
  sessionInfo: SessionInfo | null
  session: Session | null
  availableModels: SessionModelInfo[]
  selectedModel: string
  composerOptions: SessionComposerOptions
  composerSessions: { get<T>(key: string, name: string, initial: T | (() => T)): T; set<T>(key: string, name: string, initial: T | (() => T), action: SetStateAction<T>): void; subscribe(key: string, name: string, listener: () => void): () => void; ref<T>(key: string, name: string, initial: T): MutableRefObject<T>; peekRef<T>(key: string, name: string): MutableRefObject<T> | undefined; same(a: string, b: string): boolean; rekey(from: string, to: string): void; keys(): string[]; }
  composerOwnerKey: string
}

export function useAutoFollowRefGroup(ctx: UseAutoFollowRefGroupContext) {
  const {
    sessionInfo, session, availableModels, selectedModel, composerOptions, composerSessions,
    composerOwnerKey,
  } = ctx

  const autoFollowRef = useRef(false)
  const timelineRowsRef = useRef<TimelineRow[]>([])
  const handledTargetMessageRequestRef = useRef(0)
  const initialScrollDoneRef = useRef(false)
  const sessionCapabilities = sessionInfo?.capabilities ?? session?.capabilities
  const assistantName = assistantDisplayName(sessionInfo?.provider ?? session?.provider)
  const activeProvider = sessionInfo?.provider ?? session?.provider
  const cliCommand = useMemo(() => {
    if (!session) return null
    return getContinueInCliCommand(
      activeProvider ?? 'claude',
      session.sessionId,
      sessionInfo?.cwd ?? session.cwd,
    )
  }, [session, activeProvider, sessionInfo])
  const modelOptions = useMemo(() => {
    const filtered = availableModels.filter((model) => normalizeSelectValue(model.value))
    if (filtered.length > 0) return filtered

    const fallbackValue = normalizeSelectValue(selectedModel)
    return fallbackValue ? [{ value: fallbackValue, displayName: fallbackValue, description: '' }] : []
  }, [availableModels, selectedModel])
  const selectedModelValue = normalizeSelectValue(selectedModel)
  const selectedModelInfo = useMemo(
    () => modelOptions.find((model) => model.value === selectedModelValue) ?? null,
    [modelOptions, selectedModelValue],
  )
  const composerAgentOptions = useMemo(
    () => composerOptions.agents?.filter((agent) => normalizeSelectValue(agent.value)) ?? [],
    [composerOptions.agents],
  )
  const composerMentionAgentOptions = useMemo(
    () => composerOptions.mentionAgents?.filter((agent) => normalizeSelectValue(agent.value)) ?? [],
    [composerOptions.mentionAgents],
  )
  const composerModeOptions = useMemo(
    () => composerOptions.modes?.filter((mode) => normalizeSelectValue(mode.value)) ?? [],
    [composerOptions.modes],
  )
  const effortOptions = useMemo<ReasoningEffortLevel[]>(() => {
    if (!selectedModelInfo?.supportsEffort) return []
    if (activeProvider === 'opencode') return []
    const levels = selectedModelInfo.supportedEffortLevels?.filter((level) => {
      if (activeProvider === 'codex') return level === 'low' || level === 'medium' || level === 'high'
      if (activeProvider === 'copilot') return level === 'low' || level === 'medium' || level === 'high' || level === 'xhigh'
      if (activeProvider === 'claude') return level === 'low' || level === 'medium' || level === 'high' || level === 'xhigh' || level === 'max'
      if (activeProvider === 'pi') return level === 'off' || level === 'minimal' || level === 'low' || level === 'medium' || level === 'high' || level === 'xhigh' || level === 'max'
      return false
    }) ?? []
    if (levels.length > 0) return levels
    if (activeProvider === 'pi') return ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
    if (activeProvider === 'codex') return ['low', 'medium', 'high']
    return ['low', 'medium', 'high']
  }, [activeProvider, selectedModelInfo])
  const [loadedComposerDraftKey, setLoadedComposerDraftKey] = useComposerSessionState<string | null>(composerSessions, composerOwnerKey, 'loadedComposerDraftKey', null)
  const attachmentReadsRef = useRef(0)
  const composerDraftKey = useMemo(() => composerDraftStorageKey(session), [session])

  return {
    autoFollowRef, timelineRowsRef, handledTargetMessageRequestRef, initialScrollDoneRef,
    sessionCapabilities, activeProvider, cliCommand, modelOptions, selectedModelValue,
    selectedModelInfo, composerAgentOptions, composerMentionAgentOptions, composerModeOptions,
    effortOptions, loadedComposerDraftKey, setLoadedComposerDraftKey, attachmentReadsRef,
    composerDraftKey,
  }
}
