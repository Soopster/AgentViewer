'use client'

import { DashboardViews, DashboardView } from '@/components/shell/DashboardViews'
import { ReaderPane, ReaderPaneCollapseButton, CollapsedReaderPane } from '@/components/shell/ReaderPane'
import { PanelPluginSurface } from '@/components/shell/PanelPluginSurface'
import { panelSurfaceTitle } from '@/components/right-panel/presentation'
import { RightPanelContent } from '@/components/right-panel/RightPanelContent'
import { useSessionCreation } from '@/components/session-creation/useSessionCreation'
import { sessionCreationTarget } from '@/components/session-creation/target'
import { useViewerNavigation } from '@/components/viewer-navigation/useViewerNavigation'
import { RUN_DASHBOARD_KEY, materializeSessionList } from '@/components/viewer-navigation/model'
import { useReaderPresentation } from '@/components/shell/useReaderPresentation'
import { useShellShortcuts } from '@/components/shell/useShellShortcuts'
import { useDocumentVisible } from '@/components/shell/useDocumentVisible'
import { useTeamAttention } from '@/components/shell/useTeamAttention'
import { useProviderSelection } from '@/components/provider-selection/useProviderSelection'
import { useSessionTranscript } from '@/components/session-reader/useSessionTranscript'
import { useProjectTranscript } from '@/components/session-reader/useProjectTranscript'
import { createSessionMetadataCallbacks, createSessionDeleteCallback, patchSessionList, removeSessionFromList, type SessionMetadataPatch } from '@/components/session-catalog/actions'
import { type SessionIdentity } from '@/lib/sessionIdentity'
import { useSessionCatalog } from '@/components/session-catalog/useSessionCatalog'
import { useSessionCatalogQuery } from '@/components/session-catalog/useSessionCatalogQuery'

import { panelSurfaceAvailability } from '@/lib/rightPanel'


import { useState, useEffect, useRef, useCallback, useMemo, startTransition, ViewTransition } from 'react'
import dynamic from 'next/dynamic'
import SessionList from '@/components/SessionList'
import MessageView from '@/components/MessageView'
import { CodeThemeProvider } from '@/components/CodeThemeContext'
import { Sidebar, SidebarProvider } from '@/components/ui/sidebar'
import { pathBasename } from '@/lib/projectPaths'
import { startClientPerf } from '@/lib/clientPerf'
import type { ProviderSelection, Session } from '@/lib/types'
import { useRightPanel } from '@/components/useRightPanel'
import { type RightPanelSurfaceKind } from '@/lib/rightPanel'
import { getPluginCommand, getPluginSurface, isPluginSurfaceId, type PluginSurfaceId } from '@/lib/plugins/catalog'
import { dispatchPluginCommand, subscribePluginCommands } from '@/lib/plugins/commandBus'
import type { WebPluginServices } from '@/components/shell/pluginTypes'
import { isPluginEnabled } from '@/lib/plugins/enablement'
import { usePluginSettingsSync } from '@/components/shell/usePluginSettingsSync'

const CommandPalette = dynamic(() => import('@/components/CommandPalette'), { ssr: false })
const PluginSurfaceHost = dynamic(() => import('@/components/shell/PluginSurfaceHost'), { ssr: false })
const BookmarksPanel = dynamic(() => import('@/components/BookmarksPanel'), { ssr: false })
const ProvenancePopover = dynamic(() => import('@/components/ProvenancePopover'), { ssr: false })
const PluginManager = dynamic(() => import('@/components/shell/PluginManager'), { ssr: false })
const RemoteAccessPopover = dynamic(() => import('@/components/RemoteAccessPopover'), { ssr: false })
const RunDashboard = dynamic(() => import('@/components/RunDashboard'), { ssr: false })
const CrossSessionMessaging = dynamic(() => import('@/components/cross-session-messaging/CrossSessionMessaging'), { ssr: false })
const PiActivityPopover = dynamic(() => import('@/components/PiActivityPopover'), { ssr: false })
const RightPanel = dynamic(() => import('@/components/RightPanel'), { ssr: false })

type SessionScopeMode = 'all' | 'project'
type ComposerInsertRequest = {
  requestId: number
  text: string
}

export default function Home() {
  const {
    sessions, loading: catalogLoading, error: catalogError,
    load: loadCatalog, cancel: cancelCatalog, update: updateCatalog, refresh: fetchSessions,
  } = useSessionCatalog()
  const {
    provider, providerInstanceId, instances: providerInstances, ready: providerReady,
    switching: switchingProvider, error: providerError, adopt: adoptProvider, select: selectProvider, currentTarget: currentProviderTarget,
  } = useProviderSelection()
  const loadingSessions = !providerReady || catalogLoading
  const {
    creating: creatingNewSession, error: sessionsError, clearError: clearCreationError, create: createSession,
  } = useSessionCreation()
  const [sessionScope, setSessionScope] = useState<SessionScopeMode>('all')
  const {
    selectedSession, openTabSessions, selectedTabKey, selectedProject, targetMessage, dashboardTab,
    sessionListScrollRequest, empty: navigationEmpty,
    openSession: navigateSession, openProject: navigateProject, openDashboard: navigateDashboard,
    setDashboardTab, scrollToSession: scrollSessionListToSession, closeTab: closeNavigationTab,
    clear: clearNavigation, updateProjectSessions, patch: patchNavigation, remove: removeNavigation,
    materialize: materializeNavigation, addTab: addNavigationTab,
    isActiveTab, isCurrentSession, isDashboardContext, isEmpty: navigationIsEmpty, currentProjectDir, currentSession, captureIntent, invalidateIntent,
  } = useViewerNavigation({ sessions, provider, scope: sessionScope })
  const [includeWorktrees, setIncludeWorktrees] = useState(true)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  // A repository-pinned plugin surface (Git) open as an overlay on the active project.
  const [repositoryOverlay, setRepositoryOverlay] = useState<PluginSurfaceId | null>(null)
  const [composerInsertRequest, setComposerInsertRequest] = useState<ComposerInsertRequest | null>(null)
  const composerInsertRequestRef = useRef(0)
  const [bookmarksPanelOpen, setBookmarksPanelOpen] = useState(false)
  const [provenanceOpen, setProvenanceOpen] = useState(false)
  const [remoteAccessOpen, setRemoteAccessOpen] = useState(false)
  const [pluginManagerOpen, setPluginManagerOpen] = useState(false)
  usePluginSettingsSync()
  const rightPanel = useRightPanel()
  const [taskPanelOpenRequest, setTaskPanelOpenRequest] = useState(0)
  const [promptLibraryOpenRequest, setPromptLibraryOpenRequest] = useState(0)
  const [channelBridgeOpenRequest, setChannelBridgeOpenRequest] = useState(0)
  const [channelBridgeRouteToggleRequest, setChannelBridgeRouteToggleRequest] = useState(0)
  const [channelBridgeRouting, setChannelBridgeRouting] = useState(false)
  const [ideBridgeOpenRequest, setIdeBridgeOpenRequest] = useState(0)
  const [ideBridgeRouteToggleRequest, setIdeBridgeRouteToggleRequest] = useState(0)
  const [ideBridgeRouting, setIdeBridgeRouting] = useState(false)
  const documentVisible = useDocumentVisible()
  const {
    messages: sessionMessages, loading: loadingSessionMessages,
    externalWriter: codexExternalWriter, todos: openCodeTodosForView, plan: codexPlanForView,
    load: loadSessionTranscript, clear: clearSessionTranscript,
  } = useSessionTranscript({ session: selectedProject ? null : selectedSession, visible: documentVisible })
  const {
    messages: projectMessages, loading: loadingProjectMessages,
    load: loadProjectTranscript, clear: clearProjectTranscript,
  } = useProjectTranscript({
    dir: selectedProject?.dir ?? null, provider, providerInstanceId, includeWorktrees,
    visible: documentVisible, onSessions: updateProjectSessions,
  })
  const messages = selectedProject ? projectMessages : sessionMessages
  const loadingMessages = selectedProject ? loadingProjectMessages : loadingSessionMessages
  const clearTranscripts = useCallback(() => {
    clearSessionTranscript()
    clearProjectTranscript()
  }, [clearSessionTranscript, clearProjectTranscript])
  const activeProjectDir = selectedProject?.dir ?? selectedSession?.cwd ?? null
  const activeProjectName = selectedProject?.key ?? (pathBasename(activeProjectDir) || null)
  const dashboardSelected = selectedTabKey === RUN_DASHBOARD_KEY && !selectedProject
  const messageAreaKey = dashboardSelected ? RUN_DASHBOARD_KEY : 'reader'
  // Bundle the projectView prop so it only gets a new identity when one of
  // its fields actually changes — otherwise <MessageView /> sees a new object
  // on every parent render.
  const projectViewProp = useMemo(
    () => (selectedProject
      ? {
          key: selectedProject.key,
          sessionCount: selectedProject.sessions.length,
          providerMode: (provider === 'all' ? 'all' : 'current') as 'all' | 'current',
        }
      : undefined),
    [provider, selectedProject],
  )
  const canUseChannelBridge = !selectedProject && !!selectedSession && (selectedSession.provider ?? 'claude') === 'claude'
  const canUseIdeBridge = canUseChannelBridge
  const canMaximizeMessageView = !dashboardSelected && !selectedProject && !!selectedSession
  const {
    paneCollapsed: messagePaneCollapsed, maximized: isMessageViewMaximized, fullscreen: messageViewFullscreen,
    togglePane: toggleMessagePane, toggleMaximized: toggleMessageViewMaximized, enterFullscreen: enterMessageViewFullscreen,
  } = useReaderPresentation(canMaximizeMessageView)

  const openGitPopover = useCallback(() => { dispatchPluginCommand('git') }, [])
  // Commands whose surface is pinned to a repository open on the active project;
  // session-pinned ones are the message view's.
  useEffect(() => subscribePluginCommands((commandId) => {
    const command = getPluginCommand(commandId)
    if (!command || !command.renderers.includes('web') || !isPluginSurfaceId(command.opens)) return false
    if (getPluginSurface(command.opens).pin !== 'cwd' || !activeProjectDir || !isPluginEnabled(command.pluginId)) return false
    setRepositoryOverlay(command.opens)
    return true
  }), [activeProjectDir])



  const consumeComposerInsertRequest = useCallback((requestId: number) => {
    setComposerInsertRequest((current) => current?.requestId === requestId ? null : current)
  }, [])

  const insertFilePathToComposer = useCallback((path: string) => {
    composerInsertRequestRef.current += 1
    setComposerInsertRequest({
      requestId: composerInsertRequestRef.current,
      text: `@${path} `,
    })
  }, [])

  const openRunDashboard = useCallback(() => {
    clearCreationError()
    clearProjectTranscript()
    navigateDashboard('sessions')
  }, [clearCreationError, clearProjectTranscript, navigateDashboard])

  const openCommandPalette = useCallback(() => setCommandPaletteOpen(true), [])
  const openCoordinator = useCallback(() => {
    clearCreationError()
    clearProjectTranscript()
    navigateDashboard('agents')
  }, [clearCreationError, clearProjectTranscript, navigateDashboard])

  const openCrossSessionMessaging = useCallback(() => {
    clearCreationError()
    clearProjectTranscript()
    navigateDashboard('messaging')
  }, [clearCreationError, clearProjectTranscript, navigateDashboard])

  const openTaskPanel = useCallback(() => setTaskPanelOpenRequest((value) => value + 1), [])
  const openPromptLibrary = useCallback(() => setPromptLibraryOpenRequest((value) => value + 1), [])
  const openChannelBridge = useCallback(() => setChannelBridgeOpenRequest((value) => value + 1), [])
  const toggleChannelBridgeRoute = useCallback(() => setChannelBridgeRouteToggleRequest((value) => value + 1), [])
  const openIdeBridge = useCallback(() => setIdeBridgeOpenRequest((value) => value + 1), [])
  const toggleIdeBridgeRoute = useCallback(() => setIdeBridgeRouteToggleRequest((value) => value + 1), [])

  const catalogProjectDir = sessionScope === 'project' ? activeProjectDir : null
  const catalogIncludesWorktrees = catalogProjectDir ? includeWorktrees : true
  const catalogQuery = useMemo(() => ({
    provider, providerInstanceId, projectDir: catalogProjectDir, includeWorktrees: catalogIncludesWorktrees,
  }), [provider, providerInstanceId, catalogProjectDir, catalogIncludesWorktrees])
  useSessionCatalogQuery({ query: catalogQuery, enabled: providerReady, visible: documentVisible,
    load: loadCatalog, cancel: cancelCatalog })

  const insertTextToComposer = useCallback((text: string) => {
    composerInsertRequestRef.current += 1
    setComposerInsertRequest({ requestId: composerInsertRequestRef.current, text })
  }, [])
  // Links a pull request to the selected session, which then settles itself when the PR merges.
  const linkPullRequestToSession = useCallback((pr: { repo: string; number: number; url: string; cwd: string }) => {
    const target = selectedSession
    if (!target) return
    void fetch(`/api/sessions/${encodeURIComponent(target.sessionId)}/inbox`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'link-pr',
        provider: target.provider,
        providerInstanceId: target.providerInstanceId,
        linkedPr: pr,
      }),
    }).then(() => { void fetchSessions() }).catch(() => {})
  }, [selectedSession, fetchSessions])
  // What a repository-pinned plugin surface (Git, Files, pull requests) is given on the active project.
  const liveSession = selectedSession && !selectedSession.isPending ? selectedSession : null
  const linkedPrNumber = selectedSession?.inbox?.linkedPr?.number
  const repositoryServices = useMemo<WebPluginServices | null>(() => (activeProjectDir ? {
    repository: { cwd: activeProjectDir, sessionId: liveSession?.sessionId ?? null, provider: liveSession?.provider ?? null },
    // A question for the agent always has a composer to go to; a file path only a session's.
    composer: { insertText: insertTextToComposer, ...(!selectedProject && selectedSession ? { insertPath: insertFilePathToComposer } : {}) },
    'session-pull-request': { linkedNumber: linkedPrNumber, ...(selectedSession ? { link: linkPullRequestToSession } : {}) },
  } : null), [activeProjectDir, liveSession?.sessionId, liveSession?.provider, selectedProject, selectedSession, insertFilePathToComposer, insertTextToComposer, linkedPrNumber, linkPullRequestToSession])

  // Opt-in client perf monitor (?perf=1 or localStorage 'agentviewer:perf'=1).
  useEffect(() => startClientPerf(), [])
  const toggleCommandPalette = useCallback(() => setCommandPaletteOpen(previous => !previous), [])
  useShellShortcuts({
    repositoryAvailable: !!activeProjectDir,
    onToggleRightPanel: rightPanel.toggle,
    onToggleCommandPalette: toggleCommandPalette,
  })
  const teamAttention = useTeamAttention(documentVisible)

  useEffect(() => {
    if (sessionScope === 'project' && !activeProjectDir && !currentProjectDir()) setSessionScope('all')
  }, [activeProjectDir, sessionScope, currentProjectDir])
  useEffect(() => {
    if (navigationEmpty && navigationIsEmpty()) clearTranscripts()
  }, [navigationEmpty, navigationIsEmpty, clearTranscripts])

  const selectSession = useCallback(async (session: Session, nextTargetMessageId?: string) => {
    clearCreationError()
    const nextProvider = session.provider ?? 'claude'
    const nextProviderInstanceId = session.providerInstanceId ?? nextProvider
    adoptProvider(nextProvider, nextProviderInstanceId)
    if (nextProvider !== provider || nextProviderInstanceId !== providerInstanceId) {
      setSessionScope('all')
    }
    startTransition(() => navigateSession(session, nextTargetMessageId))
    clearProjectTranscript()
    await loadSessionTranscript(session, nextTargetMessageId)
  }, [clearCreationError, adoptProvider, clearProjectTranscript, loadSessionTranscript, provider, providerInstanceId, navigateSession])

  const selectOpenTab = useCallback((session: Session) => {
    scrollSessionListToSession(session)
    void selectSession(session)
  }, [scrollSessionListToSession, selectSession])

  const selectCommandPaletteSession = useCallback((session: Session, nextTargetMessageId?: string) => {
    scrollSessionListToSession(session)
    void selectSession(session, nextTargetMessageId)
  }, [scrollSessionListToSession, selectSession])

  const closeTab = useCallback((sessionKey: string) => {
    const { wasActive, adjacent } = closeNavigationTab(sessionKey)
    if (!wasActive) return
    clearCreationError()
    if (adjacent) void selectSession(adjacent)
    else clearTranscripts()
  }, [closeNavigationTab, clearCreationError, clearTranscripts, selectSession])

  const selectProject = useCallback(async (projectDir: string, projectName: string, projectSessions: Session[]) => {
    clearCreationError()
    startTransition(() => navigateProject({ key: projectName, dir: projectDir, sessions: projectSessions }))
    clearSessionTranscript()
    const loaded = await loadProjectTranscript(projectDir)
    if (loaded) updateProjectSessions(projectDir, loaded)
  }, [clearCreationError, navigateProject, clearSessionTranscript, loadProjectTranscript, updateProjectSessions])

  const applySessionMetadata = useCallback((target: SessionIdentity, patch: SessionMetadataPatch) => {
    const update = (previous: Session[]) => patchSessionList(previous, target, patch)
    updateCatalog(update, target)
    patchNavigation(target, patch)
  }, [updateCatalog, patchNavigation])
  const { onRename: handleRename, onTag: handleTag } = useMemo(
    () => createSessionMetadataCallbacks(applySessionMetadata), [applySessionMetadata],
  )

  // A background materialization updates its copies without stealing focus.
  const handleFork = useCallback((newSessionId: string, sourceSession: Session | null = selectedSession) => {
    if (!sourceSession?.provider) return
    const follow = isCurrentSession(sourceSession)
    if (sourceSession.isPending) {
      const materialized: Session = { ...sourceSession, sessionId: newSessionId, isPending: false, lastModified: Date.now() }
      materializeNavigation(sourceSession, materialized)
      updateCatalog(previous => materializeSessionList(previous, sourceSession, materialized), sourceSession)
      if (follow) void selectSession(materialized)
      return
    }
    const forked: Session = {
      sessionId: newSessionId, provider: sourceSession.provider,
      providerInstanceId: sourceSession.providerInstanceId, providerDisplayName: sourceSession.providerDisplayName,
      providerAccentColor: sourceSession.providerAccentColor,
    }
    if (follow) void selectSession(forked)
    else addNavigationTab(forked)
  }, [isCurrentSession, materializeNavigation, updateCatalog, selectSession, addNavigationTab, selectedSession])

  const removeSession = useCallback((target: SessionIdentity) => {
    const remove = (previous: Session[]) => removeSessionFromList(previous, target)
    updateCatalog(remove, target)
    const dashboardContext = isDashboardContext(target)
    if (dashboardContext || isActiveTab(target)) clearCreationError()
    removeNavigation(target)
    if (dashboardContext) clearSessionTranscript()
  }, [updateCatalog, isDashboardContext, isActiveTab, clearCreationError, removeNavigation, clearSessionTranscript])
  const handleDelete = useMemo(() => createSessionDeleteCallback({
    remove: removeSession,
    isActive: isActiveTab,
    clearActive: clearTranscripts,
  }), [removeSession, isActiveTab, clearTranscripts])

  const handleNewSession = useCallback(async () => {
    const isCurrent = captureIntent()
    const target = sessionCreationTarget({
      ...currentProviderTarget(), session: currentSession(), projectDir: currentProjectDir(),
    })
    const draft = await createSession(target, { isCurrent })
    if (!draft) return
    if (isCurrent()) await selectSession(draft)
    else addNavigationTab(draft)
  }, [captureIntent, currentProviderTarget, currentSession, currentProjectDir, createSession, selectSession, addNavigationTab])

  const handleChangeProvider = useCallback(async (
    nextProvider: ProviderSelection,
    nextProviderInstanceId?: string,
  ) => {
    clearCreationError()
    invalidateIntent()
    if (!await selectProvider(nextProvider, nextProviderInstanceId)) return
    clearNavigation()
    clearTranscripts()
  }, [clearCreationError, invalidateIntent, clearTranscripts, selectProvider, clearNavigation])

  // ── Right-hand surface panel ────────────────────────────────────────────────
  // Additive: every surface here is the same component the full-screen overlay
  // renders, in a docked shell. The overlay entry points (⌃G, ⌃F, the command
  // palette) are untouched.
  const rightPanelAvailability = useMemo<Record<RightPanelSurfaceKind, boolean>>(() => panelSurfaceAvailability('web', {
    browser: true,
    terminal: true,
    files: !!activeProjectDir,
    diff: !!activeProjectDir,
    'pull-request': !!activeProjectDir,
    agents: true,
  }), [activeProjectDir])

  const rightPanelHints = useMemo<Partial<Record<RightPanelSurfaceKind, string>>>(() => ({
    files: 'Available when a project is open.',
    diff: 'Available for Git repositories.',
    'pull-request': 'Available when a project is open.',
  }), [])

  // The control center (Coordination plugin) in the side panel and the run dashboard.
  const panelCoordinationServices = useMemo<WebPluginServices>(() => ({
    coordination: {
      provider,
      selectedSession,
      openSession: selectCommandPaletteSession,
      sessionsChanged: () => { void fetchSessions() },
    },
  }), [provider, selectedSession, selectCommandPaletteSession, fetchSessions])
  const dashboardCoordinationServices = useMemo<WebPluginServices>(() => ({
    coordination: {
      ...panelCoordinationServices.coordination!,
      sessionsChanged: () => { void fetchSessions(false) },
    },
  }), [panelCoordinationServices, fetchSessions])
  // The control center's command opens the run dashboard on it.
  useEffect(() => subscribePluginCommands((commandId) => {
    const command = getPluginCommand(commandId)
    if (!command || command.opens !== 'coordination' || !isPluginEnabled(command.pluginId)) return false
    openCoordinator()
    return true
  }), [openCoordinator])
  // What the Terminal and Browser views are given: a way to attach what they
  // show to the message being written, when there is one.
  const contextServices = useMemo<WebPluginServices>(() => (!selectedProject && selectedSession ? {
    composer: {
      insertPath: insertFilePathToComposer,
      attachContext: (attachment) => { window.dispatchEvent(new CustomEvent('agent-viewer:insert-context', { detail: attachment })) },
    },
  } : {}), [selectedProject, selectedSession, insertFilePathToComposer])

  return (
    <CodeThemeProvider>
    <SidebarProvider defaultOpen>
      <div suppressHydrationWarning style={{ display: 'flex', height: '100vh' }}>
        {!isMessageViewMaximized && <Sidebar variant="inset">
          <SessionList
            sessions={sessions}
            loading={loadingSessions}
            error={sessionsError ?? providerError ?? catalogError}
            provider={provider}
            providerInstanceId={providerInstanceId}
            providerInstances={providerInstances}
            switchingProvider={switchingProvider || !providerReady}
            selectedId={selectedTabKey}
            selectedProject={selectedProject?.dir ?? null}
            selectedDashboard={dashboardSelected ? dashboardTab : null}
            teamAttention={teamAttention}
            scrollToSessionRequest={sessionListScrollRequest}
            onSelect={selectSession}
            onSelectProject={selectProject}
            onOpenDashboard={openRunDashboard}
            onRename={handleRename}
            onTag={handleTag}
            onChangeProvider={handleChangeProvider}
            scopeMode={sessionScope}
            scopeProjectName={activeProjectName}
            canScopeToProject={!!activeProjectDir}
            includeWorktrees={includeWorktrees}
            onChangeScope={setSessionScope}
            onToggleWorktrees={setIncludeWorktrees}
            onOpenCommandPalette={openCommandPalette}
            onOpenCoordinator={openCoordinator}
            onOpenCrossSessionMessaging={openCrossSessionMessaging}
            canOpenGit={!!activeProjectDir}
            onOpenGit={openGitPopover}
            onNewSession={handleNewSession}
            creatingSession={creatingNewSession}
          />
        </Sidebar>}
        {rightPanel.open && rightPanel.expanded && !isMessageViewMaximized ? null : messagePaneCollapsed && !isMessageViewMaximized ? (
          <CollapsedReaderPane onExpand={toggleMessagePane} />
        ) : (
          <ReaderPane>
              {!isMessageViewMaximized && <ReaderPaneCollapseButton onClick={toggleMessagePane} />}
              <ViewTransition key={messageAreaKey} enter="fade-in" exit="fade-out" default="none">
                {dashboardSelected ? (
                  <DashboardViews value={dashboardTab} onValueChange={setDashboardTab}>
                    <DashboardView value="sessions">
                      <RunDashboard
                        sessions={sessions}
                        selectedSession={selectedSession}
                        messages={messages}
                        loading={loadingSessions}
                        providerLabel={provider}
                        scopeLabel={sessionScope === 'project' ? activeProjectName : null}
                        onSelectSession={selectSession}
                      />
                    </DashboardView>
                    <DashboardView value="agents">
                      <PluginSurfaceHost surfaceId="coordination" placement="window" sessionKey={null} services={dashboardCoordinationServices} onClose={openRunDashboard} />
                    </DashboardView>
                    <DashboardView value="messaging">
                      <CrossSessionMessaging />
                    </DashboardView>
                  </DashboardViews>
                ) : (
                  <MessageView
                    messages={messages}
                    loading={loadingMessages}
                    session={selectedSession}
                    targetMessageId={targetMessage?.messageId ?? null}
                    targetMessageRequestId={targetMessage?.requestId ?? 0}
                    projectView={projectViewProp}
                    onFork={handleFork}
                    onDelete={handleDelete}
                    openTabs={openTabSessions}
                    selectedTabId={selectedTabKey}
                    onSelectTab={selectOpenTab}
                    onCloseTab={closeTab}
                    onOpenSession={selectCommandPaletteSession}
                    taskPanelOpenRequest={taskPanelOpenRequest}
                    promptLibraryOpenRequest={promptLibraryOpenRequest}
                    channelBridgeOpenRequest={channelBridgeOpenRequest}
                    channelBridgeRouteToggleRequest={channelBridgeRouteToggleRequest}
                    onChannelBridgeRoutingChange={setChannelBridgeRouting}
                    ideBridgeOpenRequest={ideBridgeOpenRequest}
                    ideBridgeRouteToggleRequest={ideBridgeRouteToggleRequest}
                    onIdeBridgeRoutingChange={setIdeBridgeRouting}
                    composerInsertRequest={composerInsertRequest}
                    onComposerInsertConsumed={consumeComposerInsertRequest}
                    openCodeTodos={openCodeTodosForView}
                    codexPlan={codexPlanForView}
                    codexExternalWriter={codexExternalWriter}
                    onOpenGit={openGitPopover}
                    maximized={isMessageViewMaximized}
                    onToggleMaximized={toggleMessageViewMaximized}
                    onEnterFullscreen={enterMessageViewFullscreen}
                    rightPanelOpen={rightPanel.open}
                    onToggleRightPanel={rightPanel.toggle}
                  />
                )}
              </ViewTransition>
              {commandPaletteOpen ? (
                <CommandPalette
                  open={commandPaletteOpen}
                  onOpenChange={setCommandPaletteOpen}
                  sessions={sessions}
                  selectedSession={selectedSession}
                  selectedProject={selectedProject}
                  provider={provider}
                  providerInstanceId={providerInstanceId}
                  providerInstances={providerInstances}
                  scopeMode={sessionScope}
                  scopeProjectName={activeProjectName}
                  includeWorktrees={includeWorktrees}
                  messagePaneCollapsed={messagePaneCollapsed}
                  messageViewMaximized={isMessageViewMaximized}
                  messageViewFullscreen={messageViewFullscreen}
                  canMaximizeMessageView={canMaximizeMessageView}
                  canOpenGit={!!activeProjectDir}
                  canOpenTasks={!selectedProject && (selectedSession?.provider ?? provider) === 'claude'}
                  canOpenPromptLibrary={!selectedProject && !!selectedSession}
                  canOpenChannelBridge={canUseChannelBridge}
                  channelBridgeRouting={channelBridgeRouting}
                  canOpenIdeBridge={canUseIdeBridge}
                  ideBridgeRouting={ideBridgeRouting}
                  onSelectSession={selectCommandPaletteSession}
                  onSelectProject={selectProject}
                  onChangeProvider={handleChangeProvider}
                  onChangeScope={setSessionScope}
                  onToggleWorktrees={setIncludeWorktrees}
                  onToggleMessagePane={toggleMessagePane}
                  rightPanelOpen={rightPanel.open}
                  rightPanelAvailability={rightPanelAvailability}
                  onToggleRightPanel={rightPanel.toggle}
                  onOpenRightPanelSurface={rightPanel.openSurface}
                  onToggleMessageViewMaximized={toggleMessageViewMaximized}
                  onEnterMessageViewFullscreen={enterMessageViewFullscreen}
                  onOpenCrossSessionMessaging={openCrossSessionMessaging}
                  onOpenTasks={openTaskPanel}
                  onOpenPromptLibrary={openPromptLibrary}
                  onOpenChannelBridge={openChannelBridge}
                  onToggleChannelBridgeRoute={toggleChannelBridgeRoute}
                  onOpenIdeBridge={openIdeBridge}
                  onToggleIdeBridgeRoute={toggleIdeBridgeRoute}
                  onOpenBookmarks={() => setBookmarksPanelOpen(true)}
                  onOpenProvenance={() => setProvenanceOpen(true)}
                  onOpenRemoteAccess={() => setRemoteAccessOpen(true)}
                  onOpenPlugins={() => setPluginManagerOpen(true)}
                />
              ) : null}
          </ReaderPane>
        )}
        {rightPanel.open && !isMessageViewMaximized ? (
          <RightPanel
            surfaces={rightPanel.surfaces}
            activeId={rightPanel.activeId}
            width={rightPanel.width}
            expanded={rightPanel.expanded}
            availability={rightPanelAvailability}
            unavailableHints={rightPanelHints}
            onOpenSurface={rightPanel.openSurface}
            onActivate={rightPanel.activate}
            onClose={rightPanel.close}
            onCloseAll={rightPanel.closeAll}
            onCollapse={rightPanel.collapse}
            onToggleExpanded={rightPanel.toggleExpanded}
            onWidthChange={rightPanel.setWidth}
            surfaceTitle={panelSurfaceTitle}
          >
            {rightPanel.surfaces.map(surface => <RightPanelContent key={surface.id} surfaceId={surface.id}>
              <PanelPluginSurface surface={surface} repositoryServices={repositoryServices} contextServices={contextServices}
                coordinationServices={panelCoordinationServices} onClose={rightPanel.close} onBrowserNavigate={rightPanel.setBrowserUrl} />
            </RightPanelContent>)}
          </RightPanel>
        ) : null}
        {activeProjectDir && repositoryOverlay && repositoryServices ? (
          <PluginSurfaceHost
            surfaceId={repositoryOverlay}
            placement="overlay"
            sessionKey={null}
            cwd={activeProjectDir}
            services={repositoryServices!}
            onClose={() => setRepositoryOverlay(null)}
          />
        ) : null}
        {provenanceOpen ? (
          <ProvenancePopover
            open={provenanceOpen}
            onClose={() => setProvenanceOpen(false)}
                    session={selectedSession && !selectedSession.isPending
                      ? {
                          sessionId: selectedSession.sessionId,
                          provider: selectedSession.provider,
                          providerInstanceId: selectedSession.providerInstanceId,
                        }
                      : null}
            cwd={activeProjectDir}
            onOpenSession={({ sessionId, provider: editProvider, uuid }) => {
              selectCommandPaletteSession({ sessionId, provider: editProvider } as Session, uuid)
            }}
          />
        ) : null}
        {remoteAccessOpen ? (
          <RemoteAccessPopover open={remoteAccessOpen} onClose={() => setRemoteAccessOpen(false)} />
        ) : null}
        {pluginManagerOpen ? <PluginManager open onClose={() => setPluginManagerOpen(false)} /> : null}
        {bookmarksPanelOpen ? (
          <BookmarksPanel
            open={bookmarksPanelOpen}
            onClose={() => setBookmarksPanelOpen(false)}
            onSelect={({ sessionId, provider: bookmarkProvider, uuid }) => {
              selectCommandPaletteSession({ sessionId, provider: bookmarkProvider } as Session, uuid)
            }}
          />
        ) : null}
        {!isMessageViewMaximized ? <PiActivityPopover /> : null}
      </div>
    </SidebarProvider>
    </CodeThemeProvider>
  )
}
