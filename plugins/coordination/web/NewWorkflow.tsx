'use client'

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, BookOpen, CheckCircle2, Minus, Play, Plus, RefreshCw, Sparkles, Terminal } from 'lucide-react'
import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { getAssistantDisplayName } from '@/lib/provider'
import type { AgentProvider } from '@/lib/types'
import type { PlaybookSummary, ProtocolAutonomy, StartProtocolRunParams, StartProtocolRunResult } from '@/lib/agentProtocol'
import type { PluginPlaybookService } from '@/lib/plugins/playbooks'
import type { PluginRunLaunchService } from '@/lib/plugins/runLaunch'
import { createPluginResourceScope } from '@/lib/plugins/lifecycle'
import PlaybookManager, { type PlaybookScopedState } from './PlaybookManager'

const PROVIDER_ORDER = ['codex', 'claude', 'copilot', 'opencode', 'pi', 'acp'] as const
function nonEmptyLines(value: string) { return value.split('\n').map(line => line.trim()).filter(Boolean) }
function firstLine(value: string) { return value.split('\n')[0] ?? value }
function useLocalState<T>(_name: string, initial: T) { return useState(initial) }

type Props = {
  baseCwd: string
  ownerKey: string
  defaults?: PluginRunLaunchService['defaults']
  playbooksService: PluginPlaybookService
  launchService: PluginRunLaunchService
  useScopedState?: PlaybookScopedState
  onStarted?: (result: StartProtocolRunResult) => void
  onBack?: () => void
}

/** Model and effort defaults belong to one configured account. */
export function captureRunLaunchDefaults(defaults: PluginRunLaunchService['defaults'], provider: AgentProvider, providerInstanceId?: string) {
  const compatible = defaults?.provider === provider && (defaults.providerInstanceId ?? provider) === (providerInstanceId ?? provider)
  return { ...(compatible ? defaults : {}), provider, providerInstanceId }
}

function useRunSubmission(service: PluginRunLaunchService, ownerKey: string) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lifetime = useRef<{ ownerKey: string; signal: AbortSignal } | null>(null)
  const pending = useRef(false)
  useLayoutEffect(() => {
    const scope = createPluginResourceScope('coordination')
    lifetime.current = { ownerKey, signal: scope.signal }
    pending.current = false
    setBusy(previous => scope.signal.aborted ? previous : false)
    setError(null)
    return () => scope.dispose()
  }, [ownerKey, service])
  const submit = useCallback(async (params: StartProtocolRunParams, complete: (result: StartProtocolRunResult) => void) => {
    const current = lifetime.current
    if (!current || current.ownerKey !== ownerKey || current.signal.aborted || pending.current) return
    const { signal } = current
    pending.current = true; setBusy(true); setError(null)
    try {
      const result = await service.start(params, signal)
      if (!signal.aborted) complete(result)
    } catch (cause) { if (!signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally {
      if (!signal.aborted) pending.current = false
      setBusy(previous => signal.aborted ? previous : false)
    }
  }, [service, ownerKey])
  return { busy, error, submit }
}

function useWorkflowController({ baseCwd, ownerKey, defaults, playbooksService, launchService, useScopedState = useLocalState, onStarted, onBack }: Props) {
  const prefix = `new-workflow:${ownerKey}:`
  const [captured] = useScopedState(prefix + 'defaults', defaults ?? launchService.defaults ?? { provider: 'claude' as const })
  const { busy, error, submit } = useRunSubmission(launchService, ownerKey)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const showNotice = useCallback((text: string) => setNotice(text), [])
  const id = useId()
  const [promptDraft, setPromptDraft] = useScopedState(prefix + 'promptDraft', captured.prompt ?? '')
  const [playbooks, setPlaybooks] = useState<PlaybookSummary[]>([])
  const [playbookName, setPlaybookName] = useScopedState(prefix + 'playbookName', '')
  const [playbookArgs, setPlaybookArgs] = useScopedState(prefix + 'playbookArgs', '')
  const [playbookManagerOpen, setPlaybookManagerOpen] = useScopedState(prefix + 'playbookManagerOpen', false)
  const [maxAgents, setMaxAgents] = useScopedState(prefix + 'maxAgents', 3)
  const [runProviderOverride, setRunProviderOverride] = useScopedState<AgentProvider | null>(prefix + 'runProviderOverride', null)
  const [teammateProviderOverride, setTeammateProviderOverride] = useScopedState<AgentProvider[] | null>(prefix + 'teammateProviderOverride', null)
  const [gateCommand, setGateCommand] = useScopedState(prefix + 'gateCommand', '')
  const [requirePlanApproval, setRequirePlanApproval] = useScopedState(prefix + 'requirePlanApproval', true)
  const [autonomy, setAutonomy] = useScopedState<ProtocolAutonomy>(prefix + 'autonomy', 'medium')
  const [requireReview, setRequireReview] = useScopedState(prefix + 'requireReview', true)
  const [acceptanceCriteria, setAcceptanceCriteria] = useScopedState(prefix + 'acceptanceCriteria', '')
  const [nonGoals, setNonGoals] = useScopedState(prefix + 'nonGoals', '')
  const [manualQa, setManualQa] = useScopedState(prefix + 'manualQa', '')
  const [escalationTriggers, setEscalationTriggers] = useScopedState(prefix + 'escalationTriggers', '')
  const [maxTokens, setMaxTokens] = useScopedState(prefix + 'maxTokens', '')
  const [maxDurationMinutes, setMaxDurationMinutes] = useScopedState(prefix + 'maxDurationMinutes', '')
  const [useWorktrees, setUseWorktrees] = useScopedState(prefix + 'useWorktrees', true)
  const targetProvider = runProviderOverride ?? captured.provider
  const teammateProviders = teammateProviderOverride ?? [targetProvider]
  const selectedPlaybook = playbooks.find((entry) => entry.name === playbookName) ?? null
  const playbookArgsReady = !selectedPlaybook?.expectsArgs || playbookArgs.trim().length > 0
  const launchReady = Boolean(promptDraft.trim() || selectedPlaybook) && playbookArgsReady
  const playbookArgsHint = selectedPlaybook?.argsHint?.trim()
  const playbookArgsPlaceholder = playbookArgsHint && playbookArgsHint.toLowerCase() !== 'none'
    ? playbookArgsHint
    : selectedPlaybook?.expectsArgs ? 'Enter required JSON or text' : 'Add optional JSON or text'
  const selectPlaybook = useCallback((name: string, available = playbooks) => {
    setPlaybookName(name)
    setPlaybookArgs('')
    const selected = available.find((entry) => entry.name === name)
    if (!selected) return
    if (selected.maxAgents) setMaxAgents(Math.min(6, Math.max(2, selected.maxAgents)))
    if (selected.gateCommand !== undefined) setGateCommand(selected.gateCommand)
    if (selected.requirePlanApproval !== undefined) setRequirePlanApproval(selected.requirePlanApproval)
    if (selected.autonomy) setAutonomy(selected.autonomy)
    if (selected.requireReview !== undefined) setRequireReview(selected.requireReview)
  }, [playbooks, ownerKey])

  const handlePlaybooksChanged = useCallback((next: PlaybookSummary[], preferredName?: string) => {
    setPlaybooks(next)
    setPlaybookName((current) => {
      const target = preferredName ?? current
      return target && next.some((entry) => entry.name === target) ? target : ''
    })
    if (preferredName) {
      const selected = next.find((entry) => entry.name === preferredName)
      if (selected?.maxAgents) setMaxAgents(Math.min(6, Math.max(2, selected.maxAgents)))
      if (selected?.gateCommand !== undefined) setGateCommand(selected.gateCommand)
      if (selected?.requirePlanApproval !== undefined) setRequirePlanApproval(selected.requirePlanApproval)
      if (selected?.autonomy) setAutonomy(selected.autonomy)
      if (selected?.requireReview !== undefined) setRequireReview(selected.requireReview)
    }
  }, [ownerKey])

  useEffect(() => {
    const scope = createPluginResourceScope('coordination')
    void playbooksService.list(baseCwd, scope.signal).then(listing => {
      if (!scope.signal.aborted) handlePlaybooksChanged(listing.playbooks)
    }).catch(caught => {
      if (!scope.signal.aborted) setLoadError(caught instanceof Error ? caught.message : 'Failed to load playbooks')
    })
    return () => scope.dispose()
  }, [baseCwd, handlePlaybooksChanged, playbooksService])

  const startRun = () => {
    const prompt = promptDraft.trim()
    if ((!prompt && !selectedPlaybook) || !playbookArgsReady) return
    let parsedPlaybookArgs: unknown
    if (playbookArgs.trim()) {
      try { parsedPlaybookArgs = JSON.parse(playbookArgs) } catch { parsedPlaybookArgs = playbookArgs.trim() }
    }
    const sameProvider = captured.provider === targetProvider
    const params: StartProtocolRunParams = {
      prompt, baseCwd, provider: targetProvider,
      providerInstanceId: sameProvider ? captured.providerInstanceId : undefined,
      model: sameProvider ? captured.model : undefined,
      effort: sameProvider ? captured.effort : undefined,
      playbookName: selectedPlaybook?.name, playbookArgs: parsedPlaybookArgs,
      teammateProviders, maxAgents,
      title: (prompt || selectedPlaybook?.name || 'Coordinated run').slice(0, 40),
      gateCommand: gateCommand.trim() || undefined, requirePlanApproval, useWorktrees, autonomy, requireReview,
      acceptanceContract: { goal: prompt, nonGoals: nonEmptyLines(nonGoals), userVisibleAcceptance: nonEmptyLines(acceptanceCriteria),
        verificationCommands: gateCommand.trim() ? [gateCommand.trim()] : [], manualQa: nonEmptyLines(manualQa), escalationTriggers: nonEmptyLines(escalationTriggers) },
      budget: maxTokens.trim() || maxDurationMinutes.trim() ? { maxTokens: maxTokens.trim() ? Number(maxTokens) : undefined,
        maxDurationMinutes: maxDurationMinutes.trim() ? Number(maxDurationMinutes) : undefined } : undefined,
    }
    void submit(params, result => {
      setPromptDraft('')
      showNotice(`Workflow ${result.snapshot.run.id} started. It continues independently of this view.`)
      try { onStarted?.(result) }
      catch (cause) { setLoadError(`Workflow started, but opening its view failed: ${cause instanceof Error ? cause.message : String(cause)}`) }
    })
  }

  return {
    id, promptDraft, setPromptDraft, acceptanceCriteria, setAcceptanceCriteria,
    nonGoals, setNonGoals, manualQa, setManualQa, escalationTriggers,
    setEscalationTriggers, selectedPlaybook, playbooks, playbookName, playbookArgs,
    setPlaybookArgs, setPlaybookManagerOpen, maxAgents, setMaxAgents, setRunProviderOverride,
    setTeammateProviderOverride, gateCommand, setGateCommand, requirePlanApproval, setRequirePlanApproval,
    autonomy, setAutonomy, requireReview, setRequireReview, maxTokens,
    setMaxTokens, maxDurationMinutes, setMaxDurationMinutes, useWorktrees, setUseWorktrees,
    targetProvider, teammateProviders, playbookArgsPlaceholder, selectPlaybook, baseCwd,
    captured, busy, submit, playbookArgsReady, launchReady,
    ownerKey, playbooksService, useScopedState, onBack, error,
    loadError, notice, showNotice, playbookManagerOpen, handlePlaybooksChanged,
    startRun,
  }
}

type WorkflowController = ReturnType<typeof useWorkflowController>

function WorkflowTextField({ id, label, value, onChange, placeholder, rows }: {
  id: string; label: string; value: string; onChange: (value: string) => void; placeholder: string; rows: number
}) {
  return <div className="av-coord-field">
    <Label htmlFor={id}>{label} <em>one per line</em></Label>
    <Textarea id={id} className="av-coord-textarea av-coord-contract-textarea" value={value}
      onChange={event => onChange(event.target.value)} placeholder={placeholder} rows={rows} />
  </div>
}

function WorkflowBrief({ controller }: { controller: WorkflowController }) {
  const { id, promptDraft, setPromptDraft, acceptanceCriteria, setAcceptanceCriteria, nonGoals, setNonGoals, manualQa, setManualQa, escalationTriggers, setEscalationTriggers, selectedPlaybook } = controller
  return (
    <Card className="av-coord-start-card av-coord-start-brief">
      <CardHeader>
        <div className="av-coord-start-card-heading"><span>01</span><div><CardTitle>Workflow brief</CardTitle><CardDescription>{selectedPlaybook ? 'Add run-specific context, or rely on the selected playbook and its arguments.' : 'Give the lead enough context to build and assign a useful task board.'}</CardDescription></div></div>
      </CardHeader>
      <CardContent className="av-coord-contract-fields">
        <div className="av-coord-field">
          <Label htmlFor={`${id}-coord-run-prompt`}>Outcome and acceptance criteria</Label>
          <Textarea
            id={`${id}-coord-run-prompt`}
            name="run-prompt"
            autoComplete="off"
            required={!selectedPlaybook}
            aria-invalid={promptDraft.length > 0 && !promptDraft.trim()}
            value={promptDraft}
            onChange={(event) => setPromptDraft(event.target.value)}
            placeholder="Example: Audit the session handoff flow. Fix correctness issues, add regression coverage, and finish only when web and TUI type-checks pass."
            className="av-coord-textarea"
            rows={8}
          />
        </div>
        <WorkflowTextField id={`${id}-coord-run-acceptance`} label="Acceptance checks" value={acceptanceCriteria} onChange={setAcceptanceCriteria}
          placeholder={'Web and OpenTUI type-checks pass\nThe new behavior is visible in both dashboards'} rows={4} />
        <WorkflowTextField id={`${id}-coord-run-non-goals`} label="Non-goals" value={nonGoals} onChange={setNonGoals}
          placeholder="Areas the team must leave unchanged" rows={3} />
        <WorkflowTextField id={`${id}-coord-run-manual-qa`} label="Manual QA" value={manualQa} onChange={setManualQa}
          placeholder="Open Agent Operations and verify the completed state" rows={3} />
        <WorkflowTextField id={`${id}-coord-run-escalation`} label="Escalation triggers" value={escalationTriggers} onChange={setEscalationTriggers}
          placeholder="Security, data loss, or public API compatibility risk" rows={3} />
      </CardContent>
      <CardFooter className="av-coord-start-card-meta">
        <span>Include constraints, paths in scope, and a concrete definition of done.</span>
        <b>{promptDraft.length} characters</b>
      </CardFooter>
    </Card>
  )
}

function WorkflowRuntime({ controller }: { controller: WorkflowController }) {
  const { id, playbooks, playbookName, playbookArgs, setPlaybookArgs, setPlaybookManagerOpen, maxAgents, setMaxAgents, setRunProviderOverride, setTeammateProviderOverride, gateCommand, setGateCommand, requirePlanApproval, setRequirePlanApproval, autonomy, setAutonomy, requireReview, setRequireReview, maxTokens, setMaxTokens, maxDurationMinutes, setMaxDurationMinutes, useWorktrees, setUseWorktrees, targetProvider, teammateProviders, selectedPlaybook, playbookArgsPlaceholder, selectPlaybook } = controller
  return (
    <Card className="av-coord-start-card">
      <CardHeader>
        <div className="av-coord-start-card-heading"><span>02</span><div><CardTitle>Runtime and controls</CardTitle><CardDescription>Choose who runs the work and how completion is verified.</CardDescription></div></div>
      </CardHeader>
      <CardContent className="av-coord-runtime-grid">
        <div className="av-coord-field av-coord-wide">
          <Label htmlFor={`${id}-coord-run-playbook`}>Playbook</Label>
          <div className="av-coord-playbook-picker">
            <NativeSelect
              id={`${id}-coord-run-playbook`}
              name="run-playbook"
              value={playbookName}
              onChange={(event) => selectPlaybook(event.target.value)}
              className="av-coord-start-select"
            >
              <NativeSelectOption value="">No playbook — lead plans the board</NativeSelectOption>
              {playbooks.map((entry) => <NativeSelectOption key={entry.name} value={entry.name}>{entry.name} · {entry.phaseCount} phases · {entry.taskCount} tasks</NativeSelectOption>)}
            </NativeSelect>
            <Button type="button" variant="outline" className="av-coord-playbook-manage" onClick={() => setPlaybookManagerOpen(true)}><BookOpen data-icon="inline-start" aria-hidden="true" /> Manage playbooks</Button>
          </div>
          <small>{selectedPlaybook?.description ?? 'Choose a reusable task graph or let the lead create one from the workflow brief.'}</small>
        </div>

        {selectedPlaybook ? (
          <div className="av-coord-field av-coord-wide" data-invalid={selectedPlaybook.expectsArgs && !playbookArgs.trim() ? '' : undefined}>
            <Label htmlFor={`${id}-coord-run-playbook-args`}>Playbook arguments {selectedPlaybook.expectsArgs ? <em>required</em> : <em>optional</em>}</Label>
            <Input
              id={`${id}-coord-run-playbook-args`}
              value={playbookArgs}
              name="run-playbook-args"
              autoComplete="off"
              aria-invalid={selectedPlaybook.expectsArgs && !playbookArgs.trim()}
              onChange={(event) => setPlaybookArgs(event.target.value)}
              placeholder={playbookArgsPlaceholder}
              className="av-coord-input"
            />
            <small>Arguments are added to every task. Plain text fills {'{{args}}'}; JSON objects also support named placeholders such as {'{{args.path}}'}.</small>
          </div>
        ) : null}

        <div className="av-coord-field">
          <Label htmlFor={`${id}-coord-run-provider`}>Lead provider</Label>
          <NativeSelect
            id={`${id}-coord-run-provider`}
            name="run-provider"
            value={targetProvider}
            onChange={(event) => setRunProviderOverride(event.target.value as AgentProvider)}
            className="av-coord-start-select"
          >
            {PROVIDER_ORDER.map((providerName) => <NativeSelectOption key={providerName} value={providerName}>{getAssistantDisplayName(providerName)}</NativeSelectOption>)}
          </NativeSelect>
          <small>The lead session coordinates every task and teammate.</small>
        </div>

        <div className="av-coord-field">
          <Label htmlFor={`${id}-coord-run-agents`}>Agent limit</Label>
          <div className="av-coord-agent-stepper" role="group" aria-label="Maximum agents including the lead">
            <Button type="button" variant="outline" size="icon" onClick={() => setMaxAgents((current) => Math.max(2, current - 1))} disabled={maxAgents <= 2} aria-label="Remove one agent"><Minus aria-hidden="true" /></Button>
            <Input
              id={`${id}-coord-run-agents`}
              type="number"
              name="run-agents"
              autoComplete="off"
              min={2}
              max={6}
              value={maxAgents}
              onChange={(event) => setMaxAgents(Math.max(2, Math.min(6, Number(event.target.value) || 2)))}
              className="av-coord-input"
            />
            <Button type="button" variant="outline" size="icon" onClick={() => setMaxAgents((current) => Math.min(6, current + 1))} disabled={maxAgents >= 6} aria-label="Add one agent"><Plus aria-hidden="true" /></Button>
          </div>
          <small>Includes the lead; increase for independent parallel lanes.</small>
        </div>

        <div className="av-coord-policy-grid av-coord-wide">
          <div className="av-coord-field">
            <Label htmlFor={`${id}-coord-run-autonomy`}>Autonomy</Label>
            <NativeSelect id={`${id}-coord-run-autonomy`} value={autonomy} onChange={(event) => setAutonomy(event.target.value as ProtocolAutonomy)} className="av-coord-start-select">
              <NativeSelectOption value="low">Low · approve every phase</NativeSelectOption>
              <NativeSelectOption value="medium">Medium · gated phases</NativeSelectOption>
              <NativeSelectOption value="high">High · escalation only</NativeSelectOption>
            </NativeSelect>
            <small>Model drift and budget exhaustion always surface.</small>
          </div>

          <div className="av-coord-field">
            <Label htmlFor={`${id}-coord-run-token-budget`}>Token budget <em>optional</em></Label>
            <Input id={`${id}-coord-run-token-budget`} className="av-coord-input" type="number" min={1} value={maxTokens} onChange={(event) => setMaxTokens(event.target.value)} placeholder="250000" />
          </div>

          <div className="av-coord-field">
            <Label htmlFor={`${id}-coord-run-time-budget`}>Duration budget <em>minutes</em></Label>
            <Input id={`${id}-coord-run-time-budget`} className="av-coord-input" type="number" min={1} value={maxDurationMinutes} onChange={(event) => setMaxDurationMinutes(event.target.value)} placeholder="240" />
          </div>
        </div>

        <div className="av-coord-field av-coord-wide">
          <Label>Teammate provider pool</Label>
          <ToggleGroupPrimitive.Root
            type="multiple"
            value={teammateProviders}
            onValueChange={(next) => setTeammateProviderOverride(next.length > 0 ? next as AgentProvider[] : [targetProvider])}
            className="av-coord-provider-pool"
            aria-label="Providers available for teammate agents"
          >
            {PROVIDER_ORDER.map((providerName) => {
              const selected = teammateProviders.includes(providerName)
              return (
                <ToggleGroupPrimitive.Item
                  key={providerName}
                  value={providerName}
                  className={cn(`av-provider-${providerName}`, selected && 'av-selected')}
                  aria-label={`${selected ? 'Remove' : 'Add'} ${providerName} from teammate provider pool`}
                >
                  <span aria-hidden="true">{selected ? '✓' : '+'}</span>{getAssistantDisplayName(providerName)}
                </ToggleGroupPrimitive.Item>
              )
            })}
          </ToggleGroupPrimitive.Root>
          <small>Selected providers are assigned round-robin to teammate sessions. The lead provider can differ from the worker pool.</small>
        </div>

        <div className="av-coord-role-guide av-coord-wide">
          <div><b>Lead</b><span>Plans the board, delegates work, resolves blockers, and synthesizes the final result.</span></div>
          <div><b>Teammates</b><span>Claim independent worker or verification lanes, publish findings, and message the lead or peers.</span></div>
        </div>

        <div className="av-coord-field av-coord-wide">
          <Label htmlFor={`${id}-coord-run-gate`}>Completion gate <em>optional</em></Label>
          <div className="av-coord-command-input">
            <Terminal aria-hidden="true" />
            <Input
              id={`${id}-coord-run-gate`}
              value={gateCommand}
              name="run-gate-command"
              autoComplete="off"
              onChange={(event) => setGateCommand(event.target.value)}
              placeholder="Example: npx tsc --noEmit"
              className="av-coord-input"
            />
          </div>
          <div className="av-coord-gate-presets" aria-label="Suggested completion gates">
            {['npx tsc --noEmit', 'npm run tui:check', 'npm run build'].map((command) => <button key={command} type="button" className="av-hover-control" onClick={() => setGateCommand(command)}>{command}</button>)}
          </div>
        </div>

        <div className="av-coord-plan-control av-coord-wide">
          <Checkbox id={`${id}-coord-plan-approval`} className="av-coord-checkbox" checked={requirePlanApproval} onCheckedChange={(checked) => setRequirePlanApproval(checked === true)} />
          <div><Label htmlFor={`${id}-coord-plan-approval`}>Review the lead plan before implementation</Label><small>The team pauses after planning until you approve or reject the proposed task board.</small></div>
        </div>

        <div className="av-coord-plan-control av-coord-wide">
          <Checkbox id={`${id}-coord-judgment-review`} className="av-coord-checkbox" checked={requireReview} onCheckedChange={(checked) => setRequireReview(checked === true)} />
          <div><Label htmlFor={`${id}-coord-judgment-review`}>Require judgment review after validation</Label><small>The run cannot synthesize until receipts pass and the reviewer approves intent, scope, and risk.</small></div>
        </div>

        <div className="av-coord-plan-control av-coord-wide">
          <Checkbox id={`${id}-coord-use-worktrees`} className="av-coord-checkbox" checked={useWorktrees} onCheckedChange={(checked) => setUseWorktrees(checked === true)} />
          <div><Label htmlFor={`${id}-coord-use-worktrees`}>Use separate teammate checkouts</Label><small>Recommended for parallel edits. Turn this off when every agent should deliberately share the current checkout.</small></div>
        </div>
      </CardContent>
    </Card>
  )
}

type WorkflowSummaryEntry = { label: string; value: string; title?: string; className?: string }
function workflowSummaryEntries(controller: WorkflowController): WorkflowSummaryEntry[] {
  const { baseCwd, captured, targetProvider, teammateProviders, selectedPlaybook, maxAgents, autonomy, useWorktrees,
    requirePlanApproval, requireReview, maxTokens, maxDurationMinutes, gateCommand } = controller
  const rows: WorkflowSummaryEntry[] = [
    { label: 'Workspace', value: baseCwd.split('/').at(-1) || 'agentViewer', title: baseCwd },
    { label: 'Playbook', value: selectedPlaybook?.name ?? 'Lead-planned board' },
    { label: 'Lead provider', value: getAssistantDisplayName(targetProvider), className: `av-provider-${targetProvider}` },
  ]
  if (captured.providerInstanceId && captured.provider === targetProvider) rows.push({ label: 'Lead account', value: captured.providerInstanceId })
  return [...rows,
    { label: 'Teammate providers', value: teammateProviders.map(getAssistantDisplayName).join(' · ') },
    { label: 'Agent limit', value: `${maxAgents} total` },
    { label: 'Autonomy', value: autonomy },
    { label: 'Checkout mode', value: useWorktrees ? 'Isolated checkouts' : 'Shared checkout' },
    { label: 'Plan review', value: requirePlanApproval ? 'Required' : 'Automatic' },
    { label: 'Judgment review', value: requireReview ? 'Required' : 'Optional' },
    { label: 'Budget', value: maxTokens || maxDurationMinutes ? `${maxTokens || '∞'} tokens · ${maxDurationMinutes || '∞'} min` : 'Unbounded' },
    { label: 'Completion gate', value: gateCommand.trim() || 'Not configured', title: gateCommand },
  ]
}

function WorkflowSummary({ controller }: { controller: WorkflowController }) {
  const { promptDraft, selectedPlaybook, useWorktrees, launchReady, playbookArgsReady, busy } = controller
  const entries = workflowSummaryEntries(controller)
  return (
    <Card className="av-coord-start-card av-coord-launch-card">
      <CardHeader>
        <div className="av-coord-start-card-heading"><span>03</span><div><CardTitle>Launch summary</CardTitle><CardDescription>These settings are applied to the new coordinated run.</CardDescription></div></div>
      </CardHeader>
      <CardContent className="av-coord-launch-summary">
        {entries.map(entry => <div key={entry.label}><span>{entry.label}</span><strong title={entry.title} className={entry.className}>{entry.value}</strong></div>)}
        <div className="av-coord-launch-preview">
          <span>Brief preview</span>
          <p>{promptDraft.trim() ? firstLine(promptDraft) : selectedPlaybook ? `Run ${selectedPlaybook.name}` : 'Your workflow outcome will appear here.'}</p>
        </div>
        <div className="av-coord-launch-checks">
          <span><CheckCircle2 aria-hidden="true" /> Lead session created</span>
          <span><CheckCircle2 aria-hidden="true" /> Teammates assigned by provider pool</span>
          <span><CheckCircle2 aria-hidden="true" /> {useWorktrees ? 'Separate teammate checkouts' : 'Shared checkout selected'}</span>
          <span><CheckCircle2 aria-hidden="true" /> {selectedPlaybook ? 'Playbook board seeded without a planning turn' : 'Lead planning and live activity enabled'}</span>
        </div>
      </CardContent>
      <CardFooter className="av-coord-launch-actions">
        <Button type="submit" size="lg" disabled={!launchReady || busy} className="av-coord-btn av-coord-primary">
          {busy ? <RefreshCw data-icon="inline-start" aria-hidden="true" /> : <Play data-icon="inline-start" aria-hidden="true" />} {busy ? 'Launching workflow…' : 'Launch workflow'}
        </Button>
        <small>{launchReady ? <><kbd>⌘</kbd><kbd>Enter</kbd> to launch</> : selectedPlaybook?.expectsArgs && !playbookArgsReady ? 'Add playbook arguments to continue' : 'Add a workflow brief or select a playbook'}</small>
      </CardFooter>
    </Card>
  )
}

export default function NewWorkflow(props: Props) {
  const controller = useWorkflowController(props)
  const { baseCwd, ownerKey, playbooksService, useScopedState, onBack, busy, error, loadError, notice, showNotice, playbookManagerOpen, setPlaybookManagerOpen, launchReady, handlePlaybooksChanged, startRun } = controller

  return <>
    {(error || loadError) && <p role="alert">{error ?? loadError}</p>}
    {notice && <p role="status">{notice}</p>}
              <section className="av-coord-start">
                {playbookManagerOpen ? (
                  <PlaybookManager
                    cwd={baseCwd}
                    service={playbooksService}
                    useScopedState={useScopedState}
                    instanceId={ownerKey}
                    onClose={() => setPlaybookManagerOpen(false)}
                    onChanged={handlePlaybooksChanged}
                    onNotice={showNotice}
                  />
                ) : (
                <form
                  className="av-coord-start-form"
                  action={startRun}
                  onKeyDown={(event) => {
                    if (!(event.metaKey || event.ctrlKey) || event.key !== 'Enter' || !launchReady || busy) return
                    event.preventDefault()
                    void startRun()
                  }}
                >
                  <header className="av-coord-start-hero">
                    <div className="av-coord-start-mark"><Sparkles aria-hidden="true" /></div>
                    <div>
                      <span>Agent operations</span>
                      <h3>Launch a workflow</h3>
                      <p>Define the outcome, choose the runtime, and set the checks the team must satisfy.</p>
                    </div>
                    {onBack ? (
                      <Button type="button" variant="ghost" size="sm" onClick={onBack} className="av-coord-start-back">
                        <ArrowLeft data-icon="inline-start" aria-hidden="true" /> Back to workflow
                      </Button>
                    ) : null}
                  </header>

                  <div className="av-coord-start-layout">
                    <div className="av-coord-start-primary">
                      <WorkflowBrief controller={controller} />

                      <WorkflowRuntime controller={controller} />
                    </div>

                    <WorkflowSummary controller={controller} />
                  </div>
                </form>
                )}
              </section>
  </>
}
