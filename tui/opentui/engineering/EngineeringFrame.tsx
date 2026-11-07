/** @jsxImportSource @opentui/react */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useRenderer } from '@opentui/react'
import type { TuiPluginCapture } from '../shell/pluginTypes'
import type { Session, RunningSessionRef } from '../../../lib/types'
import type { ProtocolAgent, ProtocolRunSnapshot } from '../../../lib/agentProtocol'
import type { ThreadedMessage } from '../../../lib/threading'
import { buildTaskRegistry } from '../../../lib/taskRegistry'
import type { TuiThemePalette } from '../../theme'
import type { TuiTranscriptCard } from '../../format'
import { type AttentionItem } from '../AttentionInboxPopover'
import { sessionKey } from '../app/sessionList'
import { fitText } from '../textLayout'
import { useWorkspaceState } from '../workspaceContext'
import { getProcesses, subscribeProcesses, addProcess, startProcess, type ManagedProcess } from '../processStore'
import { git, WorkspaceGitError } from '../../../lib/git/command'
import type { EngineeringRepository } from './repository'
import { createEngineeringRepositoryClient } from '../engineeringRepositoryWorkerClient'
import { engineeringEvidence, engineeringHandoff, engineeringFocusMode, engineeringSessionFiles, engineeringSessionInRepo, engineeringSessionTitle, engineeringSelectedFile, type InspectorTab } from './model'
import type { EngineeringFile } from './repository'
import type { useEngineeringLayout } from './state'
import { EngineeringAction as Action } from './EngineeringAction'
import { EngineeringChanges, type EngineeringChangesHandle } from './EngineeringChanges'
import { EngineeringHeader } from './EngineeringHeader'
import { PaneResizeHandle } from '../paneResize'
import { EngineeringInspectorContext } from './EngineeringInspectorWindow'
import { WindowButton } from '../WindowButton'
import { EngineeringWork, type EngineeringWorkHandle, type WorkSection } from './EngineeringWork'
import { useEngineeringWorkbench } from './workbenchState'
import { acknowledgeWorkSnapshot, checkVerification, ENGINEERING_RUNTIME_ID, findCheckProcess, compareWorkSnapshots, completedCheckResult, indexChangeEvidence, taskBriefMarkdown, workSnapshot, type ChangeEvidence, type EngineeringCheck, type WorkSession } from './workbenchModel'
export type { EngineeringCheck } from './workbenchModel'

export type EngineeringKey = { name: string; sequence: string; ctrl: boolean; shift: boolean; meta?: boolean }
export type EngineeringKeyHandler = (key: EngineeringKey) => boolean | 'input'
const EMPTY_PROCESSES: readonly ManagedProcess[] = []
const NO_SUBSCRIBE = () => () => {}
const INSPECTORS: InspectorTab[] = ['work', 'changes', 'checks', 'tasks', 'context', 'attention', 'handoff']
const SHORT_INSPECTOR_LABELS: Record<InspectorTab, string> = { work: 'work', changes: 'chg', checks: 'chk', tasks: 'tasks', context: 'ctx', attention: 'attn', handoff: 'hand' }
const FULL_INSPECTOR_CELLS = INSPECTORS.reduce((sum, tab) => sum + tab.length + 2, 0)
/** Prefer full names when they fit; compact names wrap on narrower inspectors. */
export function inspectorTabLabel(tab: InspectorTab, panelWidth: number): string {
  return FULL_INSPECTOR_CELLS <= panelWidth - 2 ? tab : SHORT_INSPECTOR_LABELS[tab]
}

export function inspectorTabRows(panelWidth: number): number {
  let rows = 1, cells = 0
  for (const tab of INSPECTORS) {
    const size = inspectorTabLabel(tab, panelWidth).length + 2
    if (cells && cells + size > panelWidth - 2) { rows++; cells = 0 }
    cells += size
  }
  return rows
}

type Props = {
  layout: ReturnType<typeof useEngineeringLayout>
  terminalWidth: number
  terminalHeight: number
  theme: TuiThemePalette
  cwd: string
  workspaceId?: string
  session: Session | null
  sessions?: Session[]
  sessionsLoading?: boolean
  transcriptLoading?: boolean
  selectedMessageKey?: string | null
  getSelectedMessageKey?: () => string | null
  coordination?: ProtocolRunSnapshot | null
  onOpenCoordinator?: (runId?: string) => void
  onOpenCoordinatorAgent?: (agent: ProtocolAgent) => void
  goalObjective?: string
  onOpenSession?: (key: string) => boolean
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
  inspectorWindowOpen?: boolean
  inspectorWindowFocused?: boolean
  inspectorWindowExpanded?: boolean
  onInspectorLeave?: () => void
  onInspectorWindow?: () => void
  onInspectorExpandWindow?: () => void
  onActivateEngineering?: () => void
  onAppend: (text: string) => void
  /** Open a file (absolute path) in the editor at a 1-based line. */
  onOpenFile?: (path: string, line: number | null) => void
  onCopy: (text: string) => void
  renderTerminal: (width: number, height: number, focused: boolean, register: (handler: EngineeringKeyHandler) => void, capture: (value: TuiPluginCapture) => void) => ReactNode
}

function InspectorBody({ scroll, focused, children }: { scroll: boolean; focused: boolean; children: ReactNode }) {
  return scroll ? <scrollbox flexGrow={1} minHeight={0} focused={focused}>{children}</scrollbox>
    : <box flexGrow={1} minHeight={0} flexDirection="column">{children}</box>
}

/** The child slot stays mounted while changing views; only chrome is opt-in. */
export function EngineeringFrame(props: Props) {
  const { layout, theme, cwd, onInspectorWindow } = props
  const renderer = useRenderer()
  const { active, preferences, setPreferences, inspectorWidth, drawerRows, headerRows } = layout
  const [repositoryState, setRepository] = useState<{ cwd: string; value: EngineeringRepository | null; error: string | null }>({ cwd, value: null, error: null })
  const repository = repositoryState.cwd === cwd ? repositoryState.value : null
  const error = repositoryState.cwd === cwd ? repositoryState.error : null
  const [dockedFocus, setFocused] = useState<'inspector' | 'terminal' | null>(null)
  const focused = props.inspectorWindowOpen ? props.inspectorWindowFocused ? 'inspector' : dockedFocus === 'terminal' ? 'terminal' : null : dockedFocus
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
  const workRef = useRef<EngineeringWorkHandle | null>(null)
  const terminalKeys = useRef<EngineeringKeyHandler | null>(null)
  const repositoryClient = useRef<ReturnType<typeof createEngineeringRepositoryClient> | null>(null)
  const currentRef = useRef({ active, cwd })
  useLayoutEffect(() => { currentRef.current = { active, cwd } }, [active, cwd])
  const allFiles = repository?.files ?? []
  const root = repository?.root ?? cwd
  const sessionFiles = useMemo(() => active ? engineeringSessionFiles(props.cards, root) : new Set<string>(), [active, props.cards, root])
  const scope = preferences.changesScope ?? 'all'
  const files = scope === 'session' ? allFiles.filter(file => sessionFiles.has(file.path)) : allFiles
  const selectedPath = engineeringSelectedFile(files, fileSelection.cwd === cwd ? fileSelection.path : null)?.path ?? null
  const selectedFile = files.find(file => file.path === selectedPath) ?? null
  const patch = patchState?.cwd === cwd && patchState.path === selectedPath ? patchState.text : ''
  const changesRef = useRef<EngineeringChangesHandle | null>(null)
  const [notice, setNotice] = useState<{ text: string; tone: 'info' | 'error' } | null>(null)
  const [armedRevert, setArmedRevert] = useState<string | null>(null)
  const refreshRepository = useRef<() => void>(() => {})
  const tasks = useMemo(() => active ? [...buildTaskRegistry(props.messages).values()] : [], [active, props.messages])
  const evidence = useMemo(() => active ? engineeringEvidence(props.cards) : [], [active, props.cards])
  const sourceIndex = useMemo(() => active ? indexChangeEvidence(props.cards, root) : new Map<string, ChangeEvidence[]>(), [active, props.cards, root])
  const fileEvidence = useMemo(() => selectedPath ? (sourceIndex.get(selectedPath) ?? []).map(item => item.edit) : [], [sourceIndex, selectedPath])
  const requestEvidence = selectedPath ? sourceIndex.get(selectedPath)?.at(-1)?.request : undefined
  const checkRows = useMemo(() => checks.filter(check => check.cwd === root || check.cwd === cwd).map(check => {
    const process = findCheckProcess(check, processes)
    const verification = checkVerification(check, process, repository?.fingerprint ?? null)
    const status = verification.state === 'stale' ? `STALE · was ${verification.result?.outcome ?? 'unknown'}` : verification.state
    const duration = process?.startedAt ? `${Math.round(((process.endedAt ?? Date.now()) - process.startedAt) / 1000)}s` : ''
    return { check, process, verification, text: `${check.command}: ${status}${verification.result?.exitCode != null ? ` (${verification.result.exitCode})` : ''} ${duration}` }
  }), [checks, processes, repository, root, cwd])
  // Keep completed, application-observed outcomes across restarts. Old runs
  // without an archived result remain unavailable rather than being guessed.
  useEffect(() => {
    if (!active) return
    setChecks(previous => {
      let changed = false
      const next = previous.map(check => {
        const result = completedCheckResult(findCheckProcess(check, processes))
        if (!result || check.result?.completedAt === result.completedAt) return check
        changed = true; return { ...check, result }
      })
      return changed ? next : previous
    })
  }, [active, processes, setChecks])
  const observedSessions = useMemo(() => (props.sessions ?? (props.session ? [props.session] : [])).filter(session => engineeringSessionInRepo(session, root)).map(session => ({
    key: sessionKey(session), title: engineeringSessionTitle(session), provider: session.provider,
    version: `${session.transcriptUpdatedAt ?? session.lastModified ?? ''}:${engineeringSessionTitle(session)}`,
  })), [props.sessions, props.session, root])
  const observedAttention = useMemo(() => {
    const keys = new Set(observedSessions.map(session => session.key))
    return props.attention.filter(item => keys.has(item.sessionKey))
  }, [observedSessions, props.attention])
  const currentSnapshot = useMemo(() => active && repository && !props.sessionsLoading
    ? workSnapshot(repository, observedSessions, checkRows.map(row => ({ id: row.check.id, verification: row.verification })), observedAttention.map(item => item.key)) : null,
    [active, repository, props.sessionsLoading, observedSessions, checkRows, observedAttention])
  const { brief, setBrief, checkpoint, setCheckpoint } = useEngineeringWorkbench(root, active, currentSnapshot, !props.sessionsLoading)
  const delta = useMemo(() => compareWorkSnapshots(checkpoint, currentSnapshot), [checkpoint, currentSnapshot])
  const [workSection, setWorkSection] = useWorkspaceState<WorkSection>(`engineering:work-section:${root}`, 'brief', false)
  const [evidencePath, setEvidencePath] = useWorkspaceState<string | null>(`engineering:evidence-path:${root}`, null, false)
  const [pendingSource, setPendingSource] = useState<{ session: WorkSession; cardKey: string; from: string | null; workspaceId?: string } | null>(null)
  const pendingSourceSeen = useRef(false)
  const currentWorkSession: WorkSession | null = props.session ? { key: sessionKey(props.session), title: engineeringSessionTitle(props.session), provider: props.session.provider } : null
  const selectedMessageKey = props.getSelectedMessageKey?.() ?? props.selectedMessageKey
  const selectedMessage = props.cards.find(card => card.key === selectedMessageKey) ?? null
  const selectedMessageFiles = useMemo(() => selectedMessageKey ? [...sourceIndex].flatMap(([path, items]) => items.some(item => [item.request?.key, item.edit.key, item.response?.key].includes(selectedMessageKey)) ? [path] : []) : [], [sourceIndex, selectedMessageKey])
  const handoff = useMemo(() => active ? `${taskBriefMarkdown(brief)}\n\n${engineeringHandoff({
    title: props.session ? engineeringSessionTitle(props.session) : 'Engineering handoff',
    identity: props.session ? sessionKey(props.session) : 'none', cwd, branch: repository?.branch,
    cards: props.cards, files: allFiles, checks: checkRows.map(row => `${row.text} · state ${row.check.fingerprint.slice(0, 12)}`),
    attention: props.attention.map(item => `${item.sessionTitle}: ${item.title}`),
  })}` : '', [active, props.session, cwd, repository, props.cards, allFiles, processes, checks, props.attention, brief])

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
    refreshRepository.current = () => { void refresh() }
    void refresh()
    const timer = setInterval(() => { void refresh() }, 5000)
    return () => { cancelled = true; clearInterval(timer); client.dispose(); if (repositoryClient.current === client) repositoryClient.current = null }
  }, [active, cwd])

  useEffect(() => {
    if (!active || !selectedPath) return
    let cancelled = false
    const file = files.find(value => value.path === selectedPath)
    void engineeringFileDiff(root, selectedPath, file?.status ?? '').then(text => {
      if (!cancelled) setPatch({ cwd, path: selectedPath, text: text || 'No textual diff (binary, rename, or no longer changed).' })
    }, cause => {
      if (!cancelled) setPatch({ cwd, path: selectedPath, text: String(cause) })
    })
    return () => { cancelled = true }
  }, [active, cwd, selectedPath, repository?.fingerprint])

  const focus = (target: 'inspector' | 'terminal') => { props.onFocus(); setFocused(target) }
  const selectInspector = (inspector: InspectorTab) => {
    setPreferences(previous => ({ ...previous, inspector, inspectorOpen: true, focusMode: false }))
    setCursor(0); setCompactOpen(true); focus('inspector')
    if (preferences.inspectorPlacement === 'window') props.onInspectorWindow?.()
  }
  const jump = (key: string) => { setFocused(null); props.onJump(key) }
  const inspectEvidence = (path = selectedPath) => { setEvidencePath(path); setWorkSection('evidence'); selectInspector('work') }
  const openEvidenceFile = (path: string) => {
    setEvidencePath(path)
    if (allFiles.some(file => file.path === path)) { setSelectedPath(path); selectInspector('changes') }
    else if (props.onOpenFile) { props.onOpenFile(`${root.replace(/\/+$/, '')}/${path}`, null); setFocused(null) }
    else setNotice({ text: 'This file is no longer changed. Open Git review to inspect its history.', tone: 'info' })
  }
  const jumpToWorkSource = (session: WorkSession, cardKey: string) => {
    if (session.key === currentWorkSession?.key) { jump(cardKey); return }
    if (props.onOpenSession?.(session.key)) { pendingSourceSeen.current = false; setPendingSource({ session, cardKey, from: currentWorkSession?.key ?? null, workspaceId: props.workspaceId }) }
    else setNotice({ text: 'Source session is not in the loaded catalog.', tone: 'info' })
  }
  useEffect(() => {
    if (!pendingSource) return
    if (!active || props.workspaceId !== pendingSource.workspaceId) { setPendingSource(null); return }
    const key = props.session ? sessionKey(props.session) : null
    if (key !== pendingSource.session.key) {
      if (key === null && (props.transcriptLoading || props.sessionsLoading)) return
      if (pendingSourceSeen.current || key !== pendingSource.from) setPendingSource(null)
      return
    }
    pendingSourceSeen.current = true
    if (props.transcriptLoading) return
    if (props.cards.some(card => card.key === pendingSource.cardKey)) { setFocused(null); props.onJump(pendingSource.cardKey) }
    else setNotice({ text: 'Source session opened; this message is outside the loaded transcript.', tone: 'info' })
    setPendingSource(null)
  }, [pendingSource, active, props.workspaceId, props.sessionsLoading, props.transcriptLoading, props.session, props.cards, props.onJump])

  const moveHunk = (step: number) => {
    if (!changesRef.current?.moveHunk(step)) setNotice({ text: 'No hunks in this file', tone: 'info' })
  }
  const openSelected = () => {
    if (!selectedPath) return
    if (!props.onOpenFile) { props.onReview(); return }
    props.onOpenFile(`${root.replace(/\/+$/, '')}/${selectedPath}`, changesRef.current?.hunkLine() ?? null)
    setFocused(null)
  }
  const mutateFile = async (file: EngineeringFile, action: 'stage' | 'unstage' | 'revert') => {
    const pathspec = `:(literal)${file.path}`
    const args = action === 'stage' ? ['add', '--', pathspec]
      : action === 'unstage' ? ['restore', '--staged', '--', pathspec]
      : ['restore', '--source=HEAD', '--staged', '--worktree', '--', pathspec]
    try {
      await git(root, args)
      setNotice({ text: `${action === 'stage' ? 'Staged' : action === 'unstage' ? 'Unstaged' : 'Reverted'} ${file.path}`, tone: 'info' })
    } catch (cause) { setNotice({ text: cause instanceof Error ? cause.message.split('\n')[0]! : String(cause), tone: 'error' }) }
    refreshRepository.current()
  }
  /** Revert discards work, so it is refused where HEAD has no version to restore and asks twice everywhere else. */
  const requestRevert = (file: EngineeringFile) => {
    if (file.status === '??') { setNotice({ text: 'Untracked file: nothing to restore it to (delete it yourself)', tone: 'error' }); return }
    if (/[ARC]/.test(file.status)) { setNotice({ text: 'Not in HEAD as this path: unstage it (u) instead', tone: 'error' }); return }
    if (armedRevert === file.path) { setArmedRevert(null); void mutateFile(file, 'revert'); return }
    setArmedRevert(file.path)
  }
  const runCheck = async (command: string, criterionId?: string, filePaths?: string[]) => {
    const ownerCwd = root
    try {
      const client = repositoryClient.current
      if (!client) return
      const before = await client.read(ownerCwd)
      if (!currentRef.current.active || currentRef.current.cwd !== cwd) return
      const id = addProcess({ name: `Engineering: ${command}`, command, cwd: ownerCwd, ownerId: props.workspaceId, reuse: false })
      setChecks(previous => [...previous.slice(-19), { id: crypto.randomUUID(), processId: id, runtimeId: ENGINEERING_RUNTIME_ID, command, cwd: ownerCwd, fingerprint: before.fingerprint, session: props.session ? sessionKey(props.session) : null, criterionId, filePaths }])
      startProcess(id)
      setRepository({ cwd, value: before, error: null })
    } catch (cause) { if (currentRef.current.active && currentRef.current.cwd === cwd) setNotice({ text: String(cause), tone: 'error' }) }
  }
  const rowActions: Array<() => void> = preferences.inspector === 'changes' ? files.map(file => () => setSelectedPath(file.path))
    : preferences.inspector === 'checks' ? [() => { void runCheck('npx tsc --noEmit') }, () => { void runCheck('npm run tui:check') }, ...evidence.map(card => () => jump(card.key))]
    : preferences.inspector === 'tasks' ? tasks.map(task => () => jump(task.latestEventUuid))
    : preferences.inspector === 'attention' ? props.attention.map(item => () => { setFocused(null); props.onAttention(item) }) : []
  const handler: EngineeringKeyHandler = key => {
    if (!active || props.blocked) return false
    if (key.name === 'f7') { setPreferences(previous => ({ ...previous, focusMode: !engineeringFocusMode(previous) })); setFocused(null); setCompactOpen(false); return true }
    if (key.name === 'f9') { setPreferences(previous => ({ ...previous, drawerOpen: !previous.drawerOpen, focusMode: false })); setCompactOpen(false); focus('terminal'); return true }
    if (key.name === 'f8') { if (props.inspectorWindowOpen && focused === 'inspector') props.onInspectorLeave?.(); else if (focused) setFocused(null); else { selectInspector(preferences.inspector) }; return true }
    if (focused === 'inspector' && preferences.inspector === 'work') { const result = workRef.current?.handleKey(key); if (result) return result }
    const input = renderer.currentFocusedRenderable
    if (input?.id.startsWith('engineering-input:')) {
      if (key.name === 'escape') { input.blur(); setCommentEditing(false); setFocused(null); setCompactOpen(false); return true }
      return 'input'
    }
    if (!focused || focused === 'terminal' && !preferences.drawerOpen) return false
    if (focused === 'terminal' && terminalCapture === 'terminal') { terminalKeys.current?.(key); return true }
    if (focused === 'terminal' && terminalCapture === 'input' && key.name !== 'escape') return 'input'
    if (key.name === 'escape') { if (props.inspectorWindowOpen) return false; setPreferences(previous => ({ ...previous, inspectorExpanded: false })); setFocused(null); setCompactOpen(false); return true }
    if (focused === 'inspector' && key.sequence === '=') { if (props.inspectorWindowOpen) props.onInspectorExpandWindow?.(); else setPreferences(previous => ({ ...previous, inspectorExpanded: !previous.inspectorExpanded })); return true }
    if (focused === 'inspector' && key.sequence === 'w' && !key.ctrl) { setPreferences(previous => ({ ...previous, inspectorPlacement: 'window', inspectorExpanded: false })); props.onInspectorWindow?.(); return true }
    if (commentEditing && preferences.inspector === 'changes') return 'input'
    if (focused === 'terminal') { if (key.name === 'tab' && !key.ctrl) { focus('inspector'); return true }; return terminalKeys.current?.(key) ?? false }
    if (key.name === 'tab') { if (drawerRows) focus('terminal'); else setFocused(null); return true }
    if (preferences.inspector === 'changes' && changesRef.current?.handleTreeKey(key.sequence === ' ' ? ' ' : key.name)) return true
    if (key.name === 'left' || key.name === 'right' || key.sequence === '[' || key.sequence === ']') {
      const direction = key.name === 'left' || key.sequence === '[' ? -1 : 1
      selectInspector(INSPECTORS[(INSPECTORS.indexOf(preferences.inspector) + direction + INSPECTORS.length) % INSPECTORS.length]!); return true
    }
    const currentCursor = preferences.inspector === 'changes' ? Math.max(0, files.findIndex(file => file.path === selectedPath)) : cursor
    if (key.name === 'down' || key.name === 'j') { const next = Math.min(currentCursor + 1, Math.max(rowActions.length - 1, 0)); setCursor(next); if (preferences.inspector === 'changes' && files[next]) setSelectedPath(files[next]!.path); return true }
    if (key.name === 'up' || key.name === 'k') { const next = Math.max(currentCursor - 1, 0); setCursor(next); if (preferences.inspector === 'changes' && files[next]) setSelectedPath(files[next]!.path); return true }
    if (preferences.inspector === 'changes') {
      setArmedRevert(null); setNotice(null)
      if (key.name === 'v') { inspectEvidence(); return true }
      if (key.name === 'o') { openSelected(); return true }
      if (key.name === 'e') { if (!changesRef.current?.expandContext()) setNotice({ text: 'No hidden context next to this hunk', tone: 'info' }); return true }
      if (key.name === 'z') { setPreferences(previous => ({ ...previous, diffWrap: !(previous.diffWrap ?? true) })); return true }
      if (key.name === 'n' && !key.shift) { moveHunk(1); return true }
      if (key.name === 'p' || key.name === 'n' && key.shift) { moveHunk(-1); return true }
      if (key.name === 'm') { setPreferences(previous => ({ ...previous, changesScope: (previous.changesScope ?? 'all') === 'all' ? 'session' : 'all' })); return true }
      if (key.name === 'c') { setCommentEditing(true); return true }
      if (selectedFile && changesRef.current?.fileCursor() === selectedFile.path && key.name === 's' && !key.shift) { void mutateFile(selectedFile, 'stage'); return true }
      if (selectedFile && changesRef.current?.fileCursor() === selectedFile.path && key.name === 'u') { void mutateFile(selectedFile, 'unstage'); return true }
      if (selectedFile && changesRef.current?.fileCursor() === selectedFile.path && key.name === 'x') { requestRevert(selectedFile); return true }
    }
    if (key.name === 'return') { rowActions[currentCursor]?.(); return true }
    if (key.name === 'r' && preferences.inspector === 'changes') { props.onReview(); return true }
    if (key.name === 'c' && preferences.inspector === 'handoff') { props.onCopy(handoff); return true }
    return true
  }
  useEffect(() => { props.registerKeys(active ? handler : null); return () => props.registerKeys(null) })
  const inspector = (panelWidth: number, panelHeight: number, window = false) => <box id="engineering-inspector" zIndex={10} width={panelWidth} height={panelHeight} border={!window} flexDirection="column" borderColor={focused === 'inspector' ? theme.cyan : theme.border} backgroundColor={theme.bg} onMouseDown={() => focus('inspector')}>
    {!window && !preferences.inspectorExpanded ? <PaneResizeHandle kind="inspector" extent={panelWidth} edge="left" inset={-1} /> : null}
    <box height={1} flexShrink={0} flexDirection="row"><text fg={theme.text} flexGrow={1}> INSPECTOR </text>
      <WindowButton id="engineering-inspector-expand" label={panelWidth < 40 ? ' ▣ ' : (window ? props.inspectorWindowExpanded : preferences.inspectorExpanded) ? ' ▭ restore ' : ' ▣ expand '} theme={theme} onPress={() => { focus('inspector'); if (window) props.onInspectorExpandWindow?.(); else setPreferences(previous => ({ ...previous, inspectorExpanded: !previous.inspectorExpanded })) }} />
      {!window && props.onInspectorWindow ? <WindowButton id="engineering-inspector-window" label={panelWidth < 40 ? ' ⇥ ' : ' ⇥ window '} theme={theme} onPress={() => { setPreferences(previous => ({ ...previous, inspectorPlacement: 'window', inspectorExpanded: false })); setCompactOpen(false); setFocused(null); props.onInspectorWindow?.() }} /> : null}
      {!window ? <WindowButton id="engineering-inspector-close" label=" × " theme={theme} onPress={() => { setPreferences(previous => ({ ...previous, inspectorOpen: false, inspectorExpanded: false })); setCompactOpen(false); setFocused(null) }} /> : null}
    </box>
    <box height={inspectorTabRows(panelWidth)} flexShrink={0} flexDirection="row" flexWrap="wrap" overflow="hidden">{INSPECTORS.map(tab => <Action key={tab} id={`engineering-tab:${tab}`} theme={theme} label={inspectorTabLabel(tab, panelWidth)} selected={preferences.inspector === tab} onPress={() => selectInspector(tab)} />)}</box>

    <InspectorBody scroll={preferences.inspector !== 'changes' && preferences.inspector !== 'work'} focused={focused === 'inspector'}>
      {error ? <text fg={theme.red}>{fitText(error, panelWidth - 4)}</text> : null}
      {preferences.inspector === 'work' ? <EngineeringWork root={root} width={panelWidth - 2} height={Math.max(3, panelHeight - 5 - (inspectorTabRows(panelWidth) - 1) + (window ? 2 : 0))} theme={theme}
        focused={focused === 'inspector'} ready={Boolean(repository || error)} brief={brief} setBrief={setBrief} section={workSection} onSection={setWorkSection}
        checkpoint={checkpoint} current={currentSnapshot} delta={delta} onAcknowledge={() => { if (currentSnapshot) setCheckpoint(acknowledgeWorkSnapshot(checkpoint, currentSnapshot)) }}
        currentSession={currentWorkSession} selectedMessage={selectedMessage} selectedMessageFiles={selectedMessageFiles} coordination={props.coordination} onOpenCoordinator={props.onOpenCoordinator} onOpenCoordinatorAgent={props.onOpenCoordinatorAgent} goalObjective={props.goalObjective}
        selectedFile={evidencePath ?? selectedPath} sources={sourceIndex} checks={checkRows} attention={observedAttention}
        onRunCheck={(command, criterionId, paths) => { void runCheck(command, criterionId, paths) }} onOpenFile={openEvidenceFile} onChooseFile={setEvidencePath}
        onOpenSession={key => { props.onOpenSession?.(key) }} onJump={jumpToWorkSource} onCopy={props.onCopy} onAppend={props.onAppend}
        onFocus={() => focus('inspector')} onAttention={props.onAttention} handleRef={workRef} /> : null}
      {preferences.inspector === 'changes' ? <EngineeringChanges
        files={files} width={panelWidth} height={panelHeight - (inspectorTabRows(panelWidth) - 1) + (window ? 2 : 0)} theme={theme} selectedPath={selectedPath} listRowsPreference={preferences.fileListRows}
        handleRef={changesRef} root={root} onTreeFocus={() => focus('inspector')} wrap={preferences.diffWrap ?? true} sessionFiles={sessionFiles} totalFiles={allFiles.length} scope={scope}
        onToggleScope={() => setPreferences(previous => ({ ...previous, changesScope: (previous.changesScope ?? 'all') === 'all' ? 'session' : 'all' }))}
        patch={patch} evidence={fileEvidence} requestEvidence={requestEvidence} onEvidence={() => inspectEvidence()} focused={focused === 'inspector'} editing={commentEditing}
        onSelect={(path, index) => { setSelectedPath(path); setCursor(index) }} onReview={props.onReview}
        onJump={jump} onBeginEdit={() => { setCommentEditing(true); focus('inspector') }}
        onEndEdit={() => { setCommentEditing(false); setFocused(null) }} onAppend={props.onAppend}
      /> : null}
      {preferences.inspector === 'checks' ? <box flexDirection="column">
        <text fg={theme.dim}>Application-recorded checks</text>
        <box flexDirection="row"><Action theme={theme} label="Run web types" selected={focused === 'inspector' && cursor === 0} onPress={() => { void runCheck('npx tsc --noEmit') }} /><Action theme={theme} label="Run TUI types" selected={focused === 'inspector' && cursor === 1} onPress={() => { void runCheck('npm run tui:check') }} /></box>
        {checkRows.map(({ check, process, text, verification }) => <box key={check.id} flexDirection="column"><text fg={verification.state === 'failed' ? theme.red : verification.state === 'stale' ? theme.amber : theme.text}>{text}</text><text fg={theme.dim}>State {check.fingerprint.slice(0, 12)} · {check.session ?? 'repository'}</text><text fg={theme.dim}>{(process?.lines ?? check.result?.output ?? []).slice(-3).join('\n')}</text></box>)}
        {!checkRows.length ? <text fg={theme.dim}>No recorded runs. Checks run only when requested.</text> : null}
        <text fg={theme.dim}>Transcript evidence · working state unknown</text>
        {evidence.map((card, index) => <Action key={card.key} theme={theme} selected={focused === 'inspector' && cursor === index + 2} label={fitText(card.compactSummary, panelWidth - 4)} onPress={() => jump(card.key)} />)}
      </box> : null}
      {preferences.inspector === 'tasks' ? <box flexDirection="column">{tasks.length ? tasks.map((task, index) => <Action key={task.id} theme={theme} selected={cursor === index} label={fitText(`${task.status}: ${task.subject}`, panelWidth - 4)} onPress={() => jump(task.latestEventUuid)} />) : <text fg={theme.dim}>No structured tasks recorded for this session.</text>}</box> : null}
      {preferences.inspector === 'context' ? <box flexDirection="column"><text fg={theme.text}>{cwd}</text><text fg={theme.dim}>Session: {props.session ? sessionKey(props.session) : 'none'}</text><text fg={theme.dim}>Branch: {repository?.branch ?? 'unavailable'}</text><text fg={theme.dim}>Working state: {repository?.fingerprint.slice(0, 12) ?? 'unavailable'}</text><text fg={theme.dim}>This panel uses passive local data. Runtime diagnostics are loaded only on request.</text><Action theme={theme} label="Open runtime diagnostics" onPress={props.onDiagnostics} /></box> : null}
      {preferences.inspector === 'attention' ? <box flexDirection="column">
        {props.attention.length ? props.attention.map((item, index) => <box key={item.key} flexDirection="column"><Action theme={theme} selected={cursor === index} label={fitText(`${item.kind}: ${item.sessionTitle} · ${item.title}`, panelWidth - 4)} onPress={() => props.onAttention(item)} />{item.kind === 'turn-done' || item.kind === 'viewer-note' ? <Action theme={theme} label="Acknowledge" onPress={() => props.onAcknowledge(item)} /> : null}</box>) : <text fg={theme.dim}>Nothing needs attention.</text>}
        {checkRows.filter(row => row.verification.result?.outcome === 'failed' && !acknowledgedChecks.includes(row.check.id)).map(row => <box key={row.check.id} flexDirection="column"><Action theme={theme} tone={theme.red} label={`Failed check: ${row.check.command}`} onPress={() => selectInspector('checks')} /><Action theme={theme} label="Acknowledge failure" onPress={() => setAcknowledgedChecks(previous => [...previous, row.check.id])} /></box>)}
      </box> : null}
      {preferences.inspector === 'handoff' ? <box flexDirection="column"><box flexDirection="row"><Action theme={theme} label="Copy / export Markdown" onPress={() => props.onCopy(handoff)} /><Action theme={theme} label="Add to composer" onPress={() => { props.onAppend(handoff); setFocused(null) }} /></box><text fg={theme.text}>{handoff}</text>{props.cards.filter(card => card.role === 'assistant' && card.category === 'conversation').slice(-3).map(card => <Action key={card.key} theme={theme} label={`Jump to source ${card.key.slice(-16)}`} onPress={() => jump(card.key)} />)}</box> : null}
    </InspectorBody>
    <box height={1} flexShrink={0}><text fg={armedRevert || notice?.tone === 'error' ? theme.red : theme.dim} wrapMode="none">{fitText(armedRevert ? ` x again reverts ${armedRevert} · any key keeps` : notice ? ` ${notice.text}` : focused !== 'inspector' ? ' F8 focus inspector'
      : preferences.inspector === 'work' ? ' 1 Brief · 2 Catch up · 3 Evidence · 4 Agents' : preferences.inspector === 'changes' ? ' v evidence · ←/→ folders · [/] tabs · n/p hunk · s/u stage · x revert · e context · z wrap · o edit · c comment · m mine' : ' ←/→ tabs · ↑/↓ select · ⏎ open · esc back', panelWidth - 2)}</text></box>
  </box>

  // Only inspector inputs invalidate its window; terminal capture changes do not.
  const renderInspectorWindow = useMemo(() => (width: number, height: number) => active ? inspector(width, height, true)
    : <box width={width} height={height}><WindowButton label=" Open Engineering inspector " theme={theme} onPress={() => onInspectorWindow?.()} /></box>,
    [props.layout, props.theme, props.cwd, props.session, props.cards, props.messages, props.attention,
      props.running, props.recent, props.blocked, props.terminalWidth, props.terminalHeight,
      props.onFocus, props.onInspectorWindow, props.onInspectorExpandWindow, props.onInspectorLeave,
      props.inspectorWindowOpen, props.inspectorWindowFocused, props.inspectorWindowExpanded,
      props.onReview, props.onDiagnostics, props.onAppend, props.onJump, props.onCopy,
      props.onAttention, props.onAcknowledge, props.onOpenFile, repositoryState, focused, cursor,
      fileSelection, patchState, checks, acknowledgedChecks, processes, commentEditing, notice, armedRevert, brief, checkpoint, currentSnapshot, delta, workSection, evidencePath, pendingSource, props.sessions, props.sessionsLoading, props.transcriptLoading, props.selectedMessageKey, props.getSelectedMessageKey, selectedMessageKey, props.goalObjective, props.onOpenSession, props.coordination, props.onOpenCoordinator, props.onOpenCoordinatorAgent])
  return <EngineeringInspectorContext.Provider value={renderInspectorWindow}><box width={props.terminalWidth} height={props.terminalHeight} flexDirection="column" backgroundColor={theme.bg}>
    {active ? <EngineeringHeader width={props.terminalWidth} rows={headerRows} theme={theme} focusMode={engineeringFocusMode(preferences)} workLabel={delta.count ? `Work +${delta.count}` : 'Work'} onWork={() => selectInspector('work')}
      title={` ENGINEERING · ${cwd.split('/').pop()}${brief.title ? ` · ${brief.title}` : ''} · ${repository?.branch ?? (error ? 'no repository' : 'loading…')}${files.length ? ` · ${files.length} change${files.length === 1 ? '' : 's'}` : ''}${props.running.length ? ` · ${props.running.length} running` : ''}${props.recent.size ? ` · ${props.recent.size} recent` : ''}${props.attention.length ? ` · ${props.attention.length} attention` : ''}`}
      onToggleFocus={() => { setPreferences(previous => ({ ...previous, focusMode: !engineeringFocusMode(previous) })); setFocused(null); setCompactOpen(false) }}
      onInspector={() => selectInspector(preferences.inspector)}
      onTerminal={() => { setPreferences(previous => ({ ...previous, drawerOpen: !previous.drawerOpen, focusMode: false })); setCompactOpen(false); focus('terminal') }} /> : null}
    <box height={layout.height} flexShrink={0} flexDirection="row">
      <box key="existing-workspace" onMouseDown={() => setFocused(null)} width={layout.width} height={layout.height}>{props.children}</box>
      {active && inspectorWidth ? inspector(inspectorWidth, layout.height) : null}
    </box>
    {active && preferences.inspectorOpen && !engineeringFocusMode(preferences) && preferences.inspectorPlacement !== 'window' && (preferences.inspectorExpanded || !inspectorWidth && compactOpen) ? <box position="absolute" left={0} top={headerRows} zIndex={30}>{inspector(props.terminalWidth, Math.max(props.terminalHeight - headerRows - 1, 12))}</box> : null}
    {active && preferences.drawerOpen && !engineeringFocusMode(preferences) ? <box id="engineering-terminal" position={drawerRows ? undefined : "absolute"} top={drawerRows ? undefined : headerRows} left={drawerRows ? undefined : 0} width={props.terminalWidth} zIndex={drawerRows ? undefined : 31} backgroundColor={theme.bg} height={drawerRows || Math.max(8, props.terminalHeight - 4)} flexShrink={0} flexDirection="column" border borderColor={focused === 'terminal' ? theme.cyan : theme.border} onMouseDown={() => focus('terminal')}>
      <box height={1} flexShrink={0} flexDirection="row"><text fg={theme.text}>TERMINAL / PROCESSES</text><Action theme={theme} label="Close" onPress={() => { setPreferences(previous => ({ ...previous, drawerOpen: false })); setFocused(null) }} /></box>
      <PaneResizeHandle kind="drawer" extent={drawerRows || Math.max(8, props.terminalHeight - 4)} edge="top" inset={-1} />
      {props.renderTerminal(props.terminalWidth - 2, (drawerRows || Math.max(8, props.terminalHeight - 4)) - 3, focused === 'terminal' && !props.blocked, handler => { terminalKeys.current = handler }, setTerminalCapture)}
    </box> : null}
  </box></EngineeringInspectorContext.Provider>
}

/**
 * The selected file's diff against HEAD, the unit a reviewer reads and `x` reverts to. An untracked
 * file is diffed against /dev/null so it renders like any addition; an unborn HEAD falls back to the
 * index and the working tree.
 */
async function engineeringFileDiff(root: string, path: string, status: string): Promise<string> {
  const flags = ['--no-ext-diff', '--no-textconv']
  const text = status === '??'
    // `--no-index` exits 1 when the files differ, which for /dev/null is always.
    ? await git(root, ['diff', '--no-index', ...flags, '--', '/dev/null', path]).catch(cause => cause instanceof WorkspaceGitError && cause.code === 1 ? cause.stdout : Promise.reject(cause))
    : await git(root, ['diff', 'HEAD', ...flags, '--', `:(literal)${path}`]).catch(async () =>
      (await Promise.all([git(root, ['diff', '--cached', ...flags, '--', `:(literal)${path}`]), git(root, ['diff', ...flags, '--', `:(literal)${path}`])])).join(''))
  if (text.length <= ENGINEERING_DIFF_MAX_CHARS) return text
  // Cut on a line so the last row is whole; the full review shows the rest.
  return text.slice(0, text.lastIndexOf('\n', ENGINEERING_DIFF_MAX_CHARS) + 1)
}
const ENGINEERING_DIFF_MAX_CHARS = 200_000
