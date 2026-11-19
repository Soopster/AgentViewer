'use client'

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, BookOpen, Pencil, Plus, Save, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { getAssistantDisplayName } from '@/lib/provider'
import type { PlaybookPhase, PlaybookSummary, PlaybookTask, ProtocolAutonomy, RunPlaybook } from '@/lib/agentProtocol'
import type { PluginPlaybookService } from '@/lib/plugins/playbooks'
import type { WebPluginViewProps } from '@/components/shell/pluginTypes'
import { createPluginResourceScope } from '@/lib/plugins/lifecycle'

const PROVIDER_ORDER = ['codex', 'claude', 'copilot', 'opencode', 'pi', 'acp'] as const
function nonEmptyLines(value: string) { return value.split('\n').map(line => line.trim()).filter(Boolean) }
function useLocalState<T>(_name: string, initial: T) { return useState(initial) }
export type PlaybookScopedState = WebPluginViewProps['useState']
const NEW_PLAYBOOK_TEMPLATE: RunPlaybook = {
  name: 'new-playbook',
  description: 'Describe when this workflow should be used',
  argsHint: 'Describe the target or outcome',
  maxAgents: 3,
  autonomy: 'medium',
  requireReview: true,
  acceptanceContract: {
    goal: 'Complete the playbook outcome',
    userVisibleAcceptance: [],
    verificationCommands: [],
  },
  phases: [
    {
      title: 'Execute',
      tasks: [{
        key: 'work',
        title: 'Implement {{args}}',
        detail: 'Complete {{args}} with focused changes and proportionate verification.',
        role: 'teammate',
      }],
    },
    {
      title: 'Integrate',
      tasks: [{
        key: 'integrate',
        title: 'Review and integrate',
        detail: 'Review the completed lane, run final verification, and synthesize the result.',
        role: 'lead',
        dependsOn: ['work'],
      }],
    },
  ],
}

function clonePlaybook(playbook: RunPlaybook): RunPlaybook {
  return structuredClone(playbook)
}

function splitPlaybookList(value: string): string[] | undefined {
  const entries = value.split(',').map((entry) => entry.trim()).filter(Boolean)
  return entries.length > 0 ? entries : undefined
}

function StructuredPlaybookEditor({
  value,
  busy,
  onChange,
  onSave,
}: {
  value: RunPlaybook
  busy: boolean
  onChange: (value: RunPlaybook) => void
  onSave: () => void
}) {
  const id = useId()
  const update = (patch: Partial<RunPlaybook>) => onChange({ ...value, ...patch })
  const updatePhase = (phaseIndex: number, patch: Partial<PlaybookPhase>) => update({
    phases: value.phases.map((phase, index) => index === phaseIndex ? { ...phase, ...patch } : phase),
  })
  const updateTask = (phaseIndex: number, taskIndex: number, patch: Partial<PlaybookTask>) => {
    const phase = value.phases[phaseIndex]
    if (!phase) return
    updatePhase(phaseIndex, {
      tasks: phase.tasks.map((task, index) => index === taskIndex ? { ...task, ...patch } : task),
    })
  }
  const addPhase = () => update({
    phases: [...value.phases, {
      title: `Phase ${value.phases.length + 1}`,
      tasks: [{ key: `task-${value.phases.length + 1}`, title: 'New task', detail: 'Describe the task outcome.', role: 'teammate' }],
    }],
  })
  const removePhase = (phaseIndex: number) => {
    if (value.phases.length <= 1) return
    update({ phases: value.phases.filter((_, index) => index !== phaseIndex) })
  }
  const addTask = (phaseIndex: number) => {
    const phase = value.phases[phaseIndex]
    if (!phase) return
    updatePhase(phaseIndex, {
      tasks: [...phase.tasks, {
        key: `task-${phaseIndex + 1}-${phase.tasks.length + 1}`,
        title: 'New task',
        detail: 'Describe the task outcome.',
        role: 'teammate',
      }],
    })
  }
  const removeTask = (phaseIndex: number, taskIndex: number) => {
    const phase = value.phases[phaseIndex]
    if (!phase || phase.tasks.length <= 1) return
    updatePhase(phaseIndex, { tasks: phase.tasks.filter((_, index) => index !== taskIndex) })
  }

  return (
    <div className="av-coord-structured-editor">
      <div className="av-coord-playbook-editor-head">
        <div><strong>Playbook settings</strong><small>Saved as validated repository JSON.</small></div>
        <Button type="button" size="sm" disabled={busy} onClick={onSave}><Save data-icon="inline-start" aria-hidden="true" /> {busy ? 'Saving…' : 'Save playbook'}</Button>
      </div>
      <div className="av-coord-playbook-settings-grid">
        <div className="av-coord-field av-coord-third"><Label htmlFor={`${id}-playbook-name`}>Name</Label><Input id={`${id}-playbook-name`} value={value.name} onChange={(event) => update({ name: event.target.value })} placeholder="lowercase-slug" /></div>
        <div className="av-coord-field av-coord-third"><Label htmlFor={`${id}-playbook-agents`}>Agent limit</Label><Input id={`${id}-playbook-agents`} type="number" min={2} max={6} value={value.maxAgents ?? 3} onChange={(event) => update({ maxAgents: Math.min(6, Math.max(2, Number(event.target.value) || 2)) })} /></div>
        <div className="av-coord-field av-coord-third"><Label htmlFor={`${id}-playbook-autonomy`}>Autonomy</Label><NativeSelect id={`${id}-playbook-autonomy`} value={value.autonomy ?? 'medium'} onChange={(event) => update({ autonomy: event.target.value as ProtocolAutonomy })}><NativeSelectOption value="low">Low · approve phase changes</NativeSelectOption><NativeSelectOption value="medium">Medium · bounded decisions</NativeSelectOption><NativeSelectOption value="high">High · continue automatically</NativeSelectOption></NativeSelect></div>
        <div className="av-coord-field av-coord-wide"><Label htmlFor={`${id}-playbook-description`}>Description</Label><Textarea id={`${id}-playbook-description`} rows={3} value={value.description ?? ''} onChange={(event) => update({ description: event.target.value || undefined })} placeholder="When should this workflow be used?" /></div>
        <div className="av-coord-field"><Label htmlFor={`${id}-playbook-args-hint`}>Argument guidance <em>optional</em></Label><Textarea id={`${id}-playbook-args-hint`} rows={2} value={value.argsHint ?? ''} onChange={(event) => update({ argsHint: event.target.value || undefined })} placeholder="Example: target path or objective" /></div>
        <div className="av-coord-field"><Label htmlFor={`${id}-playbook-gate`}>Completion gate <em>optional</em></Label><Input id={`${id}-playbook-gate`} value={value.gateCommand ?? ''} onChange={(event) => update({ gateCommand: event.target.value || undefined })} placeholder="npx tsc --noEmit" /></div>
        <div className="av-coord-plan-control av-coord-wide">
          <Checkbox id={`${id}-playbook-plan-approval`} checked={value.requirePlanApproval === true} onCheckedChange={(checked) => update({ requirePlanApproval: checked === true })} />
          <div><Label htmlFor={`${id}-playbook-plan-approval`}>Require teammate plan approval</Label><small>Workers submit a plan before implementation; explicit lead tasks execute directly.</small></div>
        </div>
        <div className="av-coord-plan-control av-coord-wide">
          <Checkbox id={`${id}-playbook-judgment-review`} checked={value.requireReview === true} onCheckedChange={(checked) => update({ requireReview: checked === true })} />
          <div><Label htmlFor={`${id}-playbook-judgment-review`}>Require judgment review</Label><small>Mechanical verification must be followed by an intent, scope, and risk review.</small></div>
        </div>
        <div className="av-coord-field av-coord-wide"><Label htmlFor={`${id}-playbook-acceptance-goal`}>Acceptance goal</Label><Input id={`${id}-playbook-acceptance-goal`} value={value.acceptanceContract?.goal ?? ''} onChange={(event) => update({ acceptanceContract: { ...value.acceptanceContract, goal: event.target.value } })} placeholder="Observable workflow outcome" /></div>
        <div className="av-coord-field"><Label htmlFor={`${id}-playbook-acceptance-criteria`}>Acceptance criteria <em>one per line</em></Label><Textarea id={`${id}-playbook-acceptance-criteria`} rows={3} value={value.acceptanceContract?.userVisibleAcceptance?.join('\n') ?? ''} onChange={(event) => update({ acceptanceContract: { ...value.acceptanceContract, userVisibleAcceptance: nonEmptyLines(event.target.value) } })} /></div>
        <div className="av-coord-field"><Label htmlFor={`${id}-playbook-verification`}>Verification commands <em>one per line</em></Label><Textarea id={`${id}-playbook-verification`} rows={3} value={value.acceptanceContract?.verificationCommands?.join('\n') ?? ''} onChange={(event) => update({ acceptanceContract: { ...value.acceptanceContract, verificationCommands: nonEmptyLines(event.target.value) } })} /></div>
      </div>

      <div className="av-coord-playbook-phases">
        <div className="av-coord-playbook-section-head"><div><strong>Workflow phases</strong><small>Phases are barriers; every task waits for the preceding phase.</small></div><Button type="button" variant="outline" size="sm" onClick={addPhase}><Plus data-icon="inline-start" aria-hidden="true" /> Add phase</Button></div>
        {value.phases.map((phase, phaseIndex) => (
          <Card key={`phase-${phaseIndex}`} className="av-coord-playbook-phase">
            <CardHeader>
              <div className="av-coord-playbook-phase-head">
                <span>{String(phaseIndex + 1).padStart(2, '0')}</span>
                <Input value={phase.title} aria-label={`Phase ${phaseIndex + 1} title`} onChange={(event) => updatePhase(phaseIndex, { title: event.target.value })} />
                <Button type="button" variant="ghost" size="icon" aria-label={`Delete phase ${phaseIndex + 1}`} disabled={value.phases.length <= 1} onClick={() => removePhase(phaseIndex)}><Trash2 aria-hidden="true" /></Button>
              </div>
            </CardHeader>
            <CardContent className="av-coord-playbook-task-list">
              {phase.tasks.map((task, taskIndex) => (
                <fieldset key={`task-${taskIndex}`} className="av-coord-playbook-task">
                  <legend>Task {taskIndex + 1}</legend>
                  <div className="av-coord-playbook-task-grid">
                    <div className="av-coord-field"><Label>Key <em>optional</em></Label><Input value={task.key ?? ''} onChange={(event) => updateTask(phaseIndex, taskIndex, { key: event.target.value || undefined })} placeholder="stable-key" /></div>
                    <div className="av-coord-field"><Label>Assigned role</Label><NativeSelect value={task.role ?? 'teammate'} onChange={(event) => updateTask(phaseIndex, taskIndex, { role: event.target.value as PlaybookTask['role'] })}><NativeSelectOption value="teammate">Teammate</NativeSelectOption><NativeSelectOption value="lead">Lead</NativeSelectOption><NativeSelectOption value="any">Any available agent</NativeSelectOption></NativeSelect></div>
                    <div className="av-coord-field"><Label>Seat</Label><NativeSelect value={task.seat ?? (task.role === 'lead' ? 'director' : 'executor')} onChange={(event) => updateTask(phaseIndex, taskIndex, { seat: event.target.value as PlaybookTask['seat'] })}><NativeSelectOption value="director">Director</NativeSelectOption><NativeSelectOption value="executor">Executor</NativeSelectOption><NativeSelectOption value="validator">Validator</NativeSelectOption><NativeSelectOption value="watcher">Watcher</NativeSelectOption></NativeSelect></div>
                    <div className="av-coord-field"><Label>Requested provider <em>optional</em></Label><NativeSelect value={task.provider ?? ''} onChange={(event) => updateTask(phaseIndex, taskIndex, { provider: (event.target.value || undefined) as PlaybookTask['provider'] })}><NativeSelectOption value="">Any provider</NativeSelectOption>{PROVIDER_ORDER.map((entry) => <NativeSelectOption key={entry} value={entry}>{getAssistantDisplayName(entry)}</NativeSelectOption>)}</NativeSelect></div>
                    <div className="av-coord-field"><Label>Requested model <em>optional</em></Label><Input value={task.model ?? ''} onChange={(event) => updateTask(phaseIndex, taskIndex, { model: event.target.value || undefined })} placeholder="Provider-native model id" /></div>
                    <div className="av-coord-field"><Label>Effort <em>optional</em></Label><Input value={task.effort ?? ''} onChange={(event) => updateTask(phaseIndex, taskIndex, { effort: event.target.value || undefined })} placeholder="high" /></div>
                    <div className="av-coord-field av-coord-wide"><Label>Title</Label><Input value={task.title} onChange={(event) => updateTask(phaseIndex, taskIndex, { title: event.target.value })} placeholder="Task outcome" /></div>
                    <div className="av-coord-field av-coord-wide"><Label>Instructions</Label><Textarea value={task.detail} rows={4} onChange={(event) => updateTask(phaseIndex, taskIndex, { detail: event.target.value })} placeholder="Full task instructions and acceptance checks" /></div>
                    <div className="av-coord-field"><Label>Write paths <em>comma-separated</em></Label><Input value={task.paths?.join(', ') ?? ''} onChange={(event) => updateTask(phaseIndex, taskIndex, { paths: splitPlaybookList(event.target.value) })} placeholder="lib/example.ts, app/api" /></div>
                    <div className="av-coord-field"><Label>Dependencies <em>task keys</em></Label><Input value={task.dependsOn?.join(', ') ?? ''} onChange={(event) => updateTask(phaseIndex, taskIndex, { dependsOn: splitPlaybookList(event.target.value) })} placeholder="survey, implement" /></div>
                    <div className="av-coord-field av-coord-wide"><Label>Task verification <em>one command per line</em></Label><Textarea value={task.verifyCommands?.join('\n') ?? ''} rows={2} onChange={(event) => updateTask(phaseIndex, taskIndex, { verifyCommands: nonEmptyLines(event.target.value) })} placeholder="npx tsc --noEmit" /></div>
                  </div>
                  <Button type="button" variant="ghost" size="sm" disabled={phase.tasks.length <= 1} onClick={() => removeTask(phaseIndex, taskIndex)}><Trash2 data-icon="inline-start" aria-hidden="true" /> Delete task</Button>
                </fieldset>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => addTask(phaseIndex)}><Plus data-icon="inline-start" aria-hidden="true" /> Add task</Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

type PlaybookOwner = { cwd: string; service: PluginPlaybookService; instanceId: string }

function usePlaybookOperations(owner: PlaybookOwner) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lifetime = useRef<{ owner: PlaybookOwner; scope: ReturnType<typeof createPluginResourceScope> } | null>(null)
  const pending = useRef(false)
  useLayoutEffect(() => {
    const scope = createPluginResourceScope('coordination')
    lifetime.current = { owner, scope }
    pending.current = false
    setBusy(previous => scope.signal.aborted ? previous : false)
    setError(null)
    return () => scope.dispose()
  }, [owner])
  const signalForOwner = useCallback(() => {
    const current = lifetime.current
    return current?.owner === owner && !current.scope.signal.aborted ? current.scope.signal : null
  }, [owner])
  const canStart = useCallback(() => !pending.current && signalForOwner() !== null, [signalForOwner])
  const run = useCallback(async (operation: (signal: AbortSignal) => Promise<void>) => {
    const signal = signalForOwner()
    if (!signal || pending.current) return
    pending.current = true
    setBusy(true); setError(null)
    try { await operation(signal) }
    catch (cause) { if (!signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally {
      if (!signal.aborted) pending.current = false
      setBusy(previous => signal.aborted ? previous : false)
    }
  }, [signalForOwner])
  return { busy, error, setError, signalForOwner, canStart, run }
}

function PlaybookList({ playbooks, invalidCount, selectedName, selected, busy, createPlaybook, editSelected, setSelectedName }: {
  playbooks: PlaybookSummary[]
  invalidCount: number
  selectedName: string | null
  selected: boolean
  busy: boolean
  createPlaybook: () => void
  editSelected: () => void
  setSelectedName: (name: string) => void
}) {
  return (
    <section className="av-coord-playbook-list" aria-label="Saved playbooks">
      <div className="av-coord-playbook-list-head">
        <div><strong>Saved playbooks</strong><small>{playbooks.length} reusable workflow{playbooks.length === 1 ? '' : 's'}</small></div>
        <div className="av-coord-playbook-actions">
          <Button type="button" size="sm" onClick={createPlaybook}><Plus data-icon="inline-start" aria-hidden="true" /> New</Button>
          <Button type="button" variant="outline" size="sm" disabled={!selected || busy} onClick={() => void editSelected()}><Pencil data-icon="inline-start" aria-hidden="true" /> Edit</Button>
        </div>
      </div>
      {playbooks.length === 0 ? <p>No playbooks yet. Create one to seed a workflow without a planning turn.</p> : playbooks.map((entry) => (
        <button
          key={entry.name}
          type="button"
          className={cn('av-coord-playbook-row', 'av-hover-control', entry.name === selectedName && 'av-selected')}
          onClick={() => setSelectedName(entry.name)}
        >
          <strong>{entry.name}</strong>
          <span>{entry.phaseCount} phases · {entry.taskCount} tasks</span>
        </button>
      ))}
      {invalidCount > 0 ? <p className="av-coord-playbook-invalid">{invalidCount} invalid playbook file{invalidCount === 1 ? '' : 's'} detected.</p> : null}
    </section>
  )
}

function PlaybookDetails({ selected, deleteName, busy, deletePlaybook, setDeleteName }: {
  selected: PlaybookSummary
  deleteName: string | null
  busy: boolean
  deletePlaybook: () => void
  setDeleteName: (name: string | null) => void
}) {
  return (
    <>
                  <div className="av-coord-playbook-detail">
                    <BookOpen aria-hidden="true" />
                    <div><strong>{selected.name}</strong><p>{selected.description ?? 'No description'}</p></div>
                  </div>
                  <dl>
                    <div><dt>Phases</dt><dd>{selected.phaseCount}</dd></div>
                    <div><dt>Tasks</dt><dd>{selected.taskCount}</dd></div>
                    <div><dt>Arguments</dt><dd>{selected.expectsArgs ? selected.argsHint ?? 'Required' : 'Not required'}</dd></div>
                    <div><dt>Agents</dt><dd>{selected.maxAgents ?? 'Launcher default'}</dd></div>
                    <div><dt>Completion gate</dt><dd>{selected.gateCommand ?? 'Not configured'}</dd></div>
                    <div><dt>Autonomy</dt><dd>{selected.autonomy ?? 'medium'}</dd></div>
                    <div><dt>Judgment review</dt><dd>{selected.requireReview ? 'Required' : 'Automatic'}</dd></div>
                  </dl>
                  {deleteName === selected.name ? (
                    <div className="av-coord-playbook-delete" role="alert">
                      <span>Delete {selected.name}? This removes its repository JSON file.</span>
                      <div><Button type="button" variant="destructive" size="sm" disabled={busy} onClick={() => void deletePlaybook()}>Delete</Button><Button type="button" variant="outline" size="sm" onClick={() => setDeleteName(null)}>Cancel</Button></div>
                    </div>
                  ) : (
                    <Button type="button" variant="outline" size="sm" onClick={() => setDeleteName(selected.name)}><Trash2 data-icon="inline-start" aria-hidden="true" /> Delete playbook</Button>
                  )}
                </>
  )
}

export default function PlaybookManager({ cwd, service, instanceId = 'embedded', useScopedState = useLocalState, onClose, onChanged, onNotice }: {
  cwd: string
  service: PluginPlaybookService
  instanceId?: string
  useScopedState?: PlaybookScopedState
  onClose: () => void
  onChanged: (playbooks: PlaybookSummary[], preferredName?: string) => void
  onNotice: (message: string) => void
}) {
  const prefix = `playbooks:${cwd}:`
  const [playbooks, setPlaybooks] = useState<PlaybookSummary[]>([])
  const [invalid, setInvalid] = useState<Array<{ file: string; error: string }>>([])
  const [selectedName, setSelectedName] = useScopedState<string | null>(prefix + 'selected', null)
  const [editingName, setEditingName] = useScopedState<string | null>(prefix + 'editing', null)
  const [draft, setDraft] = useScopedState<RunPlaybook | null>(prefix + 'draft', null)
  const [deleteName, setDeleteName] = useState<string | null>(null)
  const owner = useMemo(() => ({ cwd, service, instanceId }), [cwd, service, instanceId])
  const { busy, error, setError, signalForOwner, canStart, run } = usePlaybookOperations(owner)
  const listingSerial = useRef(0)
  const callbacks = useRef({ onChanged, onNotice })
  useLayoutEffect(() => { callbacks.current = { onChanged, onNotice } }, [onChanged, onNotice])
  useLayoutEffect(() => { setDeleteName(null) }, [owner])

  const load = useCallback(async (signal: AbortSignal, preferredName?: string) => {
    const serial = ++listingSerial.current
    const listing = await service.list(cwd, signal)
    if (signal.aborted || serial !== listingSerial.current) return
    setPlaybooks(listing.playbooks); setInvalid(listing.invalid)
    setSelectedName(current => preferredName ?? (current && listing.playbooks.some(entry => entry.name === current) ? current : listing.playbooks[0]?.name ?? null))
    callbacks.current.onChanged(listing.playbooks, preferredName)
  }, [cwd, service, setSelectedName])
  useEffect(() => {
    const signal = signalForOwner()
    if (!signal) return
    void load(signal).catch(cause => { if (!signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)) })
  }, [load, signalForOwner, setError])

  const editSelected = () => {
    if (!selectedName) return
    const name = selectedName
    void run(async signal => {
      const playbook = await service.read(cwd, name, signal)
      if (signal.aborted) return
      setEditingName(name); setDraft(clonePlaybook(playbook))
    })
  }
  const createPlaybook = () => {
    if (!canStart()) return
    setEditingName(null); setDraft(clonePlaybook(NEW_PLAYBOOK_TEMPLATE)); setError(null)
  }
  const savePlaybook = () => {
    if (!draft) return
    const value = clonePlaybook(draft)
    void run(async signal => {
      const result = await service.write(cwd, value, editingName ?? undefined, signal)
      if (signal.aborted) return
      await load(signal, result.playbook.name)
      if (signal.aborted) return
      setEditingName(null); setDraft(null)
      callbacks.current.onNotice(`Saved playbook ${result.playbook.name}`)
    })
  }
  const deletePlaybook = () => {
    if (!deleteName) return
    const name = deleteName
    void run(async signal => {
      await service.remove(cwd, name, signal)
      if (signal.aborted) return
      await load(signal)
      if (signal.aborted) return
      setDeleteName(null); callbacks.current.onNotice(`Deleted playbook ${name}`)
    })
  }

  const selected = playbooks.find((entry) => entry.name === selectedName) ?? null

  return (
    <Card className="av-coord-playbook-manager">
      <CardHeader>
        <div className="av-coord-playbook-manager-head">
          <div>
            <CardTitle>Playbook manager</CardTitle>
            <CardDescription>Create and maintain reusable Coordinator task graphs stored in this workspace.</CardDescription>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}><ArrowLeft data-icon="inline-start" aria-hidden="true" /> Back to workflow</Button>
        </div>
      </CardHeader>
      <CardContent className="av-coord-playbook-manager-layout">
        <PlaybookList playbooks={playbooks} invalidCount={invalid.length} selectedName={selectedName}
          selected={selected !== null} busy={busy} createPlaybook={createPlaybook} editSelected={editSelected}
          setSelectedName={setSelectedName} />

        <section className="av-coord-playbook-editor">
          {draft ? (
            <>
              <div className="av-coord-playbook-editor-head">
                <div><strong>{editingName ? `Edit ${editingName}` : 'Create playbook'}</strong><small>Change the name to rename its repository file.</small></div>
              </div>
              <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0 }}><StructuredPlaybookEditor value={draft} busy={busy} onChange={setDraft} onSave={() => void savePlaybook()} /></fieldset>
            </>
          ) : selected ? (
            <PlaybookDetails selected={selected} deleteName={deleteName} busy={busy}
              deletePlaybook={deletePlaybook} setDeleteName={setDeleteName} />
          ) : <p>Select a playbook or create a new one.</p>}
        </section>
      </CardContent>
      {error ? <CardFooter><p className="av-coord-playbook-invalid" role="alert">{error}</p></CardFooter> : null}
    </Card>
  )
}

