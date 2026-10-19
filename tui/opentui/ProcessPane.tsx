/** @jsxImportSource @opentui/react */
// The surface panel's Terminal tab: long-running processes (a dev server, a
// watcher, `docker compose logs -f`) and their output, and interactive shells.
// Both live in stores (`processStore.ts`, `shellStore.ts`), so they keep
// running when this view closes; file:line references in a process's output
// are links into the editor, and one key hands the newest stack trace to an
// agent.
//
// A shell is driven in terminal mode, where every key goes to it — Escape and
// the ⌃ chords included, since vim and readline need them — until ⌃] hands the
// keys back (telnet's escape, and bound by no shell or editor by default).
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useRenderer } from '@opentui/react'
import type { BoxRenderable, MouseEvent as TuiMouseEvent } from '@opentui/core'

import type { TuiThemePalette } from '../theme'
import { parseTuiLineTokens, parseTuiLinkTarget } from '../../lib/tuiLinkTargets'
import { buildStackTracePrompt, findLatestStackTrace, type StackTrace } from '../../lib/stackTraces'
import { encodeTerminalKey, encodeTerminalMouse, encodeTerminalPaste, type TerminalMouseButton } from '../../lib/terminalKeys'
import { readProcessConfig, PROCESS_CONFIG_PATH } from './processConfig'
import { ShellView } from './ShellView'
import { readAllScreenText } from './shellScreen'
import { closeShell, getShells, shellTerminal, startShell, subscribeShells, writeShell, type ShellSession } from './shellStore'
import {
  addProcess,
  clearProcessOutput,
  getProcesses,
  removeProcess,
  restartProcess,
  startProcess,
  stopProcess,
  subscribeProcesses,
  type ManagedProcess,
} from './processStore'

export type ProcessPaneKey = { name: string; ctrl: boolean; shift: boolean; sequence: string; meta?: boolean; option?: boolean; raw?: string }
export type ProcessPaneCapture = 'none' | 'input' | 'terminal'

/** ⌃] — what leaves a shell's terminal mode. */
export function isTerminalLeaveKey(key: ProcessPaneKey): boolean {
  return (key.ctrl && (key.name === ']' || key.name === '5')) || key.sequence === '\x1d'
}

type Props = {
  theme: TuiThemePalette
  width: number
  height: number
  focused: boolean
  /** Where new commands run, and where processes.json is read from. */
  cwd: string
  onKeyHandlerReady: (handler: (key: ProcessPaneKey) => void) => void
  /**
   * `input` while a command is being typed (the host lets keys reach the input),
   * `terminal` while a shell has the keyboard (the host sends it every key).
   */
  onCaptureChange: (capture: ProcessPaneCapture) => void
  onAskAgent?: (prompt: string) => void
  onOpenFile: (path: string, line?: number) => void
  onNotice: (tone: 'info' | 'error', text: string, durationMs?: number) => void
  /** The shell or process shown first, and told of each change: a window that
   * moves to another row of the layout remounts, and must come back on the same one. */
  initialSelectedId?: string | null
  onSelectedChange?: (id: string | null) => void
}

type Highlight = { processId: string; trace: StackTrace; dropped: number }

function clip(text: string, width: number): string {
  if (width <= 0) return ''
  return text.length <= width ? text : width === 1 ? '…' : `${text.slice(0, width - 1)}…`
}

function age(ms: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - ms) / 1000))
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  return `${Math.floor(seconds / 3600)}h${Math.floor((seconds % 3600) / 60)}m`
}

export function processStatusGlyph(process: ManagedProcess): string {
  switch (process.status) {
    case 'running': return '●'
    case 'stopping': return '◌'
    case 'failed': return '✕'
    case 'exited': return '○'
    default: return '·'
  }
}

export function ProcessPane({
  theme,
  width,
  height,
  focused,
  cwd,
  onKeyHandlerReady,
  onCaptureChange,
  onAskAgent,
  onOpenFile,
  onNotice,
  initialSelectedId = null,
  onSelectedChange,
}: Props) {
  const renderer = useRenderer()
  const processes = useSyncExternalStore(subscribeProcesses, getProcesses, getProcesses)
  // Only the list; a shell's screen changes are ShellView's to re-render.
  const shellList = useSyncExternalStore(subscribeShells, getShells, getShells)
  const shellIds = shellList.map((entry) => `${entry.id}:${entry.status}:${entry.name}`).join('|')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shells = useMemo(() => shellList, [shellIds])
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId)
  const onSelectedChangeRef = useRef(onSelectedChange)
  onSelectedChangeRef.current = onSelectedChange
  useEffect(() => { onSelectedChangeRef.current?.(selectedId) }, [selectedId])
  const [terminalMode, setTerminalMode] = useState(false)
  // Rows into a shell's scrollback; 0 is the live screen.
  const [shellBack, setShellBack] = useState(0)
  const [closeArmed, setCloseArmed] = useState<string | null>(null)
  // The absolute number (counting dropped lines) of the last line shown, or
  // null to follow new output. Absolute, so arriving output does not drag a
  // scrolled-back view along with it.
  const [pinnedEnd, setPinnedEnd] = useState<number | null>(null)
  const [typing, setTyping] = useState(false)
  const [draft, setDraft] = useState('')
  const [highlight, setHighlight] = useState<Highlight | null>(null)
  const [configNote, setConfigNote] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void readProcessConfig(cwd).then((config) => {
      if (cancelled) return
      for (const definition of config.definitions) addProcess(definition)
      setConfigNote(config.error ?? (config.source ? null : config.definitions.length > 0 ? `suggested from the repository · declare your own in ${PROCESS_CONFIG_PATH}` : null))
    })
    return () => { cancelled = true }
  }, [cwd])

  const itemIds = useMemo(() => [...processes.map((entry) => entry.id), ...shells.map((entry) => entry.id)], [processes, shells])
  const activeId = selectedId && itemIds.includes(selectedId) ? selectedId : itemIds[0] ?? null
  const selected = processes.find((entry) => entry.id === activeId) ?? null
  const selectedShell: ShellSession | null = shells.find((entry) => entry.id === activeId) ?? null
  const shellLive = selectedShell?.status === 'running'

  // Terminal mode belongs to a running shell; it ends when the shell does or is left.
  useEffect(() => { if (terminalMode && !shellLive) setTerminalMode(false) }, [shellLive, terminalMode])
  useEffect(() => { onCaptureChange(typing ? 'input' : terminalMode ? 'terminal' : 'none') }, [onCaptureChange, terminalMode, typing])
  useEffect(() => () => onCaptureChange('none'), [onCaptureChange])
  const now = Date.now()

  const logHeight = Math.max(1, height - 3)
  const innerWidth = Math.max(4, width - 2)
  const lines = selected?.lines ?? []
  const dropped = selected?.droppedLines ?? 0
  const minEnd = Math.min(lines.length, logHeight)
  const end = pinnedEnd === null ? lines.length : Math.max(minEnd, Math.min(lines.length, pinnedEnd - dropped + 1))
  const back = lines.length - end
  const visible = lines.slice(Math.max(0, end - logHeight), end)
  const firstVisible = Math.max(0, end - logHeight)

  // The trace's indices move as old lines are dropped from the front.
  const traceRange = useMemo(() => {
    if (!highlight || !selected || highlight.processId !== selected.id) return null
    const shift = selected.droppedLines - highlight.dropped
    const start = highlight.trace.startIndex - shift
    const finish = highlight.trace.endIndex - shift
    return finish < 0 ? null : { start, finish }
  }, [highlight, selected])

  const select = useCallback((delta: number) => {
    if (itemIds.length === 0) return
    const index = Math.max(0, itemIds.indexOf(activeId ?? ''))
    setSelectedId(itemIds[(index + delta + itemIds.length) % itemIds.length] ?? null)
    setPinnedEnd(null)
    setShellBack(0)
    setCloseArmed(null)
  }, [activeId, itemIds])

  const sendTrace = useCallback((trace: StackTrace, name: string, command: string, traceCwd: string) => {
    if (!onAskAgent) {
      onNotice('info', 'No conversation to send the error to', 3000)
      return
    }
    onAskAgent(buildStackTracePrompt({ trace, processName: name, command, cwd: traceCwd }))
  }, [onAskAgent, onNotice])

  const showTrace = useCallback((target: ManagedProcess, send: boolean) => {
    const trace = findLatestStackTrace(target.lines)
    if (!trace) {
      onNotice('info', `No error in ${target.name}'s output`, 3000)
      return
    }
    setHighlight({ processId: target.id, trace, dropped: target.droppedLines })
    // Put the trace's last line near the bottom, so its frames are on screen.
    const last = Math.min(trace.endIndex + 1, target.lines.length - 1)
    setPinnedEnd(last >= target.lines.length - 1 ? null : target.droppedLines + last)
    if (send) sendTrace(trace, target.name, target.command, target.cwd)
  }, [onNotice, sendTrace])

  const openShell = useCallback(() => {
    void startShell({ cwd, cols: Math.max(4, width - 2), rows: Math.max(1, height - 3) }).then((id) => {
      setSelectedId(id)
      setShellBack(0)
      setTerminalMode(true)
    }).catch((error: unknown) => onNotice('error', error instanceof Error ? error.message : 'Could not start a shell'))
  }, [cwd, height, onNotice, width])

  const submit = useCallback(() => {
    const command = draft.trim()
    setTyping(false)
    setDraft('')
    if (!command) return
    const id = addProcess({ name: command.split(/\s+/).slice(0, 3).join(' '), command, cwd })
    setSelectedId(id)
    setPinnedEnd(null)
    startProcess(id)
  }, [cwd, draft])

  // Moving the last shown line of a process's log; reaching the newest one follows again.
  const scrollTo = useCallback((nextEnd: number) => {
    const clamped = Math.max(minEnd, Math.min(lines.length, nextEnd))
    setPinnedEnd(clamped >= lines.length ? null : dropped + clamped - 1)
  }, [dropped, lines.length, minEnd])

  const handleKey = useCallback((key: ProcessPaneKey) => {
    if (terminalMode && selectedShell) {
      if (isTerminalLeaveKey(key)) { setTerminalMode(false); return }
      const term = shellTerminal(selectedShell.id)
      const bytes = key.name === 'paste'
        ? encodeTerminalPaste(key.sequence, term?.bracketedPaste() ?? false)
        : encodeTerminalKey(key, { cursorKeysApp: term?.cursorKeysApp() ?? false })
      if (bytes) {
        writeShell(selectedShell.id, bytes)
        setShellBack(0)
      }
      return
    }
    if (typing) {
      if (key.name === 'escape') { setTyping(false); setDraft('') }
      return
    }
    if (key.sequence !== 'x') setCloseArmed(null)
    if (key.sequence === 'n' || key.sequence === ':') { setTyping(true); return }
    if (key.sequence === 'o') { openShell(); return }
    if (key.name === 'left' || key.sequence === '[') { select(-1); return }
    if (key.name === 'right' || key.sequence === ']') { select(1); return }
    if (selectedShell) {
      const term = shellTerminal(selectedShell.id)
      const maxBack = term && !term.usingAltScreen() ? term.getScrollbackCount() : 0
      const scrollShell = (delta: number) => setShellBack((value) => Math.max(0, Math.min(maxBack, value + delta)))
      const pageRows = Math.max(1, height - 3)
      if (key.name === 'return' || key.sequence === 'i') {
        if (shellLive) setTerminalMode(true)
        else onNotice('info', `${selectedShell.name} has exited · o opens a new shell`, 3000)
        return
      }
      if (key.name === 'k' || key.name === 'up') { scrollShell(1); return }
      if (key.name === 'j' || key.name === 'down') { scrollShell(-1); return }
      if (key.name === 'pageup' || (key.ctrl && key.name === 'u')) { scrollShell(pageRows); return }
      if (key.name === 'pagedown' || (key.ctrl && key.name === 'd')) { scrollShell(-pageRows); return }
      if (key.sequence === 'G' || key.name === 'end') { setShellBack(0); return }
      if (key.sequence === 'g' || key.name === 'home') { setShellBack(maxBack); return }
      if (key.sequence === 'e' || key.sequence === 't') {
        const trace = term ? findLatestStackTrace(readAllScreenText(term)) : null
        if (!trace) onNotice('info', `No error in ${selectedShell.name}'s output`, 3000)
        else if (key.sequence === 'e') sendTrace(trace, selectedShell.name, `interactive ${selectedShell.name}`, selectedShell.cwd)
        else onNotice('info', trace.headline || 'Found an error', 4000)
        return
      }
      if (key.sequence === 'x') {
        // Closing a live shell ends whatever runs in it, so it takes a second press.
        if (shellLive && closeArmed !== selectedShell.id) { setCloseArmed(selectedShell.id); return }
        setCloseArmed(null)
        closeShell(selectedShell.id)
        return
      }
      return
    }
    // Moving the last shown line; reaching the newest one follows again.
    if (key.name === 'j' || key.name === 'down') { scrollTo(end + 1); return }
    if (key.name === 'k' || key.name === 'up') { scrollTo(end - 1); return }
    if (key.name === 'pagedown' || (key.ctrl && key.name === 'd')) { scrollTo(end + logHeight); return }
    if (key.name === 'pageup' || (key.ctrl && key.name === 'u')) { scrollTo(end - logHeight); return }
    if (key.sequence === 'G' || key.name === 'end') { setPinnedEnd(null); return }
    if (key.sequence === 'g' || key.name === 'home') { scrollTo(0); return }
    if (!selected) return
    if (key.sequence === 's' || key.name === 'return') {
      if (selected.status === 'running') stopProcess(selected.id)
      else if (selected.status !== 'stopping') { setPinnedEnd(null); startProcess(selected.id) }
      return
    }
    if (key.sequence === 'r') { setPinnedEnd(null); restartProcess(selected.id); return }
    if (key.sequence === 'e') { showTrace(selected, true); return }
    if (key.sequence === 't') { showTrace(selected, false); return }
    if (key.sequence === 'c') { clearProcessOutput(selected.id); setHighlight(null); setPinnedEnd(null); return }
    if (key.sequence === 'x') {
      if (!removeProcess(selected.id)) onNotice('info', `Stop ${selected.name} before removing it`, 3000)
      return
    }
  }, [closeArmed, end, height, logHeight, onNotice, openShell, scrollTo, select, selected, selectedShell, sendTrace, shellLive, showTrace, terminalMode, typing])

  useEffect(() => { onKeyHandlerReady(handleKey) }, [handleKey, onKeyHandlerReady])

  // A file:line in the output opens the editor there. On mouse up with the
  // pointer unmoved, like the transcript's links, so a drag still selects.
  const pressRef = useRef<{ x: number; y: number } | null>(null)

  const statusColor = (entry: ManagedProcess) => entry.status === 'running' ? theme.green
    : entry.status === 'failed' ? theme.red
    : entry.status === 'stopping' ? theme.amber
    : theme.dim

  const statusLine = selectedShell
    ? [
        selectedShell.status === 'running' ? (terminalMode ? 'typing into the shell' : 'shell') : selectedShell.status === 'exited' ? `exited ${selectedShell.exitCode ?? 0}` : 'failed',
        shellBack > 0 ? `${shellBack} rows up · G returns` : null,
        selectedShell.title,
        selectedShell.cwd,
      ].filter(Boolean).join(' · ')
    : !selected
    ? ''
    : [
        // State first: the command is the part a narrow panel can afford to cut.
        selected.status === 'running' && selected.startedAt ? `running ${age(selected.startedAt, now)}` : null,
        selected.status === 'stopping' ? 'stopping' : null,
        selected.status === 'failed' ? (selected.signal ? `killed by ${selected.signal}` : `exit ${selected.exitCode ?? '?'}`) : null,
        selected.status === 'exited' ? 'stopped' : null,
        selected.status === 'idle' ? 'not started' : null,
        back > 0 ? `${back} lines up · G follows` : null,
        selected.command,
      ].filter(Boolean).join(' · ')

  // Every hint is also a button, so the pane can be driven by the mouse alone.
  const press = (sequence: string, name = sequence) => handleKey({ name, ctrl: false, shift: sequence !== sequence.toLowerCase(), sequence })
  type HintAction = { key: string; label: string; run?: () => void }
  const hintActions: HintAction[] = typing
    ? [{ key: '⏎', label: 'runs it', run: submit }, { key: 'esc', label: 'cancels', run: () => press('', 'escape') }]
    : terminalMode
    ? [{ key: '⌃]', label: 'leaves the shell (keys go back to the panel)', run: () => setTerminalMode(false) }]
    : closeArmed && closeArmed === selectedShell?.id
    ? [{ key: 'x', label: `again closes ${selectedShell.name} and ends what runs in it`, run: () => press('x') }, { key: 'esc', label: 'keeps it', run: () => setCloseArmed(null) }]
    : selectedShell
    ? [
        ...(shellLive ? [{ key: '⏎', label: 'type into it', run: () => press('', 'return') }] : []),
        { key: 'e', label: 'send error to agent', run: () => press('e') },
        { key: 'o', label: 'new shell', run: () => press('o') },
        { key: 'n', label: 'new command', run: () => press('n') },
        { key: 'x', label: 'close', run: () => press('x') },
        { key: 'k/j', label: 'scroll' },
      ]
    : selected
    ? [
        { key: 's', label: selected.status === 'running' ? 'stop' : 'start', run: () => press('s') },
        { key: 'r', label: 'restart', run: () => press('r') },
        { key: 'e', label: 'send error to agent', run: () => press('e') },
        { key: 'x', label: 'remove', run: () => press('x') },
        { key: 'c', label: 'clear', run: () => press('c') },
        { key: 't', label: 'find error', run: () => press('t') },
        { key: 'o', label: 'shell', run: () => press('o') },
        { key: 'n', label: 'command', run: () => press('n') },
      ]
    : [{ key: 'o', label: 'opens a shell', run: () => press('o') }, { key: 'n', label: 'runs a command', run: () => press('n') }]
  // Whole entries are dropped from the end rather than cutting one in half.
  const fittedHints: HintAction[] = []
  let hintWidth = 0
  for (const action of hintActions) {
    const cost = action.key.length + action.label.length + (fittedHints.length > 0 ? 4 : 1)
    if (hintWidth + cost > innerWidth) break
    fittedHints.push(action)
    hintWidth += cost
  }

  // Mouse into a shell: a program that asked for the mouse (vim, less, htop)
  // is sent it; otherwise the wheel scrolls back and a click takes the keys.
  const logBoxRef = useRef<BoxRenderable | null>(null)
  const forwardShellMouse = (event: TuiMouseEvent, button: TerminalMouseButton, action: 'press' | 'release' | 'drag'): boolean => {
    if (!selectedShell || !shellLive || shellBack > 0) return false
    const term = shellTerminal(selectedShell.id)
    const box = logBoxRef.current
    const tracking = term?.mouseTracking() ?? 0
    if (!term || !box || tracking === 0) return false
    // 1000 reports presses and releases, 1002 adds drags with a button held, 1003 all motion.
    if (action === 'drag' && tracking === 1000) return true
    const bytes = encodeTerminalMouse({
      button,
      action,
      col: event.x - box.x + 1,
      row: event.y - box.y + 1,
      shift: event.modifiers?.shift,
      alt: event.modifiers?.alt,
      ctrl: event.modifiers?.ctrl,
    }, { sgr: term.mouseSgr() })
    if (bytes) writeShell(selectedShell.id, bytes)
    return true
  }
  const mouseButton = (button: number): TerminalMouseButton => button === 1 ? 'middle' : button === 2 ? 'right' : 'left'

  return (
    <box height={height} flexDirection="column" paddingX={1}>
      <box height={1} flexDirection="row" overflow="hidden">
        {itemIds.length === 0 ? (
          <text fg={theme.dim} wrapMode="none">{clip('no processes or shells', innerWidth)}</text>
        ) : (
          // A box per entry, with a direction, so each is its own click target.
          [
            ...processes.map((entry) => ({ id: entry.id, glyph: processStatusGlyph(entry), color: statusColor(entry), name: entry.name })),
            ...shells.map((entry) => ({ id: entry.id, glyph: '❯', color: entry.status === 'running' ? theme.green : entry.status === 'failed' ? theme.red : theme.dim, name: entry.name })),
          ].map((entry) => (
            <box
              key={entry.id}
              flexDirection="row"
              marginRight={1}
              backgroundColor={entry.id === activeId ? theme.surface3 : undefined}
              onMouseDown={(event: TuiMouseEvent) => {
                if (event.button !== 0) return
                setSelectedId(entry.id)
                setPinnedEnd(null)
                setShellBack(0)
                setCloseArmed(null)
                if (entry.id !== activeId) setTerminalMode(false)
              }}
            >
              <text wrapMode="none">
                <span fg={entry.color}>{` ${entry.glyph}`}</span>
                <span fg={entry.id === activeId ? theme.text : theme.dim}>{` ${entry.name} `}</span>
              </text>
            </box>
          ))
        )}
        <box flexGrow={1} />
        <box onMouseDown={(event: TuiMouseEvent) => { if (event.button === 0) press('o') }}>
          <text fg={theme.cyan} wrapMode="none">{' + shell '}</text>
        </box>
        <box onMouseDown={(event: TuiMouseEvent) => { if (event.button === 0) press('n') }}>
          <text fg={theme.cyan} wrapMode="none">{' + command'}</text>
        </box>
      </box>

      <box
        ref={logBoxRef}
        height={logHeight}
        flexDirection="column"
        overflow="hidden"
        onMouseDown={(event: TuiMouseEvent) => {
          pressRef.current = event.button === 0 ? { x: event.x, y: event.y } : null
          // A click on a live shell gives it the keyboard, as clicking a terminal window does.
          if (selectedShell && shellLive) {
            setTerminalMode(true)
            forwardShellMouse(event, mouseButton(event.button), 'press')
          }
        }}
        onMouseDrag={(event: TuiMouseEvent) => {
          if (selectedShell) forwardShellMouse(event, mouseButton(event.button), 'drag')
        }}
        onMouseUp={(event: TuiMouseEvent) => {
          const press = pressRef.current
          pressRef.current = null
          if (selectedShell) { forwardShellMouse(event, mouseButton(event.button), 'release'); return }
          if (event.button !== 0 || !press || press.x !== event.x || press.y !== event.y) return
          const target = parseTuiLinkTarget(renderer.getLinkAt(event.x, event.y) ?? '')
          if (target?.kind === 'file') onOpenFile(target.path, target.line)
        }}
        onMouseScroll={(event: TuiMouseEvent) => {
          const up = event.scroll?.direction === 'up'
          if (selectedShell) {
            if (forwardShellMouse(event, up ? 'wheel-up' : 'wheel-down', 'press')) return
            const term = shellTerminal(selectedShell.id)
            // A full-screen program that did not ask for the mouse gets arrows, as most terminals do.
            if (term?.usingAltScreen()) {
              if (shellLive) writeShell(selectedShell.id, (up ? (term.cursorKeysApp() ? '\x1bOA' : '\x1b[A') : (term.cursorKeysApp() ? '\x1bOB' : '\x1b[B')).repeat(3))
              return
            }
            const maxBack = term ? term.getScrollbackCount() : 0
            setShellBack((value) => Math.max(0, Math.min(maxBack, value + (up ? 3 : -3))))
            return
          }
          if (selected) scrollTo(end + (up ? -3 : 3))
        }}
      >
        {selectedShell ? (
          <ShellView
            shellId={selectedShell.id}
            theme={theme}
            width={innerWidth}
            height={logHeight}
            showCursor={terminalMode && focused}
            scrollBack={shellBack}
          />
        ) : !selected ? (
          <text fg={theme.dim} wrapMode="word">
            {`o opens an interactive shell; ⌃] hands the keys back. n runs a dev server, a watcher or a log tail in ${cwd}, which keeps running when this panel closes. Declare a repository's processes in ${PROCESS_CONFIG_PATH}: { "processes": [{ "name": "web", "command": "npm run dev" }] }`}
          </text>
        ) : visible.length === 0 ? (
          <text fg={theme.dim} wrapMode="none">{clip(selected.status === 'idle' ? `${selected.name} is not running · s starts it` : 'no output yet', innerWidth)}</text>
        ) : (
          // One text for the window: a renderable per log line is what a
          // repaint ten times a second would otherwise cost.
          <text wrapMode="none">
            {visible.map((line, offset) => {
              const index = firstVisible + offset
              const inTrace = traceRange !== null && index >= traceRange.start && index <= traceRange.finish
              const base = line.startsWith('$ ') ? theme.cyan
                : line.startsWith('— ') ? theme.dim
                : inTrace ? theme.amber
                : theme.text
              const tokens = parseTuiLineTokens(clip(line, innerWidth), selected.cwd)
              const newline = offset < visible.length - 1 ? '\n' : ''
              return (
                <span key={index} fg={base} bg={inTrace ? theme.surface3 : undefined}>
                  {tokens.length === 0 ? ' ' : tokens.map((token, part) => token.kind === 'link'
                    ? <a key={part} href={token.url} fg={theme.cyan}>{token.text}</a>
                    : <span key={part}>{token.text}</span>)}
                  {newline}
                </span>
              )
            })}
          </text>
        )}
      </box>

      <text fg={theme.muted} wrapMode="none">{clip(configNote && !statusLine ? configNote : statusLine || ' ', innerWidth)}</text>
      {typing ? (
        <box paddingX={1} backgroundColor={theme.surface3} height={1}>
          <input focused={focused} value={draft} maxLength={500} placeholder="command to run" onInput={setDraft} onSubmit={submit} />
        </box>
      ) : (
        <box height={1} flexDirection="row" overflow="hidden">
          {fittedHints.map((action, index) => (
            <box
              key={`${action.key}:${action.label}`}
              flexDirection="row"
              onMouseDown={(event: TuiMouseEvent) => { if (event.button === 0) action.run?.() }}
            >
              {/* One text per entry: a row of texts drops each one's leading space. */}
              <text wrapMode="none">
                <span fg={theme.dim}>{index > 0 ? ' · ' : ''}</span>
                <span fg={action.run ? theme.cyan : theme.dim}>{action.key}</span>
                <span fg={theme.dim}>{` ${action.label}`}</span>
              </text>
            </box>
          ))}
        </box>
      )}
    </box>
  )
}
