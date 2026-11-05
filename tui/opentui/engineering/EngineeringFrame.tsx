/** @jsxImportSource @opentui/react */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useRenderer } from '@opentui/react'
import type { TuiPluginCapture } from '../shell/pluginTypes'
import type { Session, RunningSessionRef } from '../../../lib/types'
import type { ThreadedMessage } from '../../../lib/threading'
import { buildTaskRegistry } from '../../../lib/taskRegistry'
import type { TuiThemePalette } from '../../theme'
import type { TuiTranscriptCard } from '../../format'
import type { AttentionItem } from '../AttentionInboxPopover'
import { sessionKey } from '../app/sessionList'
import { fitText } from '../textLayout'
import { useWorkspaceState } from '../workspaceContext'
import { getProcesses, subscribeProcesses, addProcess, startProcess, type ManagedProcess } from '../processStore'
import { git } from '../../../lib/git/command'
import { browseBlob } from '../../../lib/git/browse'
import type { EngineeringRepository } from './repository'
import { createEngineeringRepositoryClient } from '../engineeringRepositoryWorkerClient'
import { engineeringEvidence, engineeringFileEvidence, engineeringHandoff, engineeringPreset, engineeringSessionTitle, engineeringSelectedFile, type EngineeringPreset, type InspectorTab } from './model'
import type { useEngineeringLayout } from './state'
import { EngineeringAction as Action } from './EngineeringAction'
import { EngineeringChanges } from './EngineeringChanges'
import { EngineeringHeader } from './EngineeringHeader'
import { PaneResizeHandle } from '../paneResize'

export type EngineeringKey = { name: string; sequence: string; ctrl: boolean; shift: boolean; meta?: boolean }
export type EngineeringKeyHandler = (key: EngineeringKey) => boolean | 'input'
export type EngineeringCheck = { id: string; command: string; fingerprint: string; cwd: string; session: string | null }
const EMPTY_PROCESSES: readonly ManagedProcess[] = []
const NO_SUBSCRIBE = () => () => {}
const INSPECTORS: InspectorTab[] = ['changes', 'checks', 'tasks', 'context', 'attention', 'handoff']
const PRESETS: EngineeringPreset[] = ['focus', 'build', 'review', 'multi-agent']

type Props = {
  layout: ReturnType<typeof useEngineeringLayout>
  terminalWidth: number
  terminalHeight: number
  theme: TuiThemePalette
  cwd: string
  workspaceId?: string
  session: Session | null
  cards: TuiTranscriptCard[]
  messages: ThreadedMessage[]
  attention: AttentionItem[]
  running: RunningSessionRef[]
  recent: ReadonlySet<string>
  children: ReactNode
  blocked: boolean
  registerKeys: (handler: EngineeringKeyHandler | null) => void
  onFocus: () => void
  onJump: (key: string) => void
  onAttention: (item: AttentionItem) => void
  onAcknowledge: (item: AttentionItem) => void
  onReview: () => void
  onDiagnostics: () => void
  onAppend: (text: string) => void
  onCopy: (text: string) => void
  onPreset: (preset: EngineeringPreset) => void
  renderTerminal: (width: number, height: number, focused: boolean, register: (handler: EngineeringKeyHandler) => void, capture: (value: TuiPluginCapture) => void) => ReactNode
}

function InspectorBody({ scroll, focused, children }: { scroll: boolean; focused: boolean; children: ReactNode }) {
  return scroll ? <scrollbox flexGrow={1} minHeight={0} focused={focused}>{children}</scrollbox>
    : <box flexGrow={1} minHeight={0} flexDirection="column">{children}</box>
}

/** The child slot stays mounted while changing views; only chrome is opt-in. */
export function EngineeringFrame(props: Props) {
  const { layout, theme, cwd } = props
  const renderer = useRenderer()
  const { active, preferences, setPreferences, inspectorWidth, drawerRows, headerRows } = layout
  const [repositoryState, setRepository] = useState<{ cwd: string; value: EngineeringRepository | null; error: string | null }>({ cwd, value: null, error: null })
  const repository = repositoryState.cwd === cwd ? repositoryState.value : null
  const error = repositoryState.cwd === cwd ? repositoryState.error : null
  const [focused, setFocused] = useState<'inspector' | 'terminal' | null>(null)
  const [compactOpen, setCompactOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const [fileSelection, setFileSelection] = useState<{ cwd: string; path: string | null }>({ cwd, path: null })
  const setSelectedPath = (path: string) => setFileSelection({ cwd, path })
  const [patchState, setPatch] = useState<{ cwd: string; path: string; text: string } | null>(null)
  const [commentEditing, setCommentEditing] = useState(false)
  const [checks, setChecks] = useWorkspaceState<EngineeringCheck[]>('engineering:checks', [])
  const [acknowledgedChecks, setAcknowledgedChecks] = useWorkspaceState<string[]>('engineering:acknowledgedChecks', [])
  const processes = useSyncExternalStore(active ? subscribeProcesses : NO_SUBSCRIBE, active ? getProcesses : () => EMPTY_PROCESSES, () => EMPTY_PROCESSES)
  const [terminalCapture, setTerminalCapture] = useState<TuiPluginCapture>(false)
  const terminalKeys = useRef<EngineeringKeyHandler | null>(null)
  const repositoryClient = useRef<ReturnType<typeof createEngineeringRepositoryClient> | null>(null)
  const currentRef = useRef({ active, cwd })
  useLayoutEffect(() => { currentRef.current = { active, cwd } }, [active, cwd])
  const files = repository?.files ?? []
  const selectedPath = engineeringSelectedFile(files, fileSelection.cwd === cwd ? fileSelection.path : null)?.path ?? null
  const patch = patchState?.cwd === cwd && patchState.path === selectedPath ? patchState.text : ''
  const tasks = useMemo(() => active ? [...buildTaskRegistry(props.messages).values()] : [], [active, props.messages])
  const evidence = useMemo(() => active ? engineeringEvidence(props.cards) : [], [active, props.cards])
  const fileEvidence = useMemo(() => active && selectedPath ? engineeringFileEvidence(props.cards, selectedPath, cwd) : [], [active, selectedPath, props.cards, cwd])
  const checkRows = checks.filter(check => check.cwd === cwd).map(check => {
    const process = processes.find(value => value.id === check.id)
    const stale = !repository || check.fingerprint !== repository.fingerprint
    const status = process?.status ?? 'unavailable after restart'
    const duration = process?.startedAt ? `${Math.round(((process.endedAt ?? Date.now()) - process.startedAt) / 1000)}s` : ''
    return { check, process, text: `${check.command}: ${status}${process?.exitCode != null ? ` (${process.exitCode})` : ''} ${duration}${stale ? ' · STALE / state unverified' : ''}` }
  })
  const handoff = useMemo(() => active ? engineeringHandoff({
    title: props.session ? engineeringSessionTitle(props.session) : 'Engineering handoff',
    identity: props.session ? sessionKey(props.session) : 'none', cwd, branch: repository?.branch,
    cards: props.cards, files, checks: checkRows.map(row => `${row.text} · state ${row.check.fingerprint.slice(0, 12)}`),
    attention: props.attention.map(item => `${item.sessionTitle}: ${item.title}`),
  }) : '', [active, props.session, cwd, repository, props.cards, files, processes, checks, props.attention])

  useEffect(() => {
    if (!active) return
    const client = createEngineeringRepositoryClient()
    repositoryClient.current = client
    let cancelled = false
    let reading = false
    const refresh = async () => {
      if (reading) return
      reading = true
      try {
        const value = await client.read(cwd)
        if (!cancelled) {
          setRepository({ cwd, value, error: null })
          setFileSelection(previous => {
            const path = engineeringSelectedFile(value.files, previous.cwd === cwd ? previous.path : null)?.path ?? null
            return previous.cwd === cwd && previous.path === path ? previous : { cwd, path }
          })
        }
      }
      catch (cause) { if (!cancelled) setRepository({ cwd, value: null, error: cause instanceof Error ? cause.message : String(cause) }) }
      reading = false
    }
    void refresh()
    const timer = setInterval(() => { void refresh() }, 5000)
    return () => { cancelled = true; clearInterval(timer); client.dispose(); if (repositoryClient.current === client) repositoryClient.current = null }
  }, [active, cwd])

  useEffect(() => {
    if (!active || !selectedPath) return
    let cancelled = false
    const file = files.find(value => value.path === selectedPath)
    const read = file?.status === '??'
      ? browseBlob(repository?.root ?? cwd, { path: selectedPath, name: selectedPath.split('/').pop()!, kind: 'blob' })
      : Promise.all([
        git(repository?.root ?? cwd, ['diff', '--no-ext-diff', '--no-textconv', '--', `:(literal)${selectedPath}`]),
        git(repository?.root ?? cwd, ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--', `:(literal)${selectedPath}`]),
      ]).then(([working, staged]) => `${staged ? `STAGED\n${staged}\n` : ''}${working ? `WORKING TREE\n${working}` : ''}` || 'No textual diff (binary, rename, or no longer changed).')
    void read.then(text => { if (!cancelled) setPatch({ cwd, path: selectedPath, text: text.length > 60000 ? `${text.slice(0, 60000)}\nPreview truncated; open full Git review.` : text }) }, cause => {
      if (!cancelled) setPatch({ cwd, path: selectedPath, text: String(cause) })
    })
    return () => { cancelled = true }
  }, [active, cwd, selectedPath, repository?.fingerprint])

  const focus = (target: 'inspector' | 'terminal') => { props.onFocus(); setFocused(target) }
  const selectInspector = (inspector: InspectorTab) => {
    setPreferences(previous => ({ ...previous, inspector, inspectorOpen: true }))
    setCursor(0); setCompactOpen(true); focus('inspector')
  }
  const jump = (key: string) => { setFocused(null); props.onJump(key) }
  const runCheck = async (command: string) => {
    const ownerCwd = cwd
    try {
      const client = repositoryClient.current
      if (!client) return
      const before = await client.read(ownerCwd)
      if (!currentRef.current.active || currentRef.current.cwd !== ownerCwd) return
      const id = addProcess({ name: `Engineering: ${command}`, command, cwd: ownerCwd, ownerId: props.workspaceId })
      setChecks(previous => [...previous.slice(-19), { id, command, cwd: ownerCwd, fingerprint: before.fingerprint, session: props.session ? sessionKey(props.session) : null }])
      startProcess(id)
      setRepository({ cwd: ownerCwd, value: before, error: null })
    } catch (cause) { if (currentRef.current.active && currentRef.current.cwd === ownerCwd) setRepository({ cwd: ownerCwd, value: null, error: String(cause) }) }
  }
  const rowActions: Array<() => void> = preferences.inspector === 'changes' ? files.map(file => () => setSelectedPath(file.path))
    : preferences.inspector === 'checks' ? [() => { void runCheck('npx tsc --noEmit') }, () => { void runCheck('npm run tui:check') }, ...evidence.map(card => () => jump(card.key))]
    : preferences.inspector === 'tasks' ? tasks.map(task => () => jump(task.latestEventUuid))
    : preferences.inspector === 'attention' ? props.attention.map(item => () => { setFocused(null); props.onAttention(item) }) : []
  const handler: EngineeringKeyHandler = key => {
    if (!active || props.blocked) return false
    if (key.name === 'f7') { const preset = PRESETS[(PRESETS.indexOf(preferences.preset) + 1) % PRESETS.length]!; setPreferences(previous => engineeringPreset(previous, preset)); props.onPreset(preset); setFocused(null); return true }
    if (key.name === 'f9') { setPreferences(previous => ({ ...previous, drawerOpen: !previous.drawerOpen, preset: previous.preset === 'focus' ? 'build' : previous.preset })); setCompactOpen(false); focus('terminal'); return true }
    if (key.name === 'f8') { if (focused) setFocused(null); else { selectInspector(preferences.inspector) }; return true }
    const input = renderer.currentFocusedRenderable
    if (input?.id.startsWith('engineering-input:')) {
      if (key.name === 'escape') { input.blur(); setCommentEditing(false); setFocused(null); setCompactOpen(false); return true }
      return 'input'
    }
    if (!focused || focused === 'terminal' && !preferences.drawerOpen) return false
    if (focused === 'terminal' && terminalCapture === 'terminal') { terminalKeys.current?.(key); return true }
    if (focused === 'terminal' && terminalCapture === 'input' && key.name !== 'escape') return 'input'
    if (key.name === 'escape') { setFocused(null); setCompactOpen(false); return true }
    if (commentEditing && preferences.inspector === 'changes') return 'input'
    if (focused === 'terminal') { if (key.name === 'tab' && !key.ctrl) { focus('inspector'); return true }; return terminalKeys.current?.(key) ?? false }
    if (key.name === 'tab') { if (drawerRows) focus('terminal'); else setFocused(null); return true }
    if (key.name === 'left' || key.name === 'right') {
      const direction = key.name === 'left' ? -1 : 1
      selectInspector(INSPECTORS[(INSPECTORS.indexOf(preferences.inspector) + direction + INSPECTORS.length) % INSPECTORS.length]!); return true
    }
    const currentCursor = preferences.inspector === 'changes' ? Math.max(0, files.findIndex(file => file.path === selectedPath)) : cursor
    if (key.name === 'down' || key.name === 'j') { const next = Math.min(currentCursor + 1, Math.max(rowActions.length - 1, 0)); setCursor(next); if (preferences.inspector === 'changes' && files[next]) setSelectedPath(files[next]!.path); return true }
    if (key.name === 'up' || key.name === 'k') { const next = Math.max(currentCursor - 1, 0); setCursor(next); if (preferences.inspector === 'changes' && files[next]) setSelectedPath(files[next]!.path); return true }
    if (key.name === 'return') { rowActions[currentCursor]?.(); return true }
    if (key.name === 'r' && preferences.inspector === 'changes') { props.onReview(); return true }
    if (key.name === 'c' && preferences.inspector === 'handoff') { props.onCopy(handoff); return true }
    return true
  }
  useEffect(() => { props.registerKeys(active ? handler : null); return () => props.registerKeys(null) })
  const inspector = (panelWidth: number, panelHeight: number) => <box id="engineering-inspector" zIndex={10} width={panelWidth} height={panelHeight} border flexDirection="column" borderColor={focused === 'inspector' ? theme.cyan : theme.border} backgroundColor={theme.bg} onMouseDown={() => focus('inspector')}>
    <PaneResizeHandle kind="inspector" extent={panelWidth} edge="left" inset={-1} />
    <box height={1} flexShrink={0} flexDirection="row"><text fg={theme.text}> INSPECTOR </text><Action theme={theme} label="×" onPress={() => { setPreferences(previous => ({ ...previous, inspectorOpen: false })); setCompactOpen(false); setFocused(null) }} /></box>
    <box height={2} flexShrink={0} flexDirection="row" flexWrap="wrap">{INSPECTORS.map(tab => <Action key={tab} theme={theme} label={tab} selected={preferences.inspector === tab} onPress={() => selectInspector(tab)} />)}</box>

    <InspectorBody scroll={preferences.inspector !== 'changes'} focused={focused === 'inspector'}>
      {error ? <text fg={theme.red}>{fitText(error, panelWidth - 4)}</text> : null}
      {preferences.inspector === 'changes' ? <EngineeringChanges
        files={files} width={panelWidth} height={panelHeight} theme={theme} selectedPath={selectedPath} listRowsPreference={preferences.fileListRows}
        patch={patch} evidence={fileEvidence} focused={focused === 'inspector'} editing={commentEditing}
        onSelect={(path, index) => { setSelectedPath(path); setCursor(index) }} onReview={props.onReview}
        onJump={jump} onBeginEdit={() => { setCommentEditing(true); focus('inspector') }}
        onEndEdit={() => { setCommentEditing(false); setFocused(null) }} onAppend={props.onAppend}
      /> : null}
      {preferences.inspector === 'checks' ? <box flexDirection="column">
        <text fg={theme.dim}>Application-recorded checks</text>
        <box flexDirection="row"><Action theme={theme} label="Run web types" selected={focused === 'inspector' && cursor === 0} onPress={() => { void runCheck('npx tsc --noEmit') }} /><Action theme={theme} label="Run TUI types" selected={focused === 'inspector' && cursor === 1} onPress={() => { void runCheck('npm run tui:check') }} /></box>
        {checkRows.map(({ check, process, text }) => <box key={check.id} flexDirection="column"><text fg={process?.status === 'failed' ? theme.red : theme.text}>{text}</text><text fg={theme.dim}>State {check.fingerprint.slice(0, 12)} · {check.session ?? 'repository'}</text><text fg={theme.dim}>{process?.lines.slice(-3).join('\n')}</text></box>)}
        {!checkRows.length ? <text fg={theme.dim}>No recorded runs. Checks run only when requested.</text> : null}
        <text fg={theme.dim}>Transcript evidence · working state unknown</text>
        {evidence.map((card, index) => <Action key={card.key} theme={theme} selected={focused === 'inspector' && cursor === index + 2} label={fitText(card.compactSummary, panelWidth - 4)} onPress={() => jump(card.key)} />)}
      </box> : null}
      {preferences.inspector === 'tasks' ? <box flexDirection="column">{tasks.length ? tasks.map((task, index) => <Action key={task.id} theme={theme} selected={cursor === index} label={fitText(`${task.status}: ${task.subject}`, panelWidth - 4)} onPress={() => jump(task.latestEventUuid)} />) : <text fg={theme.dim}>No structured tasks recorded for this session.</text>}</box> : null}
      {preferences.inspector === 'context' ? <box flexDirection="column"><text fg={theme.text}>{cwd}</text><text fg={theme.dim}>Session: {props.session ? sessionKey(props.session) : 'none'}</text><text fg={theme.dim}>Branch: {repository?.branch ?? 'unavailable'}</text><text fg={theme.dim}>Working state: {repository?.fingerprint.slice(0, 12) ?? 'unavailable'}</text><text fg={theme.dim}>This panel uses passive local data. Runtime diagnostics are loaded only on request.</text><Action theme={theme} label="Open runtime diagnostics" onPress={props.onDiagnostics} /></box> : null}
      {preferences.inspector === 'attention' ? <box flexDirection="column">
        {props.attention.length ? props.attention.map((item, index) => <box key={item.key} flexDirection="column"><Action theme={theme} selected={cursor === index} label={fitText(`${item.kind}: ${item.sessionTitle} · ${item.title}`, panelWidth - 4)} onPress={() => props.onAttention(item)} />{item.kind === 'turn-done' || item.kind === 'viewer-note' ? <Action theme={theme} label="Acknowledge" onPress={() => props.onAcknowledge(item)} /> : null}</box>) : <text fg={theme.dim}>Nothing needs attention.</text>}
        {checkRows.filter(row => row.process?.status === 'failed' && !acknowledgedChecks.includes(row.check.id)).map(row => <box key={row.check.id} flexDirection="column"><Action theme={theme} tone={theme.red} label={`Failed check: ${row.check.command}`} onPress={() => selectInspector('checks')} /><Action theme={theme} label="Acknowledge failure" onPress={() => setAcknowledgedChecks(previous => [...previous, row.check.id])} /></box>)}
      </box> : null}
      {preferences.inspector === 'handoff' ? <box flexDirection="column"><box flexDirection="row"><Action theme={theme} label="Copy / export Markdown" onPress={() => props.onCopy(handoff)} /><Action theme={theme} label="Add to composer" onPress={() => { props.onAppend(handoff); setFocused(null) }} /></box><text fg={theme.text}>{handoff}</text>{props.cards.filter(card => card.role === 'assistant' && card.category === 'conversation').slice(-3).map(card => <Action key={card.key} theme={theme} label={`Jump to source ${card.key.slice(-16)}`} onPress={() => jump(card.key)} />)}</box> : null}
    </InspectorBody>
    <box height={2} flexShrink={0}><text fg={theme.dim} wrapMode="none"> F8 focus · ←/→ tabs · ↑/↓ select</text><text fg={theme.dim} wrapMode="none"> Enter open · Esc return to transcript</text></box>
  </box>

  return <box width={props.terminalWidth} height={props.terminalHeight} flexDirection="column" backgroundColor={theme.bg}>
    {active ? <EngineeringHeader width={props.terminalWidth} rows={headerRows} theme={theme} preset={preferences.preset}
      title={` ENGINEERING · ${cwd.split('/').pop()} · ${repository?.branch ?? (error ? 'no repository' : 'loading…')}${files.length ? ` · ${files.length} change${files.length === 1 ? '' : 's'}` : ''}${props.running.length ? ` · ${props.running.length} running` : ''}${props.recent.size ? ` · ${props.recent.size} recent` : ''}${props.attention.length ? ` · ${props.attention.length} attention` : ''}`}
      onPreset={preset => { setPreferences(previous => engineeringPreset(previous, preset)); props.onPreset(preset); setFocused(null); setCompactOpen(false) }}
      onInspector={() => selectInspector(preferences.inspector)}
      onTerminal={() => { setPreferences(previous => ({ ...previous, drawerOpen: !previous.drawerOpen, preset: previous.preset === 'focus' ? 'build' : previous.preset })); setCompactOpen(false); focus('terminal') }} /> : null}
    <box height={layout.height} flexShrink={0} flexDirection="row">
      <box key="existing-workspace" onMouseDown={() => setFocused(null)} width={layout.width} height={layout.height}>{props.children}</box>
      {active && inspectorWidth ? inspector(inspectorWidth, layout.height) : null}
    </box>
    {active && !inspectorWidth && compactOpen ? <box position="absolute" left={0} top={headerRows} zIndex={30}>{inspector(props.terminalWidth, Math.max(props.terminalHeight - headerRows - 1, 12))}</box> : null}
    {active && preferences.drawerOpen && preferences.preset !== 'focus' ? <box id="engineering-terminal" position={drawerRows ? undefined : "absolute"} top={drawerRows ? undefined : headerRows} left={drawerRows ? undefined : 0} width={props.terminalWidth} zIndex={drawerRows ? undefined : 31} backgroundColor={theme.bg} height={drawerRows || Math.max(8, props.terminalHeight - 4)} flexShrink={0} flexDirection="column" border borderColor={focused === 'terminal' ? theme.cyan : theme.border} onMouseDown={() => focus('terminal')}>
      <box height={1} flexShrink={0} flexDirection="row"><text fg={theme.text}>TERMINAL / PROCESSES</text><Action theme={theme} label="Close" onPress={() => { setPreferences(previous => ({ ...previous, drawerOpen: false })); setFocused(null) }} /></box>
      <PaneResizeHandle kind="drawer" extent={drawerRows || Math.max(8, props.terminalHeight - 4)} edge="top" inset={-1} />
      {props.renderTerminal(props.terminalWidth - 2, (drawerRows || Math.max(8, props.terminalHeight - 4)) - 3, focused === 'terminal' && !props.blocked, handler => { terminalKeys.current = handler }, setTerminalCapture)}
    </box> : null}
  </box>
}

export function EngineeringRail({ sessions, running, recent, attention, selected, width, height, theme, preferences, onPreferences, onSelect, onNavigate, onFocus, enabled, registerKeys }: {
  sessions: Session[]; running: RunningSessionRef[]; recent: ReadonlySet<string>; attention: AttentionItem[]; selected: string | null; width: number; height?: number; theme: TuiThemePalette
  preferences: Props['layout']['preferences']; onPreferences: Props['layout']['setPreferences']; onSelect: (session: Session) => void; onNavigate: (session: Session) => void; onFocus: () => void; enabled: boolean; registerKeys: (handler: EngineeringKeyHandler | null) => void
}) {
  const [searchFocused, setSearchFocused] = useState(false)
  const attentionKeys = new Set(attention.map(item => item.sessionKey)), runningKeys = new Set(running.map(sessionKey))
  const groups = new Map<string, Session[]>([['NEEDS ATTENTION', []], ['RUNNING', []], ['RECENT ACTIVITY', []], ['PINNED', []], ['RECENT', []]])
  for (const session of sessions) {
    const key = sessionKey(session), title = engineeringSessionTitle(session)
    if (!`${title} ${session.summary ?? ''} ${session.cwd ?? ''}`.toLowerCase().includes(preferences.query.toLowerCase())) continue
    if (preferences.filter === 'attention' && !attentionKeys.has(key) || preferences.filter === 'running' && !runningKeys.has(key) || preferences.filter === 'pinned' && !preferences.pinned.includes(key)) continue
    const group = attentionKeys.has(key) ? 'NEEDS ATTENTION' : runningKeys.has(key) ? 'RUNNING' : recent.has(key) ? 'RECENT ACTIVITY' : preferences.pinned.includes(key) ? 'PINNED' : 'RECENT'
    groups.get(group)!.push(session)
  }
  const visible = [...groups].flatMap(([name, entries]) => preferences.collapsed.includes(name) ? [] : entries)
  useEffect(() => {
    registerKeys(key => {
      if (!enabled) return false
      if (key.sequence === '/') { setSearchFocused(true); onFocus(); return true }
      const index = visible.findIndex(session => sessionKey(session) === selected)
      if (key.name === 'j' || key.name === 'down' || key.name === 'k' || key.name === 'up') {
        const step = key.name === 'j' || key.name === 'down' ? 1 : -1
        const next = visible[Math.max(0, Math.min(visible.length - 1, index + step))]
        if (next) onNavigate(next)
        return true
      }
      if (key.name === 'return') { const session = visible[Math.max(0, index)]; if (session) onSelect(session); return true }
      return false
    })
    return () => registerKeys(null)
  })
  return <box id="engineering-sessions" width={width} height={height} alignSelf="stretch" flexShrink={0} border flexDirection="column" borderColor={enabled ? theme.cyan : theme.border} onMouseDown={onFocus}>
    <PaneResizeHandle kind="sidebar" extent={width} edge="right" inset={-1} />
    <box height={1} flexShrink={0}><text fg={theme.text}> SESSIONS · {sessions.length}</text></box>
    <box height={1} flexShrink={0} onMouseDown={() => { onFocus(); setSearchFocused(true) }}><input id="engineering-input:search" placeholder="Search sessions…" value={preferences.query} focused={searchFocused && enabled} onInput={query => onPreferences(previous => ({ ...previous, query }))} onSubmit={() => setSearchFocused(false)} /></box>
    <box height={1} flexShrink={0} flexDirection="row">{(['all', 'attention', 'running', 'pinned'] as const).map(filter => <Action key={filter} theme={theme} selected={preferences.filter === filter} label={filter === 'attention' ? 'input' : filter === 'running' ? 'run' : filter === 'pinned' ? 'pin' : 'all'} onPress={() => onPreferences(previous => ({ ...previous, filter }))} />)}</box>

    <scrollbox flexGrow={1} minHeight={0}>{[...groups].map(([name, entries]) => entries.length ? <box key={name} flexShrink={0} flexDirection="column">
      <Action theme={theme} label={`${preferences.collapsed.includes(name) ? '▸' : '▾'} ${name} / ${entries.length}`} onPress={() => onPreferences(previous => ({ ...previous, collapsed: previous.collapsed.includes(name) ? previous.collapsed.filter(value => value !== name) : [...previous.collapsed, name] }))} />
      {!preferences.collapsed.includes(name) ? entries.map(session => { const key = sessionKey(session); return <box key={key} flexShrink={0} flexDirection="column">
        <box flexDirection="row"><Action theme={theme} tone={theme.text} selected={selected === key} label={fitText(engineeringSessionTitle(session), width - 7)} onPress={() => { setSearchFocused(false); onSelect(session); onFocus() }} /><Action theme={theme} label={preferences.pinned.includes(key) ? '●' : '+'} onPress={() => onPreferences(previous => ({ ...previous, pinned: previous.pinned.includes(key) ? previous.pinned.filter(value => value !== key) : [...previous.pinned, key] }))} /></box>
        <text height={1} fg={theme.dim} wrapMode="none">{fitText(` ${session.provider} · ${attentionKeys.has(key) ? 'attention' : runningKeys.has(key) ? 'running' : recent.has(key) ? 'recent activity' : 'idle'}${session.summary?.startsWith('/') ? ` · ${session.summary}` : ''}`, width - 2)}</text>
      </box> }) : null}
    </box> : null)}</scrollbox>
  </box>
}
