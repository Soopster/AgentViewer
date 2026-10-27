/** @jsxImportSource @opentui/react */
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { KeyEvent } from '@opentui/core'
import type { RefObject } from 'react'
import type { CardDisplayData } from '../types'
import React from 'react'
import { type ResolvedPluginCommand } from '../../../../lib/plugins/catalog'
import { formatSessionTitle, type TuiTranscriptCard } from '../../../format'
import { interruptTuiSessionTurn } from '../../../../lib/tui/service'
import { transcriptWindowCommand } from '../../transcriptWindowInput'
import { type Session } from '../../../../lib/types'
import { chordUnknownKeyNotice, COMMAND_CHORD_MAP, type ChordMap } from '../../chordHelp'
import { PORTABLE_COMMAND_CHORDS, portableCommandChord } from '../../shortcutKeys'
import { type WindowItem, type PaneFocus, type NoticeTone } from '../types'
import { TASK_PANEL_RESIZE_STEP } from '../layoutConstants'
import { sessionKey } from '../sessionList'
import { type SplitPaneHandle } from '../SplitTranscriptPane'
import { TUI_KEYED_PLUGIN_COMMANDS } from '../pluginCommands'

/** Returns true when one of these branches handled the key. */
export function handleGlobalChordKeys({
  commandChordPending, windowControlsBlocked, handled, setCommandChordPending, key, isCtrl,
  showNotice, sequence, executeCommandPalette, setChordHelp, setSplitChordPending, isShifted,
  toggleFullscreenMode, focusedWindowSurface, popoverTabFocused, focusReaderFromSplit,
  windowSurfaceKeysRef, focusedWindowItem, composeToSplitPaneSession, openComposerWindow,
  selectedSessionKey, selectedInteractiveTranscriptCard, selectedInteractiveTranscriptCardDisplay,
  splitFocusIndex, effectiveFocus, splitPaneHandlesRef, searchMatches, fleetStripVisible,
  fleetPageCount, transcriptViewportRows, hasPrimaryFrame, velocityScrollStep, jumpToSearchMatch,
  jumpToMatchingCard, jumpToBookmark, visibleTabSessions, selectStripIndex, activeStripIndex,
  tabStripLength, setSearchMode, jumpToUnreadBoundary, jumpToResumeMarker, copySelectedMessage,
  replySelectedMessage, setThinkingMode, showToggleOutcome, openFocusedSplitPane, tabFromSplitPane,
  closeWindowSessionTab, openSplitPaneOverlay, openCoordinationBoard, splitPaneRunningKeys,
  requestExit, setComposerActive, pasteSystemClipboardToComposer, showRail, focusedPane,
  tabFromRail, setFocusedPane, isCtrlShift, openNewWorkflowModal, runPluginCommand,
  setAttentionOpen, jumpToNextAttention, fleetStripEnabled, setFleetStripEnabled, jumpToFleetEntry,
  setFleetPage, openHandoffBrief, setWorktreeDraft, setWorktreeModalOpen, openPromptLibrary,
  taskPanelOpen, setTaskPanelOpen, setTaskPanelTab, taskPanelTab, resizeTaskPanel,
  setTaskPanelExpanded, toggleComposerHidden, openBookmarksOverlay, selectedSession,
  setRenameSessionKey, setRenameDraft,
}: {
  commandChordPending: boolean
  windowControlsBlocked: boolean
  handled: (action: () => void) => void
  setCommandChordPending: React.Dispatch<React.SetStateAction<boolean>>
  key: KeyEvent
  isCtrl: (char: string) => boolean
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  sequence: string
  executeCommandPalette: (id: string) => void
  setChordHelp: React.Dispatch<React.SetStateAction<{ map: ChordMap; dismissOnKey: boolean; } | null>>
  setSplitChordPending: React.Dispatch<React.SetStateAction<boolean>>
  isShifted: (char: string) => boolean
  toggleFullscreenMode: (forced?: boolean) => void
  focusedWindowSurface: string | null
  popoverTabFocused: boolean
  focusReaderFromSplit: () => void
  windowSurfaceKeysRef: React.RefObject<Map<string, (key: { name: string; ctrl: boolean; shift: boolean; sequence: string; }) => unknown>>
  focusedWindowItem: WindowItem | null
  composeToSplitPaneSession: (target: Session) => void
  openComposerWindow: () => void
  selectedSessionKey: string | null
  selectedInteractiveTranscriptCard: TuiTranscriptCard | null
  selectedInteractiveTranscriptCardDisplay: CardDisplayData | null
  splitFocusIndex: number | null
  effectiveFocus: PaneFocus
  splitPaneHandlesRef: React.RefObject<Map<number, SplitPaneHandle>>
  searchMatches: number[]
  fleetStripVisible: boolean
  fleetPageCount: number
  transcriptViewportRows: number
  hasPrimaryFrame: boolean
  velocityScrollStep: (direction: -1 | 1) => number
  jumpToSearchMatch: (matchOffset: number) => void
  jumpToMatchingCard: (direction: -1 | 1, predicate: (card: TuiTranscriptCard) => boolean) => void
  jumpToBookmark: (direction: 1 | -1) => void
  visibleTabSessions: Session[]
  selectStripIndex: (index: number) => void
  activeStripIndex: number
  tabStripLength: number
  setSearchMode: React.Dispatch<React.SetStateAction<boolean>>
  jumpToUnreadBoundary: () => void
  jumpToResumeMarker: () => void
  copySelectedMessage: (cardOverride?: TuiTranscriptCard) => Promise<void>
  replySelectedMessage: (cardOverride?: TuiTranscriptCard) => void
  setThinkingMode: React.Dispatch<React.SetStateAction<boolean>>
  showToggleOutcome: (label: string, outcome: string | boolean) => void
  openFocusedSplitPane: () => void
  tabFromSplitPane: () => void
  closeWindowSessionTab: (session: Session) => void
  openSplitPaneOverlay: (kind: 'git' | 'diagnostics', target: Session | null) => void
  openCoordinationBoard: () => void
  splitPaneRunningKeys: Set<string>
  requestExit: () => void
  setComposerActive: React.Dispatch<React.SetStateAction<boolean>>
  pasteSystemClipboardToComposer: () => Promise<void>
  showRail: boolean
  focusedPane: PaneFocus
  tabFromRail: () => void
  setFocusedPane: React.Dispatch<React.SetStateAction<PaneFocus>>
  isCtrlShift: (char: string) => boolean
  openNewWorkflowModal: () => void
  runPluginCommand: (command: ResolvedPluginCommand, session?: Session | null) => void
  setAttentionOpen: React.Dispatch<React.SetStateAction<boolean>>
  jumpToNextAttention: () => void
  fleetStripEnabled: boolean
  setFleetStripEnabled: React.Dispatch<React.SetStateAction<boolean>>
  jumpToFleetEntry: (index: number) => void
  setFleetPage: React.Dispatch<React.SetStateAction<number>>
  openHandoffBrief: () => void
  setWorktreeDraft: React.Dispatch<React.SetStateAction<string>>
  setWorktreeModalOpen: React.Dispatch<React.SetStateAction<boolean>>
  openPromptLibrary: () => void
  taskPanelOpen: boolean
  setTaskPanelOpen: React.Dispatch<React.SetStateAction<boolean>>
  setTaskPanelTab: React.Dispatch<React.SetStateAction<'agents' | 'tasks'>>
  taskPanelTab: 'agents' | 'tasks'
  resizeTaskPanel: (delta: number) => void
  setTaskPanelExpanded: React.Dispatch<React.SetStateAction<boolean>>
  toggleComposerHidden: () => void
  openBookmarksOverlay: () => Promise<void>
  selectedSession: Session | null
  setRenameSessionKey: React.Dispatch<React.SetStateAction<string | null>>
  setRenameDraft: React.Dispatch<React.SetStateAction<string>>
}): boolean {
    // ── portable command chord ───────────────────────────────────────────────
    // Ctrl+Shift+letter is indistinguishable from Ctrl+letter in legacy raw
    // terminal input. Ctrl+K followed by a printable command key gives Windows
    // and other legacy terminals an unambiguous path to those same actions.
    if (commandChordPending && !windowControlsBlocked) {
      handled(() => {
        setCommandChordPending(false)
        if (key.name === 'escape' || isCtrl('c') || isCtrl('g')) {
          showNotice('info', 'Command chord cancelled')
          return
        }
        const chord = portableCommandChord(sequence || key.name)
        if (chord) {
          executeCommandPalette(PORTABLE_COMMAND_CHORDS[chord].command)
          return
        }
        if (sequence === '?') { setChordHelp({ map: COMMAND_CHORD_MAP, dismissOnKey: true }); return }
        showNotice('info', chordUnknownKeyNotice(COMMAND_CHORD_MAP, sequence || key.name))
      })
      return true
    }

    if (isCtrl('k')) {
      handled(() => {
        setSplitChordPending(false)
        setCommandChordPending(true)
      })
      return true
    }

    // ── tmux-style split chord ────────────────────────────────────────────────
    // Must sit at the very top of the non-composer path: the pending-chord
    // branch swallows the command key, and anything above it (notably the
    // q/Esc quit handler) would otherwise steal `x`, `o` or a cancelling Esc.
    if (isCtrl('b')) {
      handled(() => {
        setCommandChordPending(false)
        setSplitChordPending(true)
      })
      return true
    }

    // Shift+Z extends the existing z focus binding. This entry shortcut lives
    // outside the composer branch so a capital Z remains ordinary draft text.
    if (isShifted('Z')) {
      handled(() => toggleFullscreenMode())
      return true
    }

    // ── A focused surface window owns the keys ────────────────────────────────
    // After the ⌃B prefix, so ⌃B arrows still move between windows; Escape goes
    // back to the reader, as it does from a pane.
    if (focusedWindowSurface) {
      // A window hands Esc back to the reader; a popover tab is the reader's place, so its popover gets it.
      if (key.name === 'escape' && !popoverTabFocused) { handled(focusReaderFromSplit); return true }
      handled(() => { windowSurfaceKeysRef.current.get(focusedWindowSurface)?.(key) })
      return true
    }

    // ── Focused split pane owns the keys ──────────────────────────────────────
    // Splitting focuses the new pane. Keep the global composer shortcut
    // available there, addressing the session whose transcript owns focus.
    if (isCtrl('o') && focusedWindowItem?.kind === 'session') {
      handled(() => { composeToSplitPaneSession(focusedWindowItem.session); openComposerWindow() })
      return true
    }

    // A focused pane is a reader, not an editor: it scrolls, it opens, it hands
    // focus back. Everything else is swallowed rather than falling through to
    // the primary reader — a j that scrolled the pane must not also move the
    // reader's cursor behind it.
    // On the selected transcript's interactive diff card its keys come first, as
    // from the reader: they skip the window's own keys for the root's diff handling.
    const diffCardKey = focusedWindowItem?.kind === 'session' && sessionKey(focusedWindowItem.session) === selectedSessionKey
      && selectedInteractiveTranscriptCard?.category === 'diff' && Boolean(selectedInteractiveTranscriptCardDisplay?.diffView)
      && (['v', 'n', 'm', '{', '}', 'a', 'x', 'A'].includes(sequence)
        || (key.shift && (key.name === 'j' || key.name === 'k' || key.name === 'up' || key.name === 'down')))
    if (splitFocusIndex !== null && effectiveFocus === 'messages' && !diffCardKey) {
      const paneHandle = splitPaneHandlesRef.current.get(splitFocusIndex)
      const paneSession = paneHandle?.getSession() ?? null
      const command = transcriptWindowCommand(key, {
        selected: Boolean(paneSession && sessionKey(paneSession) === selectedSessionKey),
        hasSession: Boolean(paneSession), searchMatches: searchMatches.length > 0,
        fleetPaging: fleetStripVisible && fleetPageCount > 1,
        scrollback: paneHandle?.isScrollback() ?? false,
        pageRows: paneHandle?.pageRows() ?? 1,
        cardPageRows: Math.max(Math.floor(transcriptViewportRows * 0.8), 1),
        primaryFrame: hasPrimaryFrame, scrollStep: velocityScrollStep,
      })
      if (command) {
        handled(() => {
          if (command.type === 'scroll') paneHandle?.scrollByRows(command.rows)
          else if (command.type === 'moveCursor') paneHandle?.moveCursor(command.delta)
          else if (command.type === 'edge') paneHandle?.cursorToEdge(command.edge)
          else if (command.type === 'searchStep') jumpToSearchMatch(command.direction)
          else if (command.type === 'conversationJump') jumpToMatchingCard(command.direction, card => card.category === 'conversation')
          else if (command.type === 'technicalJump') jumpToMatchingCard(command.direction, card => card.category !== 'conversation')
          else if (command.type === 'bookmarkJump') jumpToBookmark(command.direction)
          else if (command.type === 'stripStep') {
            const from = paneSession ? visibleTabSessions.findIndex(tab => sessionKey(tab) === sessionKey(paneSession)) : -1
            selectStripIndex(Math.max(0, Math.min((from >= 0 ? from : activeStripIndex) + command.direction, tabStripLength - 1)))
          } else if (command.type === 'action') {
            switch (command.action) {
              case 'search': setSearchMode(true); break
              case 'unread': jumpToUnreadBoundary(); break
              case 'resume': jumpToResumeMarker(); break
              case 'focusReader': focusReaderFromSplit(); break
              case 'toggleAll': paneHandle?.toggleScrollbackAll(); break
              case 'toggleExpanded': paneHandle?.toggleExpandedAtCursor(); break
              case 'copy': void copySelectedMessage(paneHandle?.getCursorCard() ?? undefined); break
              case 'bookmark':
                void paneHandle?.toggleBookmarkAtCursor().then(added => showNotice('info', added ? 'Bookmarked message' : 'Removed bookmark'))
                  .catch(err => showNotice('error', err instanceof Error ? err.message : 'Failed to update bookmark'))
                break
              case 'reply': if (paneSession) composeToSplitPaneSession(paneSession); replySelectedMessage(paneHandle?.getCursorCard() ?? undefined); break
              case 'compose': if (paneSession) composeToSplitPaneSession(paneSession); break
              case 'thinking': setThinkingMode(current => { const next = !current; showToggleOutcome('Thinking mode', next); return next }); break
              case 'open': openFocusedSplitPane(); break
              case 'tab': tabFromSplitPane(); break
              case 'close': if (paneSession) closeWindowSessionTab(paneSession); break
              case 'git': openSplitPaneOverlay('git', paneSession); break
              case 'diagnostics': openSplitPaneOverlay('diagnostics', paneSession); break
              case 'coordination': openCoordinationBoard(); break
              case 'interrupt':
                if (paneSession && splitPaneRunningKeys.has(sessionKey(paneSession)) && !paneSession.isPending) {
                  void interruptTuiSessionTurn(paneSession)
                    .then(() => showNotice('info', `Interrupted ${formatSessionTitle(paneSession)}`))
                    .catch(err => showNotice('error', err instanceof Error ? err.message : 'Failed to interrupt'))
                } else requestExit()
                break
              case 'swallow': break
            }
          }
        })
        return true
      }
    }

    if (isCtrl('v')) {
      handled(() => {
        setComposerActive(true)
        void pasteSystemClipboardToComposer()
      })
      return true
    }

    if (isCtrl('o')) {
      handled(openComposerWindow)
      return true
    }

    if ((key.name === 'q' && !key.shift) || key.name === 'escape' || isCtrl('c')) {
      handled(requestExit)
      return true
    }

    if (key.name === 'tab' && showRail) {
      handled(() => {
        if (focusedPane === 'sessions') tabFromRail()
        else setFocusedPane('sessions')
      })
      return true
    }


    // New coordinated workflow, reachable from anywhere — mirrors plain N
    // (new single-agent session) without requiring a trip through the board.
    if (isCtrlShift('n')) {
      handled(openNewWorkflowModal)
      return true
    }

    // Plugin commands' own bindings (a manifest's `tuiKey`), at global precedence.
    // A shifted letter is matched as the host's own ⇧ bindings are (isShiftedKey), so
    // terminals that report `M` rather than shift+`m` still reach it.
    const pluginChord = TUI_KEYED_PLUGIN_COMMANDS.find(({ tuiKey }) => tuiKey.ctrl
      ? (tuiKey.shift ? isCtrlShift(tuiKey.name) : isCtrl(tuiKey.name))
      : !key.ctrl && !key.meta && (tuiKey.shift ? isShifted(tuiKey.name) : key.name === tuiKey.name && !key.shift))
    if (pluginChord) {
      handled(() => runPluginCommand(pluginChord))
      return true
    }

    // Global attention inbox — everything blocked on a human, across sessions
    if (sequence === '!') {
      handled(() => setAttentionOpen(true))
      return true
    }

    // Jump to the next session that needs a human (prompt first, then done)
    if (isCtrl('n')) {
      handled(jumpToNextAttention)
      return true
    }

    // Fleet strip: ⇧A toggles, digits 1-9 jump to a cell, and shifted
    // brackets page through overflow without changing the one-row budget.
    if (isShifted('A')) {
      handled(() => {
        const next = !fleetStripEnabled
        setFleetStripEnabled(next)
        showToggleOutcome('Fleet strip', next)
      })
      return true
    }
    const fleetDigit = /^[1-9]$/.test(sequence)
      ? sequence
      : /^[1-9]$/.test(key.name) ? key.name : null
    if (fleetStripVisible && fleetDigit && !key.ctrl && !key.meta && !key.option) {
      handled(() => jumpToFleetEntry(Number(fleetDigit) - 1))
      return true
    }
    if (
      fleetStripVisible
      && fleetPageCount > 1
      && (sequence === '{' || sequence === '}' || isShifted('[') || isShifted(']'))
    ) {
      handled(() => setFleetPage((current) => {
        const delta = sequence === '{' || isShifted('[') ? -1 : 1
        return (current + delta + fleetPageCount) % fleetPageCount
      }))
      return true
    }

    // Global handoff brief popover
    if (isShifted('H')) {
      handled(openHandoffBrief)
      return true
    }

    // Worktree task orchestration: ⇧F forks the repo state into an isolated
    // worktree task; merge/discard live in the command palette.
    if (isShifted('F')) {
      handled(() => {
        setWorktreeDraft('')
        setWorktreeModalOpen(true)
      })
      return true
    }

    // Global prompt library — saved prompts usable across providers
    if (isShifted('P')) {
      handled(openPromptLibrary)
      return true
    }

    // Global task panel toggle — cycles: closed → tasks → agents → closed
    if (isShifted('T')) {
      handled(() => {
        if (!taskPanelOpen) {
          setTaskPanelOpen(true)
          setTaskPanelTab('tasks')
        } else if (taskPanelTab === 'tasks') {
          setTaskPanelTab('agents')
        } else {
          setTaskPanelOpen(false)
        }
      })
      return true
    }

    // Task panel resize (only when open)
    if (taskPanelOpen && (sequence === '_' || sequence === '-')) {
      handled(() => resizeTaskPanel(-TASK_PANEL_RESIZE_STEP))
      return true
    }
    if (taskPanelOpen && sequence === '+') {
      handled(() => resizeTaskPanel(TASK_PANEL_RESIZE_STEP))
      return true
    }
    if (taskPanelOpen && sequence === '=') {
      handled(() => setTaskPanelExpanded((current) => !current))
      return true
    }

    // Show/hide composer
    if (isShifted('E')) {
      handled(toggleComposerHidden)
      return true
    }

    // Global bookmarks browser (cross-session)
    if (isShifted('B')) {
      handled(() => { void openBookmarksOverlay() })
      return true
    }

    if (showRail && isCtrl('r') && selectedSession) {
      handled(() => {
        setRenameSessionKey(sessionKey(selectedSession))
        setRenameDraft(formatSessionTitle(selectedSession))
      })
      return true
    }
  return false
}
