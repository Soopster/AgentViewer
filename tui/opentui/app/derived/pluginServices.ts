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
import { type SessionDiagnosticSection } from '../../../../lib/types'
import { type TuiTranscriptCard } from '../../../format'
import { type TuiSessionDetail } from '../../../../lib/tui/service'
import { type AttentionItem } from '../../AttentionInboxPopover'
import { type PaneFocus } from '../types'
import { sessionKey } from '../sessionList'

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

export type FleetPluginServicesContext = {
  fleetViewShown: boolean
  pluginServices: { 'ide-bridge'?: { routed: boolean; toggleRoute: () => void; accentColor: string; sendComment: (text: string) => void; } | undefined; 'channel-bridge'?: { routed: boolean; toggleRoute: () => void; accentColor: string; } | undefined; 'scroll-preferences': { velocity: boolean; toggleVelocity: () => void; }; coordination: { initialRunId: string | null; openAgentSession: (agent: ProtocolAgent) => void; watchAgentSessions: (agents: ProtocolAgent[]) => void; watchRun: (snapshot: ProtocolRunSnapshot) => void; newRun: () => void; copyJoinCommand: (runId: string) => void; }; themes: { mode: TuiThemeMode; light: boolean; choose: (mode: TuiThemeMode) => void; }; 'task-control': { stop?: ((taskId: string) => void) | undefined; jumpTo: (uuid: string) => void; }; 'session-diagnostics': { read: (session: Session) => Promise<SessionDiagnosticSection[]>; run: (session: Session, action: string, extra: Record<string, unknown>) => Promise<Record<string, unknown>>; hasControls: (session: Session) => boolean; }; 'file-history'?: { open: (path: string, where?: 'overlay' | 'window') => void; } | undefined; composer: { appendDiffNote: (prompt: string, notice?: string) => void; askAboutSelection: (request: SelectionAskInput) => void; insertText: (text: string, notice?: string) => void; appendPrompt: (prompt: string, notice: string) => void; }; clipboard: { write: (text: string) => Promise<void>; read: () => Promise<string>; }; 'open-file': { open: (path: string, line?: number | null) => void; }; notices: { show: (kind: 'info' | 'error', text: string, durationMs?: number) => void; }; 'browser-location': { recent: string[]; opened: (url: string) => void; }; 'subagent-transcript'?: { label: string; agentId: string; load: (signal: AbortSignal) => Promise<TuiTranscriptCard[]>; } | undefined; }
  sessions: Session[]
  sidebarSessionActivity: Map<string, 'needs-input' | 'running' | 'waiting'>
  fleetAlerts: { key: string; sessionKey: string; provider: 'claude' | 'acp' | 'codex' | 'opencode' | 'copilot' | 'pi' | 'lmstudio' | 'claude-acp' | 'codex-acp'; sessionTitle: string; title: string; detail: string | undefined; needsInput: boolean; createdAt: number; }[]
  selectedSession: Session | null
  fleetDetailOwned: boolean
  transcriptCards: TuiTranscriptCard[]
  sessionDetail: TuiSessionDetail | null
  selectTabSession: (session: Session) => void
  setFocusedPane: React.Dispatch<React.SetStateAction<PaneFocus>>
  attentionItems: AttentionItem[]
  openAttentionSession: (item: AttentionItem) => void
}

export function runFleetPluginServices(ctx: FleetPluginServicesContext) {
  const {
    fleetViewShown, pluginServices, sessions, sidebarSessionActivity, fleetAlerts, selectedSession,
    fleetDetailOwned, transcriptCards, sessionDetail, selectTabSession, setFocusedPane,
    attentionItems, openAttentionSession,
  } = ctx
return (fleetViewShown ? {
  ...pluginServices,
  'session-fleet': {
    sessions,
    activity: sidebarSessionActivity,
    alerts: fleetAlerts,
    selected: selectedSession,
    // The selected session's transcript counts only once the detail on screen is that session's.
    selectedCards: fleetDetailOwned ? transcriptCards : null,
    selectedContext: fleetDetailOwned ? sessionDetail?.contextUsage ?? null : null,
    selectedModel: fleetDetailOwned ? sessionDetail?.info?.currentModel ?? null : null,
    selectedMessageCount: fleetDetailOwned ? sessionDetail?.rawMessages.length ?? null : null,
    select: (session: Session) => selectTabSession(session),
    open: (session: Session) => {
      selectTabSession(session)
      setFocusedPane('messages')
    },
    openAlert: (alertKey: string) => {
      const item = attentionItems.find((candidate) => candidate.key === alertKey)
      if (!item) return false
      openAttentionSession(item)
      return true
    },
  },
} : pluginServices)
}
