/** @jsxImportSource @opentui/react */
import React, { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { TextareaAction, TextareaRenderable } from '@opentui/core'
import type { PlaybookPhase, PlaybookSummary, PlaybookTask, RunPlaybook } from '../../lib/agentProtocol'
import {
  deleteTuiRunPlaybook,
  listTuiRunPlaybooks,
  readTuiRunPlaybook,
  writeTuiRunPlaybook,
} from '../../lib/tui/service'
import type { TuiThemePalette } from '../theme'

type ManagerKey = { name: string; ctrl: boolean; shift: boolean; sequence: string }
type ManagerMode = 'list' | 'edit' | 'delete'
type EditorFocus = 'name' | 'description' | 'argsHint' | 'maxAgents' | 'gateCommand' | 'approval'
  | 'phaseNav' | 'phaseTitle' | 'taskNav' | 'taskKey' | 'taskTitle' | 'taskDetail' | 'taskRole' | 'taskPaths' | 'taskDeps'

export type PlaybookManagerPopoverProps = {
  theme: TuiThemePalette
  width: number
  height: number
  cwd: string
  onClose: () => void
  onChanged: (playbooks: PlaybookSummary[], selectedName?: string) => void
  onNotice: (kind: 'info' | 'error', message: string, duration?: number) => void
  onKeyHandlerReady?: (handler: (key: ManagerKey) => boolean) => void
}

const NEW_PLAYBOOK: RunPlaybook = {
  name: 'new-playbook',
  description: 'Describe when this workflow should be used',
  argsHint: 'Describe the target or outcome',
  maxAgents: 3,
  phases: [
    {
      title: 'Execute',
      tasks: [{
        key: 'work',
        title: 'Implement the requested outcome',
        detail: 'Complete the requested outcome with focused changes and proportionate verification.',
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

const EDITOR_FOCUS_ORDER: EditorFocus[] = [
  'name', 'description', 'argsHint', 'maxAgents', 'gateCommand', 'approval',
  'phaseNav', 'phaseTitle', 'taskNav', 'taskKey', 'taskTitle', 'taskDetail', 'taskRole', 'taskPaths', 'taskDeps',
]
const MULTILINE_EDITOR_FIELDS = new Set<EditorFocus>(['description', 'argsHint', 'taskDetail'])
const MULTILINE_KEY_BINDINGS: Array<{ name: string; action: TextareaAction }> = [
  { name: 'return', action: 'newline' },
  { name: 'kpenter', action: 'newline' },
  { name: 'linefeed', action: 'newline' },
]

function clip(value: string, width: number): string {
  if (width <= 0) return ''
  return value.length <= width ? value : `${value.slice(0, Math.max(0, width - 1))}…`
}

function clonePlaybook(playbook: RunPlaybook): RunPlaybook {
  return structuredClone(playbook)
}

function csv(values?: string[]): string {
  return values?.join(', ') ?? ''
}

function parseCsv(value: string): string[] | undefined {
  const values = value.split(',').map((entry) => entry.trim()).filter(Boolean)
  return values.length > 0 ? values : undefined
}

export function PlaybookManagerPopover({
  theme,
  width,
  height,
  cwd,
  onClose,
  onChanged,
  onNotice,
  onKeyHandlerReady,
}: PlaybookManagerPopoverProps) {
  const [playbooks, setPlaybooks] = useState<PlaybookSummary[]>([])
  const [invalidCount, setInvalidCount] = useState(0)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [mode, setMode] = useState<ManagerMode>('list')
  const [editingName, setEditingName] = useState<string | null>(null)
  const [draft, setDraft] = useState<RunPlaybook>(() => clonePlaybook(NEW_PLAYBOOK))
  const [phaseIndex, setPhaseIndex] = useState(0)
  const [taskIndex, setTaskIndex] = useState(0)
  const [editorFocus, setEditorFocus] = useState<EditorFocus>('name')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const multilineEditorRef = useRef<TextareaRenderable | null>(null)

  const reload = useEffectEvent(async (preferredName?: string) => {
    const listing = await listTuiRunPlaybooks(cwd)
    setPlaybooks(listing.playbooks)
    setInvalidCount(listing.invalid.length)
    const nextIndex = preferredName
      ? Math.max(0, listing.playbooks.findIndex((entry) => entry.name === preferredName))
      : Math.min(selectedIndex, Math.max(0, listing.playbooks.length - 1))
    setSelectedIndex(nextIndex)
    onChanged(listing.playbooks, preferredName)
  })

  useEffect(() => {
    let cancelled = false
    void listTuiRunPlaybooks(cwd).then((listing) => {
      if (cancelled) return
      setPlaybooks(listing.playbooks)
      setInvalidCount(listing.invalid.length)
      onChanged(listing.playbooks)
    }).catch((caught) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : 'Failed to load playbooks')
    })
    return () => { cancelled = true }
  }, [cwd, onChanged])

  const resetEditor = useEffectEvent((playbook: RunPlaybook, previousName: string | null) => {
    setDraft(clonePlaybook(playbook))
    setEditingName(previousName)
    setPhaseIndex(0)
    setTaskIndex(0)
    setEditorFocus('name')
    setError(null)
    setMode('edit')
  })

  const beginEdit = useEffectEvent(async () => {
    const selected = playbooks[selectedIndex]
    if (!selected || busy) return
    setBusy(true)
    setError(null)
    try {
      resetEditor(await readTuiRunPlaybook(cwd, selected.name), selected.name)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to open playbook')
    } finally {
      setBusy(false)
    }
  })

  const updateDraft = useEffectEvent((patch: Partial<RunPlaybook>) => {
    setDraft((current) => ({ ...current, ...patch }))
  })

  const updatePhase = useEffectEvent((patch: Partial<PlaybookPhase>) => {
    setDraft((current) => ({
      ...current,
      phases: current.phases.map((phase, index) => index === phaseIndex ? { ...phase, ...patch } : phase),
    }))
  })

  const updateTask = useEffectEvent((patch: Partial<PlaybookTask>) => {
    setDraft((current) => ({
      ...current,
      phases: current.phases.map((phase, index) => index === phaseIndex
        ? { ...phase, tasks: phase.tasks.map((task, taskOffset) => taskOffset === taskIndex ? { ...task, ...patch } : task) }
        : phase),
    }))
  })

  const addPhase = useEffectEvent(() => {
    const nextIndex = draft.phases.length
    setDraft((current) => ({ ...current, phases: [...current.phases, { title: `Phase ${nextIndex + 1}`, tasks: [{ key: `task-${nextIndex + 1}`, title: 'New task', detail: 'Describe the task outcome.', role: 'teammate' }] }] }))
    setPhaseIndex(nextIndex)
    setTaskIndex(0)
    setEditorFocus('phaseTitle')
  })

  const addTask = useEffectEvent(() => {
    const nextIndex = draft.phases[phaseIndex]?.tasks.length ?? 0
    updatePhase({ tasks: [...(draft.phases[phaseIndex]?.tasks ?? []), { key: `task-${phaseIndex + 1}-${nextIndex + 1}`, title: 'New task', detail: 'Describe the task outcome.', role: 'teammate' }] })
    setTaskIndex(nextIndex)
    setEditorFocus('taskTitle')
  })

  const deleteTask = useEffectEvent(() => {
    const phase = draft.phases[phaseIndex]
    if (!phase || phase.tasks.length <= 1) {
      setError('Every phase needs at least one task')
      return
    }
    updatePhase({ tasks: phase.tasks.filter((_, index) => index !== taskIndex) })
    setTaskIndex(Math.max(0, taskIndex - 1))
  })

  const deletePhase = useEffectEvent(() => {
    if (draft.phases.length <= 1) {
      setError('A playbook needs at least one phase')
      return
    }
    setDraft((current) => ({ ...current, phases: current.phases.filter((_, index) => index !== phaseIndex) }))
    setPhaseIndex(Math.max(0, phaseIndex - 1))
    setTaskIndex(0)
  })

  const saveDraft = useEffectEvent(async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await writeTuiRunPlaybook(cwd, draft, editingName ?? undefined)
      await reload(result.playbook.name)
      setMode('list')
      onNotice('info', `Saved playbook ${result.playbook.name}`, 3500)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to save playbook')
    } finally {
      setBusy(false)
    }
  })

  const deleteSelected = useEffectEvent(async () => {
    const selected = playbooks[selectedIndex]
    if (!selected || busy) return
    setBusy(true)
    setError(null)
    try {
      await deleteTuiRunPlaybook(cwd, selected.name)
      await reload()
      setMode('list')
      onNotice('info', `Deleted playbook ${selected.name}`, 3500)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to delete playbook')
    } finally {
      setBusy(false)
    }
  })

  const handleEditorKey = useEffectEvent((key: ManagerKey) => {
    if (key.name === 'escape') {
      setMode('list')
      setError(null)
      return true
    }
    if (key.ctrl && key.name === 's') { void saveDraft(); return true }
    if (key.ctrl && key.name === 'p') { addPhase(); return true }
    if (key.ctrl && key.name === 't') { addTask(); return true }
    if (key.ctrl && key.name === 'x') { key.shift ? deletePhase() : deleteTask(); return true }
    if (key.name === 'tab') {
      const direction = key.shift ? -1 : 1
      setEditorFocus((current) => {
        const index = EDITOR_FOCUS_ORDER.indexOf(current)
        return EDITOR_FOCUS_ORDER[(index + direction + EDITOR_FOCUS_ORDER.length) % EDITOR_FOCUS_ORDER.length]!
      })
      return true
    }
    const direction = key.name === 'left' || key.name === 'up' ? -1 : key.name === 'right' || key.name === 'down' ? 1 : 0
    if (!direction && key.name !== 'space') return false
    if (editorFocus === 'phaseNav' && direction) {
      const next = (phaseIndex + direction + draft.phases.length) % draft.phases.length
      setPhaseIndex(next)
      setTaskIndex(0)
    } else if (editorFocus === 'taskNav' && direction) {
      const count = draft.phases[phaseIndex]?.tasks.length ?? 1
      setTaskIndex((taskIndex + direction + count) % count)
    } else if (editorFocus === 'maxAgents' && direction) {
      updateDraft({ maxAgents: Math.min(6, Math.max(2, (draft.maxAgents ?? 3) + direction)) })
    } else if (editorFocus === 'approval') {
      updateDraft({ requirePlanApproval: !draft.requirePlanApproval })
    } else if (editorFocus === 'taskRole') {
      const roles: PlaybookTask['role'][] = ['teammate', 'lead', 'any']
      const index = roles.indexOf(draft.phases[phaseIndex]?.tasks[taskIndex]?.role ?? 'teammate')
      updateTask({ role: roles[(index + (direction || 1) + roles.length) % roles.length] })
    } else return false
    return true
  })

  const handleKey = useEffectEvent((key: ManagerKey) => {
    if (mode === 'edit') return handleEditorKey(key)
    if (mode === 'delete') {
      if (key.name === 'escape' || key.name === 'n') setMode('list')
      else if (key.name === 'return' || key.name === 'y') void deleteSelected()
      return true
    }
    if (key.name === 'escape') onClose()
    else if (key.name === 'up' || key.name === 'k') setSelectedIndex((current) => playbooks.length === 0 ? 0 : (current - 1 + playbooks.length) % playbooks.length)
    else if (key.name === 'down' || key.name === 'j') setSelectedIndex((current) => playbooks.length === 0 ? 0 : (current + 1) % playbooks.length)
    else if (key.name === 'n') resetEditor(NEW_PLAYBOOK, null)
    else if (key.name === 'return' || key.name === 'e') void beginEdit()
    else if (key.name === 'd' && playbooks[selectedIndex]) setMode('delete')
    return true
  })

  useEffect(() => {
    onKeyHandlerReady?.(handleKey)
    return () => onKeyHandlerReady?.(() => true)
  }, [handleKey, onKeyHandlerReady])

  const overlayWidth = Math.max(54, Math.min(width - 4, 140))
  const overlayHeight = Math.max(22, Math.min(height - 4, 42))
  const bodyWidth = overlayWidth - 4
  const listWidth = Math.max(28, Math.min(38, Math.floor(bodyWidth * 0.3)))
  const detailWidth = Math.max(20, bodyWidth - listWidth - 2)
  const editorLeftWidth = Math.floor((bodyWidth - 2) * 0.42)
  const editorRightWidth = Math.max(24, bodyWidth - editorLeftWidth - 3)
  const selected = playbooks[selectedIndex]
  const phase = draft.phases[phaseIndex]!
  const task = phase?.tasks[taskIndex]!
  const focusBg = (field: EditorFocus) => editorFocus === field ? theme.surface3 : undefined
  const focusFg = (field: EditorFocus) => editorFocus === field ? theme.cyan : theme.dim

  const field = (label: string, focus: EditorFocus, value: string, onInput: (value: string) => void, placeholder: string) => {
    const fieldWidth = EDITOR_FOCUS_ORDER.indexOf(focus) <= EDITOR_FOCUS_ORDER.indexOf('approval')
      ? editorLeftWidth - 2
      : editorRightWidth - 2
    const multiline = MULTILINE_EDITOR_FIELDS.has(focus)
    const focused = editorFocus === focus
    return (
    <box height={multiline ? 4 : 2} flexDirection="column" backgroundColor={focusBg(focus)}>
      <text fg={focusFg(focus)} wrapMode="none">{label}</text>
      <box height={multiline ? 3 : 1} width="100%" paddingLeft={1} backgroundColor={focused ? theme.surface3 : theme.surface} overflow="hidden">
        {focused
          ? multiline
            ? <textarea
                key={focus}
                ref={multilineEditorRef}
                width="100%"
                height={3}
                focused
                initialValue={value}
                placeholder={placeholder}
                wrapMode="word"
                keyBindings={MULTILINE_KEY_BINDINGS}
                onContentChange={() => onInput(multilineEditorRef.current?.plainText ?? '')}
              />
            : <input width="100%" focused value={value} placeholder={placeholder} onInput={onInput} />
          : <text fg={value ? theme.text : theme.dim} wrapMode={multiline ? 'word' : 'none'}>{multiline ? value || placeholder : clip(value || placeholder, Math.max(8, fieldWidth))}</text>}
      </box>
    </box>
    )
  }

  return (
    <box
      position="absolute"
      top={Math.max(1, Math.floor((height - overlayHeight) / 2))}
      left={Math.max(1, Math.floor((width - overlayWidth) / 2))}
      width={overlayWidth}
      height={overlayHeight}
      border
      borderStyle="heavy"
      borderColor={theme.violet}
      backgroundColor={theme.surface2}
      zIndex={80}
      flexDirection="column"
      title="PLAYBOOK MANAGER"
      titleColor={theme.violet}
    >
      <box height={3} paddingX={1} border={['bottom']} borderStyle="single" borderColor={theme.border} flexDirection="column" justifyContent="center">
        <text fg={theme.text}>REUSABLE COORDINATOR WORKFLOWS</text>
        <text fg={theme.dim} wrapMode="none">{clip(`${cwd}/.agent-viewer/playbooks · ${playbooks.length} valid${invalidCount ? ` · ${invalidCount} invalid` : ''}`, bodyWidth)}</text>
      </box>

      {mode === 'edit' ? (
        <box width={bodyWidth} flexGrow={1} paddingX={1} flexDirection="column" overflow="hidden">
          <box height={2} flexDirection="row" alignItems="center">
            <text fg={theme.cyan} wrapMode="none">{editingName ? clip(`EDIT ${editingName}`, Math.max(16, Math.floor(bodyWidth * 0.55))) : 'NEW PLAYBOOK'}</text>
            <box flexGrow={1} />
            <text fg={theme.dim} wrapMode="none">Tab moves fields</text>
          </box>
          <box width={bodyWidth - 2} flexGrow={1} flexDirection="row" gap={2} overflow="hidden">
            <box width={editorLeftWidth} flexDirection="column">
              <text fg={theme.violet}>PLAYBOOK SETTINGS</text>
              {field('Name', 'name', draft.name, (value) => updateDraft({ name: value }), 'lowercase-slug')}
              {field('Description', 'description', draft.description ?? '', (value) => updateDraft({ description: value || undefined }), 'When should this run?')}
              {field('Argument guidance', 'argsHint', draft.argsHint ?? '', (value) => updateDraft({ argsHint: value || undefined }), 'Optional input hint')}
              <box height={2} flexDirection="column" backgroundColor={focusBg('maxAgents')}>
                <text fg={focusFg('maxAgents')}>Agent limit</text>
                <text fg={theme.text}>{`‹ ${draft.maxAgents ?? 3} total ›  ${editorFocus === 'maxAgents' ? '←/→ adjust' : ''}`}</text>
              </box>
              {field('Completion gate', 'gateCommand', draft.gateCommand ?? '', (value) => updateDraft({ gateCommand: value || undefined }), 'Optional command')}
              <box height={2} flexDirection="column" backgroundColor={focusBg('approval')}>
                <text fg={focusFg('approval')}>Plan approval</text>
                <text fg={draft.requirePlanApproval ? theme.amber : theme.green}>{draft.requirePlanApproval ? '[x] Required' : '[ ] Automatic'}{editorFocus === 'approval' ? '  Space toggles' : ''}</text>
              </box>
            </box>
            <box width={editorRightWidth} flexDirection="column" border={['left']} borderStyle="single" borderColor={theme.border} paddingLeft={1}>
              <box height={2} flexDirection="column" backgroundColor={focusBg('phaseNav')}>
                <text fg={theme.violet}>WORKFLOW STRUCTURE</text>
                <box height={1} flexDirection="row">
                  <text fg={focusFg('phaseNav')} wrapMode="none">{`Phase ${phaseIndex + 1}/${draft.phases.length}  ‹ ${clip(phase?.title ?? '', Math.max(10, editorRightWidth - 34))} ›`}</text>
                  <box flexGrow={1} />
                  <text fg={editorFocus === 'phaseNav' ? theme.cyan : theme.dim} wrapMode="none">{editorFocus === 'phaseNav' ? '←/→ select' : ''}</text>
                </box>
              </box>
              {field('Phase title', 'phaseTitle', phase?.title ?? '', (value) => updatePhase({ title: value }), 'Phase title')}
              <box height={2} flexDirection="column" backgroundColor={focusBg('taskNav')}>
                <text fg={focusFg('taskNav')}>Task</text>
                <box height={1} flexDirection="row">
                  <text fg={theme.text} wrapMode="none">{`${taskIndex + 1}/${phase?.tasks.length ?? 0}  ‹ ${clip(task?.title ?? '', Math.max(10, editorRightWidth - 34))} ›`}</text>
                  <box flexGrow={1} />
                  <text fg={editorFocus === 'taskNav' ? theme.cyan : theme.dim} wrapMode="none">{editorFocus === 'taskNav' ? '←/→ select' : ''}</text>
                </box>
              </box>
              {field('Task key', 'taskKey', task?.key ?? '', (value) => updateTask({ key: value || undefined }), 'stable-key')}
              {field('Task title', 'taskTitle', task?.title ?? '', (value) => updateTask({ title: value }), 'Task outcome')}
              {field('Task instructions', 'taskDetail', task?.detail ?? '', (value) => updateTask({ detail: value }), 'Full instructions')}
              <box height={2} flexDirection="column" backgroundColor={focusBg('taskRole')}>
                <text fg={focusFg('taskRole')}>Assigned role</text>
                <text fg={theme.text}>{`‹ ${task?.role ?? 'teammate'} ›${editorFocus === 'taskRole' ? '  ←/→ change' : ''}`}</text>
              </box>
              {field('Paths', 'taskPaths', csv(task?.paths), (value) => updateTask({ paths: parseCsv(value) }), 'comma-separated paths')}
              {field('Dependencies', 'taskDeps', csv(task?.dependsOn), (value) => updateTask({ dependsOn: parseCsv(value) }), 'comma-separated task keys')}
            </box>
          </box>
        </box>
      ) : (
        <box flexGrow={1} paddingX={1} flexDirection="row" overflow="hidden">
          <box width={listWidth} flexDirection="column" border={['right']} borderStyle="single" borderColor={theme.border} paddingRight={1}>
            <box height={2} flexDirection="column">
              <text fg={theme.cyan}>SAVED PLAYBOOKS</text>
              <text fg={theme.dim}>{playbooks.length === 0 ? 'Press N to create the first one' : `${playbooks.length} reusable workflow${playbooks.length === 1 ? '' : 's'}`}</text>
            </box>
            {playbooks.map((entry, index) => (
              <box key={entry.name} height={2} flexDirection="column" backgroundColor={index === selectedIndex ? theme.violet : undefined} paddingLeft={1}>
                <text fg={index === selectedIndex ? theme.surface : theme.text} wrapMode="none">{clip(`${index === selectedIndex ? '› ' : '  '}${entry.name}`, listWidth - 2)}</text>
                <text fg={index === selectedIndex ? theme.surface : theme.dim} wrapMode="none">{`${entry.phaseCount} phases · ${entry.taskCount} tasks`}</text>
              </box>
            ))}
          </box>
          <box width={detailWidth} paddingLeft={2} flexDirection="column">
            {selected ? (
              <box height={18} flexDirection="column">
                <text fg={theme.violet}>{clip(selected.name.toUpperCase(), detailWidth)}</text>
                <box height={3} marginTop={1}><text fg={theme.text} wrapMode="word">{selected.description ?? 'No description'}</text></box>
                <text fg={theme.cyan}>{`${selected.phaseCount} phases  ·  ${selected.taskCount} tasks`}</text>
                <text fg={selected.expectsArgs ? theme.amber : theme.green}>{selected.expectsArgs ? 'Arguments required' : 'Arguments optional'}</text>
                <text fg={theme.dim} wrapMode="word">{selected.argsHint && selected.argsHint.toLowerCase() !== 'none' ? `Input: ${selected.argsHint}` : 'Optional arguments are attached to every task.'}</text>
                <box marginTop={1} flexDirection="column">
                  <text fg={theme.dim}>{`Agent limit     ${selected.maxAgents ?? 'launcher default'}`}</text>
                  <text fg={theme.dim}>{`Plan approval   ${selected.requirePlanApproval ? 'required' : 'automatic'}`}</text>
                  <text fg={theme.dim} wrapMode="word">{`Gate            ${selected.gateCommand ?? 'not configured'}`}</text>
                </box>
                {mode === 'delete' ? (
                  <box marginTop={1} flexDirection="column">
                    <text fg={theme.red}>{`DELETE ${selected.name}?`}</text>
                    <text fg={theme.dim}>Enter/Y confirms · Esc/N cancels</text>
                  </box>
                ) : null}
              </box>
            ) : <text fg={theme.dim}>Create a playbook to seed a task board without a planning turn.</text>}
          </box>
        </box>
      )}

      {error ? <box height={1} paddingX={1}><text fg={theme.red} wrapMode="none">{clip(error, bodyWidth)}</text></box> : null}
      <box height={2} paddingX={1} border={['top']} borderStyle="single" borderColor={theme.border} flexDirection="row" alignItems="center">
        <text fg={busy ? theme.amber : theme.dim} wrapMode="none">
          {busy ? 'Working…' : mode === 'edit'
            ? `${MULTILINE_EDITOR_FIELDS.has(editorFocus) ? 'Enter newline · ' : ''}Ctrl+S save · Ctrl+P phase · Ctrl+T task · Ctrl+X delete task · Ctrl+Shift+X delete phase · Esc cancel`
            : '↑/↓ select · Enter/E edit · N new · D delete · Esc close'}
        </text>
      </box>
    </box>
  )
}
