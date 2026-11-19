/** @jsxImportSource @opentui/react */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { TextareaRenderable } from '@opentui/core'
import type { AgentProvider, Session } from '../../../lib/types'
import type { PlaybookSummary, ProtocolAutonomy, StartProtocolRunParams } from '../../../lib/agentProtocol'
import type { TuiPluginViewProps, TuiPluginKeyEvent } from '../../../tui/opentui/shell/sdk'
import { createPluginResourceScope } from '../../../tui/opentui/shell/sdk'
import { WorkflowForm } from './WorkflowForm'
import { PlaybookManagerPopover } from './PlaybookManagerPopover'
import { type CoordModalFocus, moveCoordModalFocus, cycleCoordProvider, coordRunProviders, cycleCoordAutonomy, parseCoordContractLines } from './runSetup'

export function NewWorkflowSurface(props: TuiPluginViewProps) {
  return <NewWorkflow key={props.services.repository!.cwd} {...props} />
}
function NewWorkflow({ services, useState: usePluginState, instanceId, theme, width, height, placement, focused, zIndex, registerKeys, setCapture, close, detach }: TuiPluginViewProps) {
  const launch = services['run-launch']!
  const cwd = services.repository!.cwd
  const [captured, setCaptured] = usePluginState('launch-target', {
    defaults: { ...launch.defaults, provider: launch.defaults?.provider ?? services.session?.session?.provider ?? 'claude' as AgentProvider },
    session: services.session?.session ? { ...services.session.session } : null,
  })
  // Write initial defaults into scoped state so a relocation carries the capture.
  useLayoutEffect(() => { setCaptured(captured) }, [captured, setCaptured])
  const provider = captured.defaults.provider
  const selectedSession: Session | null = captured.session
  const [coordDraft, setCoordDraft] = usePluginState('coordDraft', captured.defaults.prompt ?? '')
  const [coordAcceptanceDraft, setCoordAcceptanceDraft] = usePluginState('coordAcceptanceDraft', '')
  const [coordNonGoalsDraft, setCoordNonGoalsDraft] = usePluginState('coordNonGoalsDraft', '')
  const [coordManualQaDraft, setCoordManualQaDraft] = usePluginState('coordManualQaDraft', '')
  const [coordEscalationDraft, setCoordEscalationDraft] = usePluginState('coordEscalationDraft', '')
  const [coordPlaybookName, setCoordPlaybookName] = usePluginState<string | null>('coordPlaybookName', null)
  const [coordPlaybookArgsDraft, setCoordPlaybookArgsDraft] = usePluginState('coordPlaybookArgsDraft', '')
  // Total agent budget for the next run, including the lead.
  const [coordMaxAgents, setCoordMaxAgents] = usePluginState('coordMaxAgents', 3)
  // Quality gate command (TaskCompleted-hook equivalent) for the next run.
  const [coordGateDraft, setCoordGateDraft] = usePluginState('coordGateDraft', '')
  // Plan-approval guard: teammates must plan first and wait for lead approval.
  const [coordRequirePlanApproval, setCoordRequirePlanApproval] = usePluginState('coordRequirePlanApproval', true)
  const [coordAutonomy, setCoordAutonomy] = usePluginState<ProtocolAutonomy>('coordAutonomy', 'medium')
  const [coordRequireReview, setCoordRequireReview] = usePluginState('coordRequireReview', true)
  const [coordMaxTokens, setCoordMaxTokens] = usePluginState('coordMaxTokens', '')
  const [coordMaxDurationMinutes, setCoordMaxDurationMinutes] = usePluginState('coordMaxDurationMinutes', '')
  // Isolate teammate edits by default, with an explicit shared-checkout mode.
  const [coordUseWorktrees, setCoordUseWorktrees] = usePluginState('coordUseWorktrees', true)
  const [coordProviderOverride, setCoordProviderOverride] = usePluginState<AgentProvider | null>('coordProviderOverride', null)
  const [coordTeammateProviderOverride, setCoordTeammateProviderOverride] = usePluginState<AgentProvider[] | null>('coordTeammateProviderOverride', null)
  const [coordProviderPoolIndex, setCoordProviderPoolIndex] = usePluginState('coordProviderPoolIndex', 0)
  const [coordModalFocus, setCoordModalFocus] = usePluginState<CoordModalFocus>('coordModalFocus', 'prompt')

  const [coordBusy, setCoordBusy] = useState(false)
  const [coordError, setCoordError] = useState<string | null>(null)
  const [coordPlaybooks, setCoordPlaybooks] = useState<PlaybookSummary[]>([])
  const [managingPlaybooks, setManagingPlaybooks] = usePluginState('managing-playbooks', false)
  const coordTextareaRef = useRef<TextareaRenderable | null>(null)
  const pending = useRef(false)
  const scopeRef = useRef<ReturnType<typeof createPluginResourceScope> | null>(null)
  const managerKeys = useRef<((key: TuiPluginKeyEvent) => boolean) | null>(null)
  const registerManagerKeys = useCallback((handler: (key: TuiPluginKeyEvent) => boolean) => { managerKeys.current = handler }, [])
  const onNotice = services.notices?.show
  const showToggleOutcome = (label: string, value: boolean) => onNotice?.('info', `${label}: ${value ? 'on' : 'off'}`)
  useEffect(() => {
    const scope = createPluginResourceScope('coordination')
    scopeRef.current = scope
    return () => { scope.dispose(); if (scopeRef.current === scope) scopeRef.current = null }
  }, [instanceId, cwd])
  const isActive = (scope: ReturnType<typeof createPluginResourceScope> | null) => Boolean(scope && scopeRef.current === scope && !scope.signal.aborted)
  const selectCoordPlaybook = (name: string | null, available = coordPlaybooks) => {
    setCoordPlaybookName(name)
    setCoordPlaybookArgsDraft('')
    if (!name) return
    const selected = available.find((entry) => entry.name === name)
    if (!selected) return
    if (selected.maxAgents) setCoordMaxAgents(Math.min(6, Math.max(2, selected.maxAgents)))
    if (selected.gateCommand !== undefined) setCoordGateDraft(selected.gateCommand)
    if (selected.requirePlanApproval !== undefined) setCoordRequirePlanApproval(selected.requirePlanApproval)
    if (selected.autonomy) setCoordAutonomy(selected.autonomy)
    if (selected.requireReview !== undefined) setCoordRequireReview(selected.requireReview)
    if (selected.budget?.maxTokens !== undefined) setCoordMaxTokens(String(selected.budget.maxTokens))
    if (selected.budget?.maxDurationMinutes !== undefined) setCoordMaxDurationMinutes(String(selected.budget.maxDurationMinutes))
  }

  useEffect(() => {
    if (managingPlaybooks) return
    const scope = scopeRef.current
    if (!scope) return
    const controller = new AbortController()
    const abort = () => controller.abort()
    scope.signal.addEventListener('abort', abort, { once: true })
    void services.playbooks!.list(cwd, controller.signal).then(listing => {
      if (!isActive(scope) || controller.signal.aborted) return
      setCoordPlaybooks(listing.playbooks)
      if (coordPlaybookName && !listing.playbooks.some(entry => entry.name === coordPlaybookName)) selectCoordPlaybook(null, listing.playbooks)
      if (listing.invalid.length) setCoordError(`${listing.invalid.length} invalid playbook files — open Manage to inspect them`)
    }).catch(error => { if (isActive(scope) && !controller.signal.aborted) setCoordError(error instanceof Error ? error.message : 'Failed to load playbooks') })
    return () => { controller.abort(); scope.signal.removeEventListener('abort', abort) }
  }, [services.playbooks, cwd, managingPlaybooks])

  const handleCoordContentChange = () => {
    setCoordDraft(coordTextareaRef.current?.plainText ?? '')
    if (coordError) setCoordError(null)
  }
  const submitCoordinatedRun = async () => {
    const scope = scopeRef.current
    if (!scope || !isActive(scope) || pending.current) return
    const prompt = (coordTextareaRef.current?.plainText ?? coordDraft).trim()
    const selectedPlaybook = coordPlaybooks.find(entry => entry.name === coordPlaybookName)
    if (!prompt && !selectedPlaybook) { setCoordError('Add a workflow brief or select a playbook'); return }
    if (selectedPlaybook?.expectsArgs && !coordPlaybookArgsDraft.trim()) { setCoordError('This playbook requires arguments'); return }
    const positive = (value: string, label: string) => {
      if (!value.trim()) return undefined
      const number = Number(value)
      if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} must be a positive number`)
      return number
    }
    let params: StartProtocolRunParams
    try {
      let playbookArgs: unknown = undefined
      if (coordPlaybookArgsDraft.trim()) {
        try { playbookArgs = JSON.parse(coordPlaybookArgsDraft) } catch { playbookArgs = coordPlaybookArgsDraft.trim() }
      }
      const targetProvider = coordProviderOverride ?? provider
      const sameProvider = targetProvider === captured.defaults.provider
      const providerInstanceId = selectedSession?.provider === targetProvider ? selectedSession.providerInstanceId : sameProvider ? captured.defaults.providerInstanceId : undefined
      const maxTokens = positive(coordMaxTokens, 'Token budget')
      const maxDurationMinutes = positive(coordMaxDurationMinutes, 'Duration budget')
      params = {
        prompt, baseCwd: cwd, playbookName: selectedPlaybook?.name, playbookArgs,
        provider: targetProvider, providerInstanceId,
        teammateProviders: coordTeammateProviderOverride ?? [targetProvider], maxAgents: coordMaxAgents,
        title: (prompt || selectedPlaybook?.name || 'Coordinated run').slice(0, 40),
        model: sameProvider ? captured.defaults.model : undefined,
        effort: sameProvider ? captured.defaults.effort : undefined,
        gateCommand: coordGateDraft.trim() || undefined, requirePlanApproval: coordRequirePlanApproval,
        autonomy: coordAutonomy, requireReview: coordRequireReview, useWorktrees: coordUseWorktrees,
        acceptanceContract: { goal: prompt || selectedPlaybook?.name || 'Complete the coordinated workflow',
          userVisibleAcceptance: parseCoordContractLines(coordAcceptanceDraft), nonGoals: parseCoordContractLines(coordNonGoalsDraft),
          verificationCommands: [coordGateDraft.trim()].filter(Boolean), manualQa: parseCoordContractLines(coordManualQaDraft),
          escalationTriggers: parseCoordContractLines(coordEscalationDraft) },
        budget: maxTokens !== undefined || maxDurationMinutes !== undefined ? { maxTokens, maxDurationMinutes } : undefined,
      }
    } catch (error) { setCoordError(error instanceof Error ? error.message : 'Invalid workflow settings'); return }
    pending.current = true
    setCoordBusy(true)
    setCoordError(null)
    try {
      const result = await launch.start(params, scope.signal)
      if (!isActive(scope)) return
      onNotice?.('info', selectedPlaybook ? `Playbook ${selectedPlaybook.name} started` : 'Coordinated run started — lead is planning the task board', 5000)
      close()
      services.coordination?.revealRun?.(result.snapshot)
    } catch (error) {
      if (isActive(scope)) setCoordError(error instanceof Error ? error.message : 'Failed to start coordinated run')
    } finally {
      pending.current = false
      const active = isActive(scope)
      setCoordBusy(previous => active ? false : previous)
    }
  }
  const handleKey = (key: TuiPluginKeyEvent): boolean => {
    let consumed = false
    const handled = (action: () => void) => { consumed = true; action() }
    const isCtrl = (name: string) => key.ctrl && key.name === name
    if (key.name === 'escape') { close(); return true }
    if (key.name === 'tab') {
        handled(() => setCoordModalFocus((current) => moveCoordModalFocus(current, key.shift ? -1 : 1)))
      } else if (isCtrl('t')) {
        handled(() => setCoordMaxAgents((current) => (current >= 6 ? 2 : current + 1)))
      } else if (isCtrl('p')) {
        handled(() => setCoordRequirePlanApproval((current) => {
          const next = !current
          showToggleOutcome('Plan approval', next)
          return next
        }))
      } else if ((key.name === 'left' || key.name === 'right' || key.name === 'up' || key.name === 'down') && coordModalFocus === 'playbook') {
        const direction = key.name === 'left' || key.name === 'up' ? -1 : 1
        handled(() => {
          const options = [null, ...coordPlaybooks.map((entry) => entry.name)]
          const index = Math.max(0, options.indexOf(coordPlaybookName))
          selectCoordPlaybook(options[(index + direction + options.length) % options.length] ?? null)
        })
      } else if ((key.name === 'return' || key.name === 'm') && coordModalFocus === 'playbook') {
        handled(() => setManagingPlaybooks(true))
      } else if ((key.name === 'left' || key.name === 'right' || key.name === 'up' || key.name === 'down') && coordModalFocus === 'provider') {
        const direction = key.name === 'left' || key.name === 'up' ? -1 : 1
        handled(() => {
          const suggested = provider
          setCoordProviderOverride((current) => cycleCoordProvider(current ?? suggested, direction))
        })
      } else if ((key.name === 'left' || key.name === 'right' || key.name === 'up' || key.name === 'down') && coordModalFocus === 'pool') {
        const direction = key.name === 'left' || key.name === 'up' ? -1 : 1
        handled(() => setCoordProviderPoolIndex((current) => (current + direction + coordRunProviders().length) % coordRunProviders().length))
      } else if ((key.name === 'return' || key.name === 'space' || key.sequence === ' ') && coordModalFocus === 'pool') {
        handled(() => {
          const selectedProvider = coordRunProviders()[coordProviderPoolIndex]!
          const suggested = provider
          const leadProvider = coordProviderOverride ?? suggested
          setCoordTeammateProviderOverride((current) => {
            const pool = current ?? [leadProvider]
            if (!pool.includes(selectedProvider)) return [...pool, selectedProvider]
            const next = pool.filter((entry) => entry !== selectedProvider)
            return next.length > 0 ? next : [leadProvider]
          })
        })
      } else if ((key.name === 'left' || key.name === 'right' || key.name === 'up' || key.name === 'down') && coordModalFocus === 'agents') {
        const direction = key.name === 'left' || key.name === 'down' ? -1 : 1
        handled(() => setCoordMaxAgents((current) => Math.min(6, Math.max(2, current + direction))))
      } else if ((key.name === 'return' || key.name === 'space' || key.sequence === ' ') && coordModalFocus === 'worktrees') {
        handled(() => setCoordUseWorktrees((current) => {
          const next = !current
          showToggleOutcome('Coordinator worktrees', next)
          return next
        }))
      } else if ((key.name === 'left' || key.name === 'right' || key.name === 'up' || key.name === 'down') && coordModalFocus === 'autonomy') {
        const direction = key.name === 'left' || key.name === 'up' ? -1 : 1
        handled(() => setCoordAutonomy((current) => cycleCoordAutonomy(current, direction)))
      } else if ((key.name === 'return' || key.name === 'space' || key.sequence === ' ') && coordModalFocus === 'plans') {
        handled(() => setCoordRequirePlanApproval((current) => {
          const next = !current
          showToggleOutcome('Plan approval', next)
          return next
        }))
      } else if ((key.name === 'return' || key.name === 'space' || key.sequence === ' ') && coordModalFocus === 'review') {
        handled(() => setCoordRequireReview((current) => {
          const next = !current
          showToggleOutcome('Judgment review', next)
          return next
        }))
      } else if (key.name === 'return' && coordModalFocus === 'launch') {
        handled(() => { void submitCoordinatedRun() })
      } else if (key.name === 'return' && coordModalFocus === 'playbookArgs') {
        handled(() => setCoordModalFocus('provider'))
      } else if (key.name === 'return' && coordModalFocus !== 'prompt') {
        handled(() => setCoordModalFocus((current) => moveCoordModalFocus(current, 1)))
      }

    return consumed
  }
  useEffect(() => {
    registerKeys(key => managingPlaybooks ? managerKeys.current?.(key) ?? true : handleKey(key))
    return () => registerKeys(null)
  })
  useEffect(() => { setCapture(focused); return () => setCapture(false) }, [focused, setCapture])
  if (managingPlaybooks) return <PlaybookManagerPopover service={services.playbooks!} useState={usePluginState} cwd={cwd}
    theme={theme} width={width} height={height} docked={placement !== 'overlay'}
    onClose={() => setManagingPlaybooks(false)} onNotice={services.notices?.show ?? (() => {})}
    onKeyHandlerReady={registerManagerKeys} onDetach={detach} />
  return <WorkflowForm zIndex={zIndex} accountId={selectedSession?.provider === provider ? selectedSession.providerInstanceId : captured.defaults.providerInstanceId} cwd={cwd} docked={placement !== 'overlay'} onDetach={detach} focused={focused} coordModalOpen width={width} height={height} coordError={coordError} provider={provider} selectedSession={selectedSession} coordProviderOverride={coordProviderOverride} coordTeammateProviderOverride={coordTeammateProviderOverride} coordPlaybookName={coordPlaybookName} coordPlaybooks={coordPlaybooks} coordPlaybookArgsDraft={coordPlaybookArgsDraft} coordDraft={coordDraft} coordModalFocus={coordModalFocus} theme={theme} coordTextareaRef={coordTextareaRef} handleCoordContentChange={handleCoordContentChange} submitCoordinatedRun={submitCoordinatedRun} composerBaseTextareaStyle={{ backgroundColor: theme.surface, textColor: theme.text, focusedBackgroundColor: theme.surface, focusedTextColor: theme.text, placeholderColor: theme.dim }} coordAcceptanceDraft={coordAcceptanceDraft} setCoordAcceptanceDraft={setCoordAcceptanceDraft} coordNonGoalsDraft={coordNonGoalsDraft} setCoordNonGoalsDraft={setCoordNonGoalsDraft} coordManualQaDraft={coordManualQaDraft} setCoordManualQaDraft={setCoordManualQaDraft} coordEscalationDraft={coordEscalationDraft} setCoordEscalationDraft={setCoordEscalationDraft} setCoordPlaybookArgsDraft={setCoordPlaybookArgsDraft} setCoordModalFocus={setCoordModalFocus} coordProviderPoolIndex={coordProviderPoolIndex} coordMaxAgents={coordMaxAgents} coordMaxTokens={coordMaxTokens} setCoordMaxTokens={setCoordMaxTokens} coordMaxDurationMinutes={coordMaxDurationMinutes} setCoordMaxDurationMinutes={setCoordMaxDurationMinutes} coordUseWorktrees={coordUseWorktrees} coordGateDraft={coordGateDraft} setCoordGateDraft={setCoordGateDraft} coordRequirePlanApproval={coordRequirePlanApproval} coordAutonomy={coordAutonomy} coordRequireReview={coordRequireReview} coordBusy={coordBusy} />
}
