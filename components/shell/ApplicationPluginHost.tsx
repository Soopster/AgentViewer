'use client'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useModAppHost } from '../../lib/plugins/useModAppHost'
import { useModSurfaces } from '../../lib/plugins/modSurfaces'
import { getCurrentTheme, subscribeTheme } from '../../lib/themes'
import { dispatchPluginCommand, dispatchPluginCommandWhenShown } from '../../lib/plugins/commandBus'
import type { PluginSessionActivity } from '../../lib/plugins/application'
import type { Session } from '../../lib/types'
import { sessionIdentityKey } from '../../lib/sessionIdentity'
import { useApplicationPlugins } from '../../lib/plugins/useApplicationPlugins'
import { pluginRuntimeActivity } from '../../lib/plugins/runtimeActivity'
import { getPluginCommand, isPluginSurfaceId, type PluginSurfaceId } from '../../lib/plugins/catalog'
import { subscribePluginCommands } from '../../lib/plugins/commandBus'
import { isPluginEnabled } from '../../lib/plugins/enablement'
import type { WebPluginServices } from './pluginTypes'
import { useWebShellOverview, readGit, type WebShellActions } from './shellOverviewService'
import { webProof } from './proofService'
import { webFocus } from './focusService'
import { webIde } from './ideService'

const NO_SHELL_ACTIONS: WebShellActions = { openPalette: () => {}, newSession: () => {} }
import type { PluginApplicationServices } from '../../lib/plugins/application'
import type { PendingPermission } from '../../lib/permissions'
import { pluginPendingAsks } from '../../lib/plugins/runtimeActivity'
import type { PluginSessionRef } from '../../lib/plugins/bookmarks'
import { NotificationFallback } from './NotificationFallback'
import { webNotifications } from '../../lib/plugins/notifications'
import { webActivityFeed } from '../../lib/plugins/activityFeed'
import { webApplicationPlugins } from './applicationPlugins'
import PluginSurfaceHost from './PluginSurfaceHost'
import { usePluginCommands } from '../../lib/plugins/usePluginCommands'
import { webPluginCommands } from './pluginCommands'

async function postSession(target: PluginSessionRef, route: 'actions' | 'interrupt', body: Record<string, unknown>) {
  const res = await fetch(`/api/sessions/${encodeURIComponent(target.sessionId)}/${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, provider: target.provider, providerInstanceId: target.providerInstanceId }),
  })
  const data = await res.json().catch(() => ({})) as { error?: string; stopped?: boolean }
  if (!res.ok || data.error) throw new Error(data.error ?? 'The request failed')
  return data
}

/** The Web shell adapter for app events and capability sinks. Contains no feature policy. */
export function ApplicationPluginHost({ teamAttention, sessions, selectedSession, cwd = null, insertText, openSession, sessionTabs, sessionFleet, shellActions }: {
  /** Teammates waiting on the lead per conversation (`provider:sessionId`), from the page's one poll. */
  teamAttention?: Readonly<Record<string, { waiting: number; finished: number }>>
  sessions: readonly Session[]
  selectedSession: Session | null
  cwd?: string | null
  /** The page's composer insert, offered to app-scoped views as the `composer` service. */
  insertText?: (text: string) => void
  /** The page's session selection, offered to app-scoped views as `session-navigation`. */
  openSession?: (session: PluginSessionRef, messageUuid?: string) => void
  /** The page's tab strip, offered as `session-tabs` (the Tab manager). */
  sessionTabs?: import('../../lib/plugins/sessionTabs').PluginSessionTabs
  /** Every session in scope and the selected one's transcript, offered as `session-fleet` (the Desk). */
  sessionFleet?: WebPluginServices['session-fleet']
  /** The page's palette and new-session actions, for the `shell-overview` service (the Omni bar). */
  shellActions?: WebShellActions
}) {
  // Dismissed island rows stay dismissed across reloads; unreadable storage only re-shows them.
  useEffect(() => webActivityFeed.attachDismissals({
    load: () => { try { const rows: unknown = JSON.parse(localStorage.getItem('agentViewer:islandDismissed') ?? '[]'); return Array.isArray(rows) ? rows : [] } catch { return [] } },
    save: rows => { try { localStorage.setItem('agentViewer:islandDismissed', JSON.stringify(rows)) } catch { /* storage unavailable */ } },
  }), [])
  const shellOverview = useWebShellOverview(shellActions ?? NO_SHELL_ACTIONS)
  const showNotice = useCallback((text: string) => { webNotifications.service.show('info', text) }, [])
  const showError = useCallback((error: unknown) => {
    if (error instanceof Error && error.name === 'AbortError') return
    const text = error instanceof Error ? error.message : 'Plugin command failed'
    webNotifications.service.show('error', text)
  }, [])
  const [overlay, setOverlay] = useState<{ surface: PluginSurfaceId; cwd: string | null; session: Session | null; path?: string } | null>(null)
  const teamAttentionRef = useRef(teamAttention)
  teamAttentionRef.current = teamAttention
  const context = useRef<{ sessions: readonly Session[]; selectedSession: Session | null; cwd: string | null }>({ sessions, selectedSession, cwd })
  context.current = { sessions, selectedSession, cwd }
  const services = useMemo<PluginApplicationServices>(() => ({ activity: webActivityFeed, repository: { readGit, readProof: (cwd, signal) => webProof.read(cwd, signal) }, permissions: {
    respond: async (target, permissionId, response) => {
      const res = await fetch(`/api/sessions/${encodeURIComponent(target.sessionId)}/actions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'respondPermission', permissionId, response, provider: target.provider, providerInstanceId: target.providerInstanceId }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok || data.error) throw new Error(data.error ?? 'Failed to respond to permission')
    },
    answer: (target, permissionId, answers) => postSession(target, 'actions', { action: 'respondQuestion', permissionId, answers }).then(() => {}),
  }, notifications: {
    ...webNotifications.service,
    notice: (text, options) => { webNotifications.service.show('info', text, { urgent: options?.urgent }) },
    desktop: (title, body) => {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try { new Notification(`agent-viewer · ${title}`, { body }) } catch { /* host unavailable */ }
      }
    },
  }, focus: webFocus, ide: webIde }), [showNotice])
  // A draft waits until its session is the selected one, so it cannot land in another composer.
  const [pendingDraft, setPendingDraft] = useState<{ key: string | null; text: string } | null>(null)
  const selectedKey = selectedSession ? sessionIdentityKey(selectedSession) : null
  useEffect(() => {
    if (!pendingDraft || (pendingDraft.key && pendingDraft.key !== selectedKey)) return
    setPendingDraft(null)
    if (pendingDraft.text) insertText?.(pendingDraft.text)
  }, [pendingDraft, selectedKey, insertText])
  const activityControl = useMemo<NonNullable<WebPluginServices['activity-control']>>(() => ({
    interrupt: target => postSession(target, 'interrupt', {}).then(() => {}),
    stopTask: async (target, taskId) => {
      const data = await postSession(target, 'actions', { action: 'stopTask', taskId })
      if (data.stopped !== true) throw new Error('No running task to stop (session not warm)')
    },
    rerunChecks: async (cwd, ids, version) => { await webProof.start(cwd, [...ids], version) },
    draft: (target, text) => {
      if (text && !insertText) throw new Error('No composer is available')
      if (target) openSession?.(target)
      setPendingDraft({ key: target ? sessionIdentityKey(target) : null, text })
    },
    open: (commandId, target) => {
      if (target) { openSession?.(target); dispatchPluginCommandWhenShown(commandId, target) }
      else dispatchPluginCommand(commandId)
    },
  }), [insertText, openSession])
  const theme = useSyncExternalStore(subscribeTheme, getCurrentTheme, () => 'dark')
  const [modActivity, setModActivity] = useState<ReadonlyMap<string, PluginSessionActivity>>(new Map())
  // When each running turn began, from the same registry read.
  const [runningSince, setRunningSince] = useState<ReadonlyMap<string, number>>(new Map())
  const [appFocused, setAppFocused] = useState<boolean | null>(null)
  const { publish } = useApplicationPlugins('web', webApplicationPlugins, services)
  useEffect(() => {
    const update = () => setAppFocused(document.visibilityState !== 'hidden' && document.hasFocus())
    update()
    window.addEventListener('focus', update); window.addEventListener('blur', update); document.addEventListener('visibilitychange', update)
    return () => { window.removeEventListener('focus', update); window.removeEventListener('blur', update); document.removeEventListener('visibilitychange', update) }
  }, [])
  const executeCommand = usePluginCommands('web', webPluginCommands, 'application')
  const executeRepositoryCommand = usePluginCommands('web', webPluginCommands, cwd)
  const acceptActivity = useCallback((activity: ReadonlyMap<string, PluginSessionActivity>, pending?: ReadonlyMap<string, readonly PendingPermission[]>, started?: ReadonlyMap<string, number>) => {
    setModActivity(previous => JSON.stringify([...previous]) === JSON.stringify([...activity]) ? previous : activity)
    const current = context.current
    publish({ activity, now: Date.now(),
      sessions: current.sessions.map(session => ({ key: sessionIdentityKey(session), title: session.customTitle || session.summary || session.firstPrompt || session.sessionId, target: { provider: session.provider ?? 'claude', providerInstanceId: session.providerInstanceId, sessionId: session.sessionId } })),
      selectedKey: current.selectedSession ? sessionIdentityKey(current.selectedSession) : null,
      focused: document.visibilityState !== 'hidden' && document.hasFocus(),
      cwd: current.cwd, ...(pending ? { pending } : {}), ...(started ? { started } : {}),
      teams: new Map(current.sessions.flatMap(session => { const mark = teamAttentionRef.current?.[`${session.provider ?? 'claude'}:${session.sessionId}`]; return mark ? [[sessionIdentityKey(session), mark] as const] : [] })),
    })
  }, [publish])
  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    let inFlight = false
    const read = async () => {
      if (inFlight || controller.signal.aborted) return
      inFlight = true
      try {
        const response = await fetch('/api/sessions/running', { signal: controller.signal })
        if (!response.ok) return
        const body = await response.json()
        const activity = pluginRuntimeActivity(body)
        if (cancelled || controller.signal.aborted) return
        const since = new Map<string, number>((Array.isArray(body?.running) ? body.running : []).flatMap((entry: { sessionId?: string; provider?: string; providerInstanceId?: string; startedAt?: number }) =>
          typeof entry.sessionId === 'string' && typeof entry.startedAt === 'number' ? [[sessionIdentityKey({ sessionId: entry.sessionId, provider: entry.provider as Session['provider'], providerInstanceId: entry.providerInstanceId }), entry.startedAt] as const] : []))
        acceptActivity(activity, pluginPendingAsks(body), since)
        setRunningSince(previous => JSON.stringify([...previous]) === JSON.stringify([...since]) ? previous : since)
      } catch { /* retain observer baseline through transient failures */ }
      finally { inFlight = false }
    }
    void read()
    const timer = window.setInterval(() => { void read() }, 2500)
    return () => { cancelled = true; controller.abort(); window.clearInterval(timer) }
  }, [acceptActivity])
  useEffect(() => subscribePluginCommands(id => {
    const command = getPluginCommand(id)
    if (!command || !command.renderers.includes('web') || !isPluginEnabled(command.pluginId)) return false
    // A repository command with no repository says so, rather than doing nothing.
    if (command.scope === 'repository' && !cwd && !command.webDashboard && !command.webReader) {
      showNotice(`${command.label} needs a project: open a session first`)
      return true
    }
    if (command.handler && command.scope === 'repository') {
      void executeRepositoryCommand(id, { session: selectedSession, cwd }, { notices: { show: (_kind, text) => showNotice(text) } })
        .catch(showError)
      return true
    }
    if (command.webDashboard || command.webReader) return false
    if (command.scope !== 'application' && command.scope !== 'repository') return false
    if (command.handler) {
      void executeCommand(id, { session: null, cwd: null }, { notices: { show: (_kind, text) => showNotice(text) } })
        .catch(showError)
      return true
    }
    if (!isPluginSurfaceId(command.opens)) return false
    // The repository is captured for any app view that declares it; others never receive it.
    const surface = command.opens
    setOverlay(current => command.toggle && current?.surface === surface ? null : { surface, cwd, session: selectedSession ? { ...selectedSession } : null })
    return true
  }), [executeCommand, executeRepositoryCommand, cwd, selectedSession])
  const modSurfaces = useModSurfaces()
  const modActions = useMemo(() => ({
    runCommand: (id: string) => dispatchPluginCommand(id),
    openSession,
    openFile: (path: string, line?: number) => {
      if (line !== undefined) throw new Error('The Web Files preview does not support line positioning')
      if (!cwd || !isPluginEnabled('files')) throw new Error('File navigation needs a repository and the Files plugin')
      setOverlay({ surface: 'files', cwd, session: selectedSession, path })
    },
  }), [openSession, cwd, selectedSession])
  const modAppSnapshot = useMemo<Omit<import('../../lib/plugins/modApp').ModAppSnapshot, 'version' | 'instanceId' | 'commands'>>(() => ({ renderer: 'web', cwd, theme, focused: appFocused, focusedSurface: modSurfaces.focused, surfaces: modSurfaces.surfaces,
    selectedKey: selectedSession ? sessionIdentityKey(selectedSession) : null,
    sessions: sessions.map(session => ({ key: sessionIdentityKey(session), title: session.customTitle || session.summary || session.firstPrompt || session.sessionId, cwd: session.cwd ?? null, activity: modActivity.get(sessionIdentityKey(session)) ?? 'idle', ...(runningSince.has(sessionIdentityKey(session)) ? { startedAt: runningSince.get(sessionIdentityKey(session)) } : {}), target: { provider: session.provider ?? 'claude', providerInstanceId: session.providerInstanceId, sessionId: session.sessionId } })),
  } as const), [cwd, theme, appFocused, modSurfaces, selectedSession, sessions, modActivity, runningSince])
  useModAppHost(modAppSnapshot, modActions)
  const close = useCallback(() => setOverlay(null), [])
  // A view opens a file's history in its place, on the same repository.
  const openFileHistory = useCallback((path: string) => {
    if (!isPluginSurfaceId('file-history') || !isPluginEnabled('file-history')) { showNotice('File history is off · turn its plugin on in Plugins'); return }
    setOverlay(current => current ? { ...current, surface: 'file-history', path } : current)
  }, [showNotice])
  return <>
    <NotificationFallback />
    {overlay && <PluginSurfaceHost surfaceId={overlay.surface} placement="overlay" sessionKey={null} cwd={overlay.cwd ?? undefined} path={overlay.path ?? null} services={{ session: { session: overlay.session }, 'activity-control': activityControl, 'file-history': { open: openFileHistory }, ...(sessionTabs ? { 'session-tabs': sessionTabs } : {}), ...(sessionFleet ? { 'session-fleet': sessionFleet } : {}), 'shell-overview': shellOverview, ...(insertText ? { composer: { insertText } } : {}), ...(openSession ? { 'session-navigation': { open: openSession } } : {}), ...(overlay.cwd ? { repository: { cwd: overlay.cwd, sessionId: null } } : {}) }} onClose={close} />}
  </>
}
