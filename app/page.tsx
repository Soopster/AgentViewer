'use client'

import { usePluginDashboards, usePluginDashboardCommands } from '@/components/shell/usePluginDashboards'
import type { PluginDashboardId } from '@/lib/plugins/dashboard'
import type { DashboardTab } from '@/components/viewer-navigation/model'
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
import { ApplicationPluginHost } from '@/components/shell/ApplicationPluginHost'
import type { PluginSessionRef } from '@/lib/plugins/bookmarks'

import { panelSurfaceAvailability } from '@/lib/rightPanel'


import { useState, useEffect, useRef, useCallback, useMemo, startTransition, ViewTransition } from 'react'
import type { PluginSessionTabs } from '@/lib/plugins/sessionTabs'
import { sessionSelectionKey } from '@/components/session-catalog/selectionKey'
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
const PluginManager = dynamic(() => import('@/components/shell/PluginManager'), { ssr: false })
const PluginWidgetHost = dynamic(() => import('@/components/shell/PluginWidgetHost').then(module => module.PluginWidgetHost), { ssr: false })
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
    materialize: materializeNavigation, addTab: addNavigationTab, pinTab, moveTab, pinnedTabKeys,
    isActiveTab, isCurrentSession, isDashboardContext, isEmpty: navigationIsEmpty, currentProjectDir, currentSession, captureIntent, invalidateIntent,
  } = useViewerNavigation({ sessions, provider, scope: sessionScope })
  const [includeWorktrees, setIncludeWorktrees] = useState(true)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  // A repository-pinned plugin surface (Git) open as an overlay on the active project.
  const [repositoryOverlay, setRepositoryOverlay] = useState<PluginSurfaceId | null>(null)
  const [composerInsertRequest, setComposerInsertRequest] = useState<ComposerInsertRequest | null>(null)
  const composerInsertRequestRef = useRef(0)
  const [pluginManagerOpen, setPluginManagerOpen] = useState(false)
  usePluginSettingsSync()
  const rightPanel = useRightPanel()
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

  const pluginDashboards = usePluginDashboards({ includeDisabled: true })
  const openPluginDashboard = useCallback((id: PluginDashboardId) => {
    clearCreationError()
    clearProjectTranscript()
    navigateDashboard(id)
  }, [clearCreationError, clearProjectTranscript, navigateDashboard])
  usePluginDashboardCommands(openPluginDashboard)


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

  // The `session-navigation` service: plugins name a session, the page selects it.
  const openSessionFromPlugin = useCallback((ref: PluginSessionRef, messageUuid?: string) => {
    selectCommandPaletteSession({ sessionId: ref.sessionId, provider: ref.provider, ...(ref.providerInstanceId ? { providerInstanceId: ref.providerInstanceId } : {}) } as Session, messageUuid)
  }, [selectCommandPaletteSession])

  const closeTab = useCallback((sessionKey: string) => {
    const { wasActive, adjacent } = closeNavigationTab(sessionKey)
    if (!wasActive) return
    clearCreationError()
    if (adjacent) void selectSession(adjacent)
    else clearTranscripts()
  }, [closeNavigationTab, clearCreationError, clearTranscripts, selectSession])
  // The tab strip as the Tab manager plugin's `session-tabs` service (the TUI serves the same contract).
  const sessionTabs = useMemo<PluginSessionTabs>(() => ({
    sessions: openTabSessions,
    pinned: new Set(pinnedTabKeys),
    selectedKey: selectedTabKey,
    keyOf: sessionSelectionKey,
    togglePin: (session) => { pinTab(sessionSelectionKey(session)); return true },
    move: (session, delta) => moveTab(sessionSelectionKey(session), delta),
    close: (session) => closeTab(sessionSelectionKey(session)),
    select: selectOpenTab,
  }), [openTabSessions, pinnedTabKeys, selectedTabKey, pinTab, moveTab, closeTab, selectOpenTab])

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
  // What every dashboard plugin may use; each receives only what it declares.
  const dashboardServices = useMemo<WebPluginServices>(() => ({
    session: { session: selectedSession },
    coordination: dashboardCoordinationServices.coordination,
    'session-navigation': { open: openSessionFromPlugin },
    'session-fleet': {
      sessions, selected: selectedSession, selectedMessages: messages, loading: loadingSessions,
      providerLabel: provider, scopeLabel: sessionScope === 'project' ? activeProjectName : null,
      select: selectSession,
    },
  }), [selectedSession, dashboardCoordinationServices, openSessionFromPlugin, sessions, messages, loadingSessions, provider, sessionScope, activeProjectName, selectSession])
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
    <ApplicationPluginHost sessions={sessions} selectedSession={selectedSession} cwd={activeProjectDir} insertText={insertTextToComposer} openSession={openSessionFromPlugin} sessionTabs={sessionTabs} sessionFleet={dashboardServices['session-fleet']} />
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
                    {pluginDashboards.map(dashboard => <DashboardView key={dashboard.id} value={dashboard.id as DashboardTab}>
                      <PluginSurfaceHost surfaceId={dashboard.surface} placement="window" sessionKey={null}
                        services={dashboardServices} onClose={openRunDashboard} />
                    </DashboardView>)}
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
                    pinnedTabKeys={pinnedTabKeys}
                    onOpenSession={selectCommandPaletteSession}
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
        {pluginManagerOpen ? <PluginManager open onClose={() => setPluginManagerOpen(false)} /> : null}
        <PluginWidgetHost slot="top-center" />
        {!isMessageViewMaximized ? <PluginWidgetHost slot="corner" /> : null}
      </div>
    </SidebarProvider>
    </CodeThemeProvider>
  )
}
