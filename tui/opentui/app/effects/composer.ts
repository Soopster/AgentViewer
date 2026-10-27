/** @jsxImportSource @opentui/react */
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import React from 'react'
import { type RefObject } from 'react'
import { type TextareaRenderable } from '@opentui/core'
import { type SendAttachment } from '../../../../lib/types'
import { type ComposerPromptPart } from '../types'
import { keepEmpty } from '../collections'
import { type MutableRefObject } from 'react'
import { type Timeout } from '@opentui/core'
import { removeComposerQueueItem } from '../../../../lib/composerAttachments'
import { type SendState } from '../../../../lib/types'
import { type QueuedComposerSend } from '../types'
import { type WorkspaceContextValue } from '../../workspaceContext'
import { type TuiPluginCapture } from '../../shell/pluginTypes'
import { peekTuiClaudePlanLimits, readTuiClaudePlanLimits } from '../../../../lib/tui/service'
import { type ClaudePlanLimits } from '../../../../lib/claudePlanLimits'
import { type Session } from '../../../../lib/types'
import { frecencyPrefix, readFrecencyScores } from '../../../../lib/tuiFrecency'
import { filterComposerMentionFilesAsync } from '../../composerMentionWorkerClient'
import { type SessionComposerAgentOption } from '../../../../lib/types'
import { listProjectFiles } from '../../../../lib/projectFiles'
import { runGitCommand } from '../../../../lib/gitNodeProvider'
import { type TuiMentionResult } from '../types'
import { prewarmTuiSession } from '../../../../lib/tui/service'
import { shouldPrewarmTuiRuntime } from '../../sessionPrewarm'
import { type SlashCommandSuggestion } from '../../../../lib/slashCommands'
import { type readViewSessionComposerOptions } from '../../../../lib/sessionBackend'
import { resolve } from 'node:path'
import { type TuiEffort } from '../types'
import { COMPOSER_AFFORDANCES_TTL_MS } from '../timing'

export type ComposerPreferredTargetEffectContext = {
  composerPreferredTargetKey: string | null
  selectedSessionKey: string | null
  composerActive: boolean
  composerPreparingTargetKey: string | null
  newSessionModalOpen: boolean
  worktreeModalOpen: boolean
  setComposerPreferredTargetKey: React.Dispatch<React.SetStateAction<string | null>>
}

export function runComposerPreferredTargetEffect(ctx: ComposerPreferredTargetEffectContext) {
  const {
    composerPreferredTargetKey, selectedSessionKey, composerActive, composerPreparingTargetKey,
    newSessionModalOpen, worktreeModalOpen, setComposerPreferredTargetKey,
  } = ctx
  if (
    composerPreferredTargetKey !== null
    && (
      selectedSessionKey !== composerPreferredTargetKey
      || (
        !composerActive
        && composerPreparingTargetKey !== composerPreferredTargetKey
        && !newSessionModalOpen
        && !worktreeModalOpen
      )
    )
  ) {
    setComposerPreferredTargetKey(null)
  }
}

export type DraftRestoreEffectContext = {
  composerTargetSessionIdentity: string | null
  composerDraftStorageKeyRef: React.RefObject<string | null>
  composerTextareaRef: React.RefObject<TextareaRenderable | null>
  composerDraftRef: React.RefObject<string>
  writeWorkspaceDraft: (key: string, text: string) => void
  writeWorkspaceDraftParts: (key: string, parts: unknown[]) => void
  composerPromptPartsRef: React.RefObject<ComposerPromptPart[]>
  setComposerMentionAttachments: React.Dispatch<React.SetStateAction<SendAttachment[]>>
  readWorkspaceDraft: (key: string) => string
  readWorkspaceDraftParts: (key: string) => unknown[]
  setComposerPromptParts: React.Dispatch<React.SetStateAction<ComposerPromptPart[]>>
  setComposerDraft: (action: React.SetStateAction<string>) => void
  restoreComposerPromptPartExtmarks: (parts: ComposerPromptPart[], text: string) => void
}

export function runDraftRestoreEffect(ctx: DraftRestoreEffectContext) {
  const {
    composerTargetSessionIdentity, composerDraftStorageKeyRef, composerTextareaRef,
    composerDraftRef, writeWorkspaceDraft, writeWorkspaceDraftParts, composerPromptPartsRef,
    setComposerMentionAttachments, readWorkspaceDraft, readWorkspaceDraftParts,
    setComposerPromptParts, setComposerDraft, restoreComposerPromptPartExtmarks,
  } = ctx
  if (!composerTargetSessionIdentity) return
  const key = composerTargetSessionIdentity
  const previousKey = composerDraftStorageKeyRef.current
  if (previousKey && previousKey !== key) {
    const outgoingDraft = composerTextareaRef.current?.plainText ?? composerDraftRef.current
    writeWorkspaceDraft(previousKey, outgoingDraft)
    writeWorkspaceDraftParts(previousKey, composerPromptPartsRef.current)
    // Attachments are not persisted, so clear them rather than leaking them
    // into a different session's composer.
    setComposerMentionAttachments(keepEmpty)
    composerTextareaRef.current?.extmarks.clear()
  }
  composerDraftStorageKeyRef.current = key
  const saved = readWorkspaceDraft(key)
  // The content behind the draft's placeholders, restored with it: text
  // alone brought back "[Pasted ~200 lines]" with nothing behind it.
  const savedParts = (readWorkspaceDraftParts(key) as ComposerPromptPart[])
    .filter((part) => part && typeof part.marker === 'string' && saved.includes(part.marker))
  composerPromptPartsRef.current = savedParts
  setComposerPromptParts((current) => current.length === 0 && savedParts.length === 0 ? current : savedParts)
  if (saved !== composerDraftRef.current) {
    composerDraftRef.current = saved
    setComposerDraft(saved)
    composerTextareaRef.current?.setText(saved)
  }
  if (savedParts.length > 0) restoreComposerPromptPartExtmarks(savedParts, saved)
}

export type QueuedSendDrainEffectContext = {
  activeQueuedComposerSends: QueuedComposerSend[]
  runningRegistryReady: boolean
  composerSendState: SendState
  composerAbortRef: React.MutableRefObject<AbortController | null>
  composerRetryTimerRef: React.MutableRefObject<NodeJS.Timeout | null>
  reattachedRunning: boolean
  composerTargetTurnKnownRunning: boolean
  queuedComposerSendsRef: React.RefObject<QueuedComposerSend[]>
  commitQueuedComposerSends: (next: QueuedComposerSend[]) => void
  sendComposerMessage: (draftOverride?: string, attachmentsOverride?: SendAttachment[], isRetry?: boolean, promptPartsOverride?: ComposerPromptPart[], retryTurnRequestId?: string) => Promise<void>
}

export function runQueuedSendDrainEffect(ctx: QueuedSendDrainEffectContext) {
  const {
    activeQueuedComposerSends, runningRegistryReady, composerSendState, composerAbortRef,
    composerRetryTimerRef, reattachedRunning, composerTargetTurnKnownRunning,
    queuedComposerSendsRef, commitQueuedComposerSends, sendComposerMessage,
  } = ctx
  if (activeQueuedComposerSends.length === 0) return
  if (!runningRegistryReady) return
  if (composerSendState !== 'idle' || composerAbortRef.current || composerRetryTimerRef.current) return
  // A turn we reattached to is still running server-side — flushing now
  // would start a second concurrent turn. The registry poll clears the flag
  // when the turn ends.
  if (reattachedRunning || composerTargetTurnKnownRunning) return
  const next = activeQueuedComposerSends[0]!
  const remaining = removeComposerQueueItem(queuedComposerSendsRef.current, next.id)
  // Persist dequeue before provider I/O so a process crash cannot replay a
  // prompt that may already have reached a tool-capable agent.
  commitQueuedComposerSends(remaining)
  void sendComposerMessage(next.text, next.attachments, false, next.promptParts)
}

export type ComposerDraftPersistEffectContext = {
  composerTextareaRef: React.RefObject<TextareaRenderable | null>
  composerDraftRef: React.RefObject<string>
  composerDraftStorageKeyRef: React.RefObject<string | null>
  writeWorkspaceDraft: (key: string, text: string) => void
  writeWorkspaceDraftParts: (key: string, parts: unknown[]) => void
  composerPromptPartsRef: React.RefObject<ComposerPromptPart[]>
  setComposerDraft: (action: React.SetStateAction<string>) => void
  surfacePluginKeyCaptureRef: React.RefObject<TuiPluginCapture>
  windowSurfaceCaptureRef: React.RefObject<Map<string, boolean | 'input' | 'terminal' | 'none'>>
  composerSessions: { get<T>(key: string, name: string, initial: T | (() => T)): T; set<T>(key: string, name: string, initial: T | (() => T), action: React.SetStateAction<T>): void; subscribe(key: string, name: string, listener: () => void): () => void; ref<T>(key: string, name: string, initial: T): React.MutableRefObject<T>; peekRef<T>(key: string, name: string): React.MutableRefObject<T> | undefined; same(a: string, b: string): boolean; rekey(from: string, to: string): void; keys(): string[]; }
  workspaceContext: WorkspaceContextValue
}

export function runComposerDraftPersistEffect(ctx: ComposerDraftPersistEffectContext) {
  const {
    composerTextareaRef, composerDraftRef, composerDraftStorageKeyRef, writeWorkspaceDraft,
    writeWorkspaceDraftParts, composerPromptPartsRef, setComposerDraft, surfacePluginKeyCaptureRef,
    windowSurfaceCaptureRef, composerSessions, workspaceContext,
  } = ctx
  const capture = () => {
    const text = composerTextareaRef.current?.plainText ?? composerDraftRef.current
    if (composerDraftStorageKeyRef.current) {
      writeWorkspaceDraft(composerDraftStorageKeyRef.current, text)
      writeWorkspaceDraftParts(composerDraftStorageKeyRef.current, composerPromptPartsRef.current)
    }
    setComposerDraft(text)
  }
  const leave = () => {
    capture()
    // A shell gives the keys back on leaving; a view's own text input keeps its claim.
    if (typeof surfacePluginKeyCaptureRef.current === 'string') surfacePluginKeyCaptureRef.current = false
    windowSurfaceCaptureRef.current.clear()
    for (const key of composerSessions.keys()) {
      composerSessions.peekRef<AbortController | null>(key, 'composerAbortRef')?.current?.abort()
      composerSessions.set(key, 'composerSendState', 'idle', 'idle')
    }
    try { workspaceContext.controller.flush() } catch { /* next update retries */ }
  }
  workspaceContext.runtime.flushers.add(capture)
  workspaceContext.runtime.beforeLeave = leave
  return () => { workspaceContext.runtime.flushers.delete(capture); if (workspaceContext.runtime.beforeLeave === leave) workspaceContext.runtime.beforeLeave = null }
}

export type PlanLimitsEffectContext = {
  composerTargetSession: Session | null
  setComposerPlanLimits: React.Dispatch<React.SetStateAction<ClaudePlanLimits | null>>
  composerActive: boolean
  turnRunningForComposer: boolean
}

export function runPlanLimitsEffect(ctx: PlanLimitsEffectContext) {
  const {
    composerTargetSession, setComposerPlanLimits, composerActive, turnRunningForComposer,
  } = ctx
  const target = composerTargetSession
  if (!target || target.provider !== 'claude') {
    setComposerPlanLimits(null)
    return
  }
  setComposerPlanLimits(peekTuiClaudePlanLimits(target))
  if (!composerActive || turnRunningForComposer) return
  let cancelled = false
  void readTuiClaudePlanLimits(target)
    .then((limits) => { if (!cancelled && limits) setComposerPlanLimits(limits) })
    .catch(() => {})
  return () => { cancelled = true }
}

export type ComposerMentionSearchEffectContext = {
  composerMention: { start: number; query: string; } | null
  setComposerMentionResults: React.Dispatch<React.SetStateAction<TuiMentionResult[]>>
  composerMentionProvider: 'claude' | 'acp' | 'codex' | 'opencode' | 'copilot' | 'pi' | 'lmstudio' | 'claude-acp' | 'codex-acp'
  composerMentionAgents: SessionComposerAgentOption[]
  composerMentionCwd: string | null
  setComposerMentionIndex: React.Dispatch<React.SetStateAction<number>>
}

export function runComposerMentionSearchEffect(ctx: ComposerMentionSearchEffectContext) {
  const {
    composerMention, setComposerMentionResults, composerMentionProvider, composerMentionAgents,
    composerMentionCwd, setComposerMentionIndex,
  } = ctx
  if (!composerMention) {
    setComposerMentionResults(keepEmpty)
    return
  }
  const agentMatches: TuiMentionResult[] = composerMentionProvider === 'opencode'
    ? composerMentionAgents
        .filter((agent) => {
          const query = composerMention.query.toLowerCase()
          if (!query) return true
          return agent.value.toLowerCase().includes(query)
            || agent.label.toLowerCase().includes(query)
            || (agent.description?.toLowerCase().includes(query) ?? false)
        })
        .slice(0, 8)
        .map((agent) => ({
          kind: 'agent' as const,
          name: agent.value,
          description: agent.description,
          mode: agent.mode,
        }))
    : []
  const cwd = composerMentionCwd
  if (!cwd) {
    setComposerMentionResults(agentMatches)
    setComposerMentionIndex(0)
    return
  }
  let cancelled = false
  const handle = setTimeout(() => {
    void (async () => {
      try {
        const all = await listProjectFiles(cwd, runGitCommand)
        if (cancelled) return
        // The substring + fuzzy-subsequence scan over `all` (up to 5 000
        // entries) is CPU-bound — run it off the render/input thread so a
        // large repo doesn't stall the composer while the user is typing.
        // Ranking happens in the worker, before the 12-result cap: a bare `@`
        // matches every file, so slicing first would leave frecency nothing
        // to order. Scores come from the in-process table, so this is a map
        // read rather than a file read per keystroke.
        const fileMatches = await filterComposerMentionFilesAsync(
          all,
          composerMention.query,
          12,
          Object.fromEntries(readFrecencyScores()),
          frecencyPrefix(cwd),
        )
        if (cancelled) return
        const matches: TuiMentionResult[] = [
          ...agentMatches,
          ...fileMatches.map((entry) => ({ kind: 'file' as const, ...entry })),
        ]
        setComposerMentionResults(matches)
        setComposerMentionIndex(0)
      } catch {
        if (!cancelled) setComposerMentionResults(agentMatches)
      }
    })()
  }, 60)
  return () => {
    cancelled = true
    clearTimeout(handle)
  }
}

export type ComposerPrewarmEffectContext = {
  transcriptSession: Session | null
  committedSessionKey: string | null
  sessionsByKeyRef: React.RefObject<Map<string, Session>>
  composerActive: boolean
  composerAffordancesCacheRef: React.RefObject<Map<string, { commands: SlashCommandSuggestion[]; options: Awaited<ReturnType<typeof readViewSessionComposerOptions>>; ts: number; }>>
  composerPrewarmInFlightRef: React.RefObject<Set<string>>
  tuiModelOverride: Record<string, string>
  tuiEffort: TuiEffort
  fetchComposerAffordances: (target: Session, key: string) => Promise<void>
}

export function runComposerPrewarmEffect(ctx: ComposerPrewarmEffectContext) {
  const {
    transcriptSession, committedSessionKey, sessionsByKeyRef, composerActive,
    composerAffordancesCacheRef, composerPrewarmInFlightRef, tuiModelOverride, tuiEffort,
    fetchComposerAffordances,
  } = ctx
  // Most providers can warm on selection without mutating the session.
  // Existing Claude sessions cannot: SDK resume rewrites the transcript and
  // moves its last-activity mtime, so their prewarm waits for composer use.
  const target = transcriptSession
  if (!target || !committedSessionKey) return
  const fullSession = sessionsByKeyRef.current.get(committedSessionKey)
  const isPending = fullSession?.isPending === true
  // Pi's ~19s cold open is what prewarm hides for a pending session
  // (createPiAgentSession is idempotent on the id). Claude also benefits:
  // prewarmViewSession forces the SDK to adopt the reserved id as its real
  // session id, so the first real send finds a warm pool entry instead of
  // cold-spawning. ACP sessions are also pool-owned and can start against the
  // reserved id. Pending Codex/Copilot sessions still have no resumable
  // identity yet, so prewarmViewSession no-ops them — skip the work here too.
  if (!shouldPrewarmTuiRuntime(target.provider, isPending, composerActive)) return
  const needsAffordances = !isPending && (() => {
    const cached = composerAffordancesCacheRef.current.get(committedSessionKey)
    return !cached || Date.now() - cached.ts >= COMPOSER_AFFORDANCES_TTL_MS
  })()
  let cancelled = false
  const prewarm = composerPrewarmInFlightRef.current.has(committedSessionKey)
    ? Promise.resolve()
    : (() => {
        composerPrewarmInFlightRef.current.add(committedSessionKey)
        return prewarmTuiSession(
          { ...target, cwd: fullSession?.cwd },
          {
            model: tuiModelOverride[committedSessionKey] || undefined,
            effort: tuiEffort === 'auto' ? undefined : tuiEffort,
            isPending,
          },
        ).catch(() => { /* best-effort: the send pays the usual cold cost */ })
          .finally(() => { composerPrewarmInFlightRef.current.delete(committedSessionKey) })
      })()
  if (needsAffordances) {
    void prewarm.then(() => {
      if (!cancelled) void fetchComposerAffordances(target, committedSessionKey)
    })
  }
  return () => { cancelled = true }
// eslint-disable-next-line react-hooks/exhaustive-deps
}

export type ComposerAffordancesClearEffectContext = {
  transcriptSession: Session | null
  committedSessionKey: string | null
  clearComposerAffordances: () => void
  composerAffordancesCacheRef: React.RefObject<Map<string, { commands: SlashCommandSuggestion[]; options: Awaited<ReturnType<typeof readViewSessionComposerOptions>>; ts: number; }>>
  applyComposerAffordances: (target: Session, commands: SlashCommandSuggestion[], composerOptions: Awaited<ReturnType<typeof readViewSessionComposerOptions>>) => void
  composerActiveRef: React.RefObject<boolean>
  fetchComposerAffordances: (target: Session, key: string) => Promise<void>
}

export function runComposerAffordancesClearEffect(ctx: ComposerAffordancesClearEffectContext) {
  const {
    transcriptSession, committedSessionKey, clearComposerAffordances, composerAffordancesCacheRef,
    applyComposerAffordances, composerActiveRef, fetchComposerAffordances,
  } = ctx
  const target = transcriptSession
  if (!target || !committedSessionKey) {
    clearComposerAffordances()
    return
  }
  const cached = composerAffordancesCacheRef.current.get(committedSessionKey)
  if (cached && Date.now() - cached.ts < COMPOSER_AFFORDANCES_TTL_MS) {
    applyComposerAffordances(target, cached.commands, cached.options)
    return
  }
  // Don't let the previous session's commands/agents linger while (or
  // whether) this session's fetch runs.
  clearComposerAffordances()
  if ((target.provider ?? 'claude') === 'claude' && !composerActiveRef.current) return
  void fetchComposerAffordances(target, committedSessionKey)
// eslint-disable-next-line react-hooks/exhaustive-deps
}
