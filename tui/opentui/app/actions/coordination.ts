/** @jsxImportSource @opentui/react */
import type { RefObject } from 'react'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import React from 'react'
import { isPluginEnabled } from '../../../../lib/plugins/enablement'
import { type TextareaRenderable } from '@opentui/core'
import { startTuiProtocolRun, type TuiSessionDetail } from '../../../../lib/tui/service'
import { type PlaybookSummary, type ProtocolAutonomy } from '../../../../lib/agentProtocol'
import { type ProviderSelection, type Session } from '../../../../lib/types'
import { type TuiEffort, type NoticeTone } from '../types'
import { sessionKey } from '../sessionList'
import { parseCoordContractLines } from '../pickers'

export type SubmitCoordinatedRunContext = {
  coordTextareaRef: React.RefObject<TextareaRenderable | null>
  coordDraft: string
  coordPlaybookName: string | null
  coordPlaybooks: PlaybookSummary[]
  coordPlaybookArgsDraft: string
  coordStartInFlightRef: React.RefObject<boolean>
  setCoordBusy: React.Dispatch<React.SetStateAction<boolean>>
  setCoordError: React.Dispatch<React.SetStateAction<string | null>>
  provider: ProviderSelection
  selectedSession: Session | null
  coordProviderOverride: 'claude' | 'acp' | 'codex' | 'opencode' | 'copilot' | 'pi' | 'lmstudio' | 'claude-acp' | 'codex-acp' | null
  coordTeammateProviderOverride: ('claude' | 'acp' | 'codex' | 'opencode' | 'copilot' | 'pi' | 'lmstudio' | 'claude-acp' | 'codex-acp')[] | null
  sessionDetail: TuiSessionDetail | null
  coordMaxAgents: number
  tuiModelOverride: Record<string, string>
  selectedSessionKey: string | null
  tuiEffort: TuiEffort
  coordGateDraft: string
  coordRequirePlanApproval: boolean
  coordAutonomy: ProtocolAutonomy
  coordRequireReview: boolean
  coordAcceptanceDraft: string
  coordNonGoalsDraft: string
  coordManualQaDraft: string
  coordEscalationDraft: string
  coordMaxTokens: string
  coordMaxDurationMinutes: string
  coordUseWorktrees: boolean
  setOpenTabSessions: React.Dispatch<React.SetStateAction<Session[]>>
  setSelectedSessionKey: React.Dispatch<React.SetStateAction<string | null>>
  setCoordModalOpen: React.Dispatch<React.SetStateAction<boolean>>
  setCoordBoardRunId: React.Dispatch<React.SetStateAction<string | null>>
  setPluginOverlay: React.Dispatch<React.SetStateAction<'analytics' | 'file-history' | 'channel-bridge' | 'ide-bridge' | 'coordination' | 'diff' | 'files' | 'editor' | 'messaging' | 'tasks' | 'diagnostics' | 'terminal' | 'browser' | 'subagents' | 'pull-request' | 'checkpoints' | 'teammates' | 'desk' | null>>
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  setCoordDraft: React.Dispatch<React.SetStateAction<string>>
  setCoordAcceptanceDraft: React.Dispatch<React.SetStateAction<string>>
  setCoordNonGoalsDraft: React.Dispatch<React.SetStateAction<string>>
  setCoordManualQaDraft: React.Dispatch<React.SetStateAction<string>>
  setCoordEscalationDraft: React.Dispatch<React.SetStateAction<string>>
  setCoordPlaybookName: React.Dispatch<React.SetStateAction<string | null>>
  setCoordPlaybookArgsDraft: React.Dispatch<React.SetStateAction<string>>
  setCoordGateDraft: React.Dispatch<React.SetStateAction<string>>
  setCoordMaxTokens: React.Dispatch<React.SetStateAction<string>>
  setCoordMaxDurationMinutes: React.Dispatch<React.SetStateAction<string>>
  setCoordProviderOverride: React.Dispatch<React.SetStateAction<'claude' | 'acp' | 'codex' | 'opencode' | 'copilot' | 'pi' | 'lmstudio' | 'claude-acp' | 'codex-acp' | null>>
  setCoordTeammateProviderOverride: React.Dispatch<React.SetStateAction<('claude' | 'acp' | 'codex' | 'opencode' | 'copilot' | 'pi' | 'lmstudio' | 'claude-acp' | 'codex-acp')[] | null>>
  setCoordProviderPoolIndex: React.Dispatch<React.SetStateAction<number>>
  setCoordModalFocus: React.Dispatch<React.SetStateAction<'provider' | 'review' | 'agents' | 'prompt' | 'acceptance' | 'nonGoals' | 'manualQa' | 'escalation' | 'playbook' | 'playbookArgs' | 'pool' | 'tokenBudget' | 'durationBudget' | 'worktrees' | 'gate' | 'autonomy' | 'plans' | 'launch'>>
  coordWatchStateRef: React.RefObject<Map<string, { status: string; blockedAgents: Set<string>; }>>
  setCoordWatchIds: React.Dispatch<React.SetStateAction<string[]>>
  refreshSessions: (nextProvider: ProviderSelection, preserveSelection?: boolean, foreground?: boolean) => Promise<void>
}

export async function runSubmitCoordinatedRun(ctx: SubmitCoordinatedRunContext) {
  const {
    coordTextareaRef, coordDraft, coordPlaybookName, coordPlaybooks, coordPlaybookArgsDraft,
    coordStartInFlightRef, setCoordBusy, setCoordError, provider, selectedSession,
    coordProviderOverride, coordTeammateProviderOverride, sessionDetail, coordMaxAgents,
    tuiModelOverride, selectedSessionKey, tuiEffort, coordGateDraft, coordRequirePlanApproval,
    coordAutonomy, coordRequireReview, coordAcceptanceDraft, coordNonGoalsDraft,
    coordManualQaDraft, coordEscalationDraft, coordMaxTokens, coordMaxDurationMinutes,
    coordUseWorktrees, setOpenTabSessions, setSelectedSessionKey, setCoordModalOpen,
    setCoordBoardRunId, setPluginOverlay, showNotice, setCoordDraft, setCoordAcceptanceDraft,
    setCoordNonGoalsDraft, setCoordManualQaDraft, setCoordEscalationDraft, setCoordPlaybookName,
    setCoordPlaybookArgsDraft, setCoordGateDraft, setCoordMaxTokens, setCoordMaxDurationMinutes,
    setCoordProviderOverride, setCoordTeammateProviderOverride, setCoordProviderPoolIndex,
    setCoordModalFocus, coordWatchStateRef, setCoordWatchIds, refreshSessions,
  } = ctx
  // The textarea is the source of truth — onContentChange can lag onSubmit.
  const prompt = (coordTextareaRef.current?.plainText ?? coordDraft).trim()
  const selectedPlaybook = coordPlaybookName
    ? coordPlaybooks.find((entry) => entry.name === coordPlaybookName)
    : null
  const playbookArgsText = coordPlaybookArgsDraft.trim()
  if ((!prompt && !selectedPlaybook) || (selectedPlaybook?.expectsArgs && !playbookArgsText) || coordStartInFlightRef.current) return
  let playbookArgs: unknown = undefined
  if (playbookArgsText) {
    try { playbookArgs = JSON.parse(playbookArgsText) } catch { playbookArgs = playbookArgsText }
  }
  coordStartInFlightRef.current = true
  setCoordBusy(true)
  setCoordError(null)
  try {
    const suggestedProvider = provider === 'all' ? (selectedSession?.provider ?? 'claude') : provider
    const targetProvider = coordProviderOverride ?? suggestedProvider
    const teammateProviders = coordTeammateProviderOverride ?? [targetProvider]
    const baseCwd = selectedSession?.cwd ?? sessionDetail?.info?.cwd ?? process.cwd()
    const result = await startTuiProtocolRun({
      prompt,
      baseCwd,
      playbookName: selectedPlaybook?.name,
      playbookArgs,
      provider: targetProvider,
      teammateProviders,
      maxAgents: coordMaxAgents,
      title: (prompt || selectedPlaybook?.name || 'Coordinated run').slice(0, 40),
      model: tuiModelOverride[selectedSessionKey ?? ''] || undefined,
      effort: tuiEffort === 'auto' ? undefined : tuiEffort,
      gateCommand: coordGateDraft.trim() || undefined,
      requirePlanApproval: coordRequirePlanApproval,
      autonomy: coordAutonomy,
      requireReview: coordRequireReview,
      acceptanceContract: {
        goal: prompt || selectedPlaybook?.name || 'Complete the coordinated workflow',
        userVisibleAcceptance: parseCoordContractLines(coordAcceptanceDraft),
        nonGoals: parseCoordContractLines(coordNonGoalsDraft),
        verificationCommands: [coordGateDraft.trim()].filter(Boolean),
        manualQa: parseCoordContractLines(coordManualQaDraft),
        escalationTriggers: parseCoordContractLines(coordEscalationDraft),
      },
      budget: coordMaxTokens.trim() || coordMaxDurationMinutes.trim() ? {
        maxTokens: coordMaxTokens.trim() ? Number(coordMaxTokens) : undefined,
        maxDurationMinutes: coordMaxDurationMinutes.trim() ? Number(coordMaxDurationMinutes) : undefined,
      } : undefined,
      useWorktrees: coordUseWorktrees,
    })
    const drafts: Session[] = result.sessions.map((session) => ({
      sessionId: session.sessionId,
      provider: session.provider,
      cwd: session.cwd,
      createdAt: Date.now(),
      lastModified: Date.now(),
      summary: session.summary,
      isPending: session.isPending,
    }))
    setOpenTabSessions((prev) => {
      const seen = new Set(prev.map((tab) => sessionKey(tab)))
      const next = [...prev]
      for (const draft of drafts) {
        if (!seen.has(sessionKey(draft))) next.push(draft)
      }
      return next
    })
    const first = drafts[0]
    if (first) setSelectedSessionKey(sessionKey(first))
    setCoordModalOpen(false)
    setCoordBoardRunId(result.snapshot.run.id)
    // The run is started either way; only its view may be off.
    if (isPluginEnabled('coordination')) setPluginOverlay('coordination')
    else showNotice('info', 'Run started · the control center is off (Plugins, ⌃K palette)')
    setCoordDraft('')
    setCoordAcceptanceDraft('')
    setCoordNonGoalsDraft('')
    setCoordManualQaDraft('')
    setCoordEscalationDraft('')
    setCoordPlaybookName(null)
    setCoordPlaybookArgsDraft('')
    setCoordGateDraft('')
    setCoordMaxTokens('')
    setCoordMaxDurationMinutes('')
    setCoordProviderOverride(null)
    setCoordTeammateProviderOverride(null)
    setCoordProviderPoolIndex(0)
    setCoordModalFocus('prompt')
    // Watch the run in the background: the engineer gets notified on
    // completion or newly blocked teammates even with the board closed.
    coordWatchStateRef.current.set(result.snapshot.run.id, {
      status: result.snapshot.run.status,
      blockedAgents: new Set(),
    })
    setCoordWatchIds((prev) => [...prev, result.snapshot.run.id])
    await refreshSessions(provider, true, false)
    showNotice(
      'info',
      selectedPlaybook
        ? `Playbook ${selectedPlaybook.name} started — task board seeded without a planning turn`
        : 'Coordinated run started — lead is planning the task board',
      5000,
    )
  } catch (err) {
    setCoordError(err instanceof Error ? err.message : 'Failed to start coordinated run')
    showNotice('error', err instanceof Error ? err.message : 'Failed to start coordinated run')
  } finally {
    coordStartInFlightRef.current = false
    setCoordBusy(false)
  }
}
