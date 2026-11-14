'use client'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useModAppHost } from '../../lib/plugins/useModAppHost'
import { useModSurfaces } from '../../lib/plugins/modSurfaces'
import { getCurrentTheme, subscribeTheme } from '../../lib/themes'
import { dispatchPluginCommand } from '../../lib/plugins/commandBus'
import type { PluginSessionActivity } from '../../lib/plugins/application'
import type { Session } from '../../lib/types'
import { sessionIdentityKey } from '../../lib/sessionIdentity'
import { useApplicationPlugins } from '../../lib/plugins/useApplicationPlugins'
import { pluginRuntimeActivity } from '../../lib/plugins/runtimeActivity'
import { getPluginCommand, isPluginSurfaceId, type PluginSurfaceId } from '../../lib/plugins/catalog'
import { subscribePluginCommands } from '../../lib/plugins/commandBus'
import { isPluginEnabled } from '../../lib/plugins/enablement'
import type { WebPluginServices } from './pluginTypes'
import type { PluginApplicationServices } from '../../lib/plugins/application'
import type { PluginSessionRef } from '../../lib/plugins/bookmarks'
import { NotificationFallback } from './NotificationFallback'
import { webNotifications } from '../../lib/plugins/notifications'
import { webActivityFeed } from '../../lib/plugins/activityFeed'
import { webApplicationPlugins } from './applicationPlugins'
import PluginSurfaceHost from './PluginSurfaceHost'
import { usePluginCommands } from '../../lib/plugins/usePluginCommands'
import { webPluginCommands } from './pluginCommands'

/** The Web shell adapter for app events and capability sinks. Contains no feature policy. */
export function ApplicationPluginHost({ sessions, selectedSession, cwd = null, insertText, openSession, sessionTabs, sessionFleet }: {
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
}) {
  const showNotice = useCallback((text: string) => { webNotifications.service.show('info', text) }, [])
  const showError = useCallback((error: unknown) => {
    if (error instanceof Error && error.name === 'AbortError') return
    const text = error instanceof Error ? error.message : 'Plugin command failed'
    webNotifications.service.show('error', text)
  }, [])
  const [overlay, setOverlay] = useState<{ surface: PluginSurfaceId; cwd: string | null; session: Session | null; path?: string } | null>(null)
  const context = useRef({ sessions, selectedSession })
  context.current = { sessions, selectedSession }
  const services = useMemo<PluginApplicationServices>(() => ({ activity: webActivityFeed, notifications: {
    ...webNotifications.service,
    notice: showNotice,
    desktop: (title, body) => {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try { new Notification(`agent-viewer · ${title}`, { body }) } catch { /* host unavailable */ }
      }
    },
  } }), [showNotice])
  const theme = useSyncExternalStore(subscribeTheme, getCurrentTheme, () => 'dark')
  const [modActivity, setModActivity] = useState<ReadonlyMap<string, PluginSessionActivity>>(new Map())
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
  const acceptActivity = useCallback((activity: ReadonlyMap<string, PluginSessionActivity>) => {
    setModActivity(previous => JSON.stringify([...previous]) === JSON.stringify([...activity]) ? previous : activity)
    const current = context.current
    publish({ activity, now: Date.now(),
      sessions: current.sessions.map(session => ({ key: sessionIdentityKey(session), title: session.customTitle || session.summary || session.firstPrompt || session.sessionId, target: { provider: session.provider ?? 'claude', providerInstanceId: session.providerInstanceId, sessionId: session.sessionId } })),
      selectedKey: current.selectedSession ? sessionIdentityKey(current.selectedSession) : null,
      focused: document.visibilityState !== 'hidden' && document.hasFocus(),
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
        const activity = pluginRuntimeActivity(await response.json())
        if (cancelled || controller.signal.aborted) return
        acceptActivity(activity)
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
    sessions: sessions.map(session => ({ key: sessionIdentityKey(session), title: session.customTitle || session.summary || session.firstPrompt || session.sessionId, cwd: session.cwd ?? null, activity: modActivity.get(sessionIdentityKey(session)) ?? 'idle', target: { provider: session.provider ?? 'claude', providerInstanceId: session.providerInstanceId, sessionId: session.sessionId } })),
  } as const), [cwd, theme, appFocused, modSurfaces, selectedSession, sessions, modActivity])
  useModAppHost(modAppSnapshot, modActions)
  const close = useCallback(() => setOverlay(null), [])
  // A view opens a file's history in its place, on the same repository.
  const openFileHistory = useCallback((path: string) => {
    if (!isPluginSurfaceId('file-history') || !isPluginEnabled('file-history')) { showNotice('File history is off · turn its plugin on in Plugins'); return }
    setOverlay(current => current ? { ...current, surface: 'file-history', path } : current)
  }, [showNotice])
  return <>
    <NotificationFallback />
    {overlay && <PluginSurfaceHost surfaceId={overlay.surface} placement="overlay" sessionKey={null} cwd={overlay.cwd ?? undefined} path={overlay.path ?? null} services={{ session: { session: overlay.session }, 'file-history': { open: openFileHistory }, ...(sessionTabs ? { 'session-tabs': sessionTabs } : {}), ...(sessionFleet ? { 'session-fleet': sessionFleet } : {}), ...(insertText ? { composer: { insertText } } : {}), ...(openSession ? { 'session-navigation': { open: openSession } } : {}), ...(overlay.cwd ? { repository: { cwd: overlay.cwd, sessionId: null } } : {}) }} onClose={close} />}
  </>
}
