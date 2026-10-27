/** @jsxImportSource @opentui/react */
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { CliRenderer } from '@opentui/core'
import React from 'react'
import { type TuiDensity, type TuiThemeMode } from '../../../theme'
import { readTuiSessionDiagnostics, runTuiSessionAction } from '../../../../lib/tui/service'
import { type SelectionAskInput } from '../../../../lib/selectionAsk'
import { type ProtocolAgent, type ProtocolRunSnapshot } from '../../../../lib/agentProtocol'
import { readTuiSubagentTranscriptAsync } from '../../sessionDetailWorkerClient'
import { type Session, type SubagentSummary } from '../../../../lib/types'
import { type NoticeTone } from '../types'
import { isLightThemeMode } from '../themes'
import { writeClipboard, readClipboardText } from '../clipboard'

export type PluginServicesContext = {
  subagentTranscriptSelection: { parent: Session; agent: SubagentSummary; } | null
  density: TuiDensity
  appendDiffCommentPromptToComposer: (prompt: string, trailing?: string) => void
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  askAgentAboutSelection: (input: SelectionAskInput) => Promise<void>
  insertComposerTextAtCursor: (textToInsert: string) => void
  setComposerActive: React.Dispatch<React.SetStateAction<boolean>>
  setSurfacePanelFocused: React.Dispatch<React.SetStateAction<boolean>>
  renderer: CliRenderer
  openEditorAt: (path: string | null, line: number | null) => void
  surfaceBrowserRecent: string[]
  setSurfaceBrowserRecent: React.Dispatch<React.SetStateAction<string[]>>
  gitRepoCwd: string
  openFileHistory: (path: string, where?: 'overlay' | 'window') => void
  velocityScrollEnabled: boolean
  toggleVelocityScroll: () => void
  coordBoardRunId: string | null
  openCoordinationAgentSession: (agent: ProtocolAgent) => void
  watchCoordinationAgentSessions: (agents: ProtocolAgent[]) => void
  watchCoordinatorRun: (snapshot: ProtocolRunSnapshot) => void
  newCoordinationRun: () => void
  copyCoordinationJoinCommand: (runId: string) => void
  themeMode: TuiThemeMode
  choosePluginTheme: (mode: TuiThemeMode) => void
  jumpToTaskCard: (uuid: string) => void
  composerCanStopTasks: boolean
  stopComposerTask: (taskId: string) => Promise<void>
  canUseChannelBridge: boolean
  routeComposerToBridge: boolean
  toggleComposerBridgeRoute: () => void
  composerAccentColor: string
  canUseIdeBridge: boolean
  routeComposerToIde: boolean
  toggleComposerIdeRoute: () => void
  insertComposerPromptText: (text: string) => void
}

export function runPluginServices(ctx: PluginServicesContext) {
  const {
    subagentTranscriptSelection, density, appendDiffCommentPromptToComposer, showNotice,
    askAgentAboutSelection, insertComposerTextAtCursor, setComposerActive, setSurfacePanelFocused,
    renderer, openEditorAt, surfaceBrowserRecent, setSurfaceBrowserRecent, gitRepoCwd,
    openFileHistory, velocityScrollEnabled, toggleVelocityScroll, coordBoardRunId,
    openCoordinationAgentSession, watchCoordinationAgentSessions, watchCoordinatorRun,
    newCoordinationRun, copyCoordinationJoinCommand, themeMode, choosePluginTheme, jumpToTaskCard,
    composerCanStopTasks, stopComposerTask, canUseChannelBridge, routeComposerToBridge,
    toggleComposerBridgeRoute, composerAccentColor, canUseIdeBridge, routeComposerToIde,
    toggleComposerIdeRoute, insertComposerPromptText,
  } = ctx
return ({
  ...(subagentTranscriptSelection ? { 'subagent-transcript': {
    label: subagentTranscriptSelection.agent.taskDescription || subagentTranscriptSelection.agent.agentId,
    agentId: subagentTranscriptSelection.agent.agentId,
    load: (signal: AbortSignal) => readTuiSubagentTranscriptAsync(subagentTranscriptSelection.parent, subagentTranscriptSelection.agent.agentId, density, signal),
  } } : {}),
  composer: {
    appendDiffNote: (prompt: string, notice?: string) => {
      appendDiffCommentPromptToComposer(prompt)
      showNotice('info', notice ?? 'Diff comment added to composer')
    },
    askAboutSelection: (request: SelectionAskInput) => { void askAgentAboutSelection(request) },
    insertText: (text: string, notice?: string) => {
      insertComposerTextAtCursor(text)
      setComposerActive(true)
      showNotice('info', notice ?? 'Added to composer')
    },
    appendPrompt: (prompt: string, notice: string) => {
      appendDiffCommentPromptToComposer(prompt)
      setSurfacePanelFocused(false)
      showNotice('info', notice)
    },
  },
  clipboard: { write: (text: string) => writeClipboard(text, renderer), read: readClipboardText },
  'open-file': { open: (path: string, line?: number | null) => openEditorAt(path, line ?? null) },
  notices: { show: (kind: 'info' | 'error', text: string, durationMs?: number) => showNotice(kind, text, durationMs) },
  'browser-location': {
    recent: surfaceBrowserRecent,
    opened: (url: string) => setSurfaceBrowserRecent((current) => [url, ...current.filter((entry) => entry !== url)].slice(0, 12)),
  },
  ...(gitRepoCwd ? { 'file-history': { open: (path: string, where?: 'overlay' | 'window') => openFileHistory(path, where) } } : {}),
  'scroll-preferences': { velocity: velocityScrollEnabled, toggleVelocity: toggleVelocityScroll },
  coordination: {
    initialRunId: coordBoardRunId,
    openAgentSession: openCoordinationAgentSession,
    watchAgentSessions: watchCoordinationAgentSessions,
    watchRun: watchCoordinatorRun,
    newRun: newCoordinationRun,
    copyJoinCommand: copyCoordinationJoinCommand,
  },
  themes: { mode: themeMode, light: isLightThemeMode(themeMode), choose: choosePluginTheme },
  'task-control': {
    jumpTo: jumpToTaskCard,
    ...(composerCanStopTasks ? { stop: (taskId: string) => { void stopComposerTask(taskId) } } : {}),
  },
  'session-diagnostics': {
    read: async (session: Session) => (await readTuiSessionDiagnostics(session)).sections ?? [],
    run: (session: Session, action: string, extra: Record<string, unknown>) => runTuiSessionAction(session, { action, ...extra }),
    hasControls: (session: Session) => session.provider === 'claude',
  },
  // The bridges are offered only while a Claude session can use one (pluginServiceGaps says so otherwise).
  ...(canUseChannelBridge ? { 'channel-bridge': { routed: routeComposerToBridge, toggleRoute: toggleComposerBridgeRoute, accentColor: composerAccentColor } } : {}),
  ...(canUseIdeBridge ? { 'ide-bridge': { routed: routeComposerToIde, toggleRoute: toggleComposerIdeRoute, accentColor: composerAccentColor, sendComment: (text: string) => insertComposerPromptText(text) } } : {}),
// The callbacks are the root's stable events and setters.
// eslint-disable-next-line react-hooks/exhaustive-deps
})
}
