'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  const [notice, setNotice] = useState<{ text: string } | null>(null)
  const [overlay, setOverlay] = useState<{ surface: PluginSurfaceId; cwd: string | null; session: Session | null; path?: string } | null>(null)
  const context = useRef({ sessions, selectedSession })
  context.current = { sessions, selectedSession }
  const services = useMemo<PluginApplicationServices>(() => ({ notifications: {
    notice: text => setNotice({ text }),
    desktop: (title, body) => {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try { new Notification(`agent-viewer · ${title}`, { body }) } catch { /* host unavailable */ }
      }
    },
  } }), [])
  const { publish, observesActivity } = useApplicationPlugins('web', webApplicationPlugins, services)
  const executeCommand = usePluginCommands('web', webPluginCommands, 'application')
  const executeRepositoryCommand = usePluginCommands('web', webPluginCommands, cwd)
  useEffect(() => {
    if (!observesActivity) return
    const controller = new AbortController()
    let inFlight = false
    const read = async () => {
      if (inFlight || controller.signal.aborted) return
      inFlight = true
      try {
        const response = await fetch('/api/sessions/running', { signal: controller.signal })
        if (!response.ok) return
        const activity = pluginRuntimeActivity(await response.json())
        if (controller.signal.aborted) return
        const current = context.current
        publish({ activity, now: Date.now(),
          sessions: current.sessions.map(session => ({ key: sessionIdentityKey(session), title: session.customTitle || session.summary || session.firstPrompt || session.sessionId })),
          selectedKey: current.selectedSession ? sessionIdentityKey(current.selectedSession) : null,
          focused: document.visibilityState !== 'hidden' && document.hasFocus(),
        })
      } catch { /* retain observer baseline through transient failures */ }
      finally { inFlight = false }
    }
    void read()
    const timer = window.setInterval(() => { void read() }, 2500)
    return () => { controller.abort(); window.clearInterval(timer) }
  }, [publish, observesActivity])
  useEffect(() => subscribePluginCommands(id => {
    const command = getPluginCommand(id)
    if (!command || !command.renderers.includes('web') || !isPluginEnabled(command.pluginId)) return false
    // A repository command with no repository says so, rather than doing nothing.
    if (command.scope === 'repository' && !cwd && !command.webDashboard && !command.webReader) {
      setNotice({ text: `${command.label} needs a project: open a session first` })
      return true
    }
    if (command.handler && command.scope === 'repository') {
      void executeRepositoryCommand(id, { session: selectedSession, cwd }, { notices: { show: (_kind, text) => setNotice({ text }) } })
        .catch(error => { if (!(error instanceof Error && error.name === 'AbortError')) setNotice({ text: error instanceof Error ? error.message : 'Plugin command failed' }) })
      return true
    }
    if (command.webDashboard || command.webReader) return false
    if (command.scope !== 'application' && command.scope !== 'repository') return false
    if (command.handler) {
      void executeCommand(id, { session: null, cwd: null }, { notices: { show: (_kind, text) => setNotice({ text }) } })
        .catch(error => { if (!(error instanceof Error && error.name === 'AbortError')) setNotice({ text: error instanceof Error ? error.message : 'Plugin command failed' }) })
      return true
    }
    if (!isPluginSurfaceId(command.opens)) return false
    // The repository is captured for any app view that declares it; others never receive it.
    setOverlay({ surface: command.opens, cwd, session: selectedSession ? { ...selectedSession } : null })
    return true
  }), [executeCommand, executeRepositoryCommand, cwd, selectedSession])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 6000)
    return () => window.clearTimeout(timer)
  }, [notice])
  const close = useCallback(() => setOverlay(null), [])
  // A view opens a file's history in its place, on the same repository.
  const openFileHistory = useCallback((path: string) => {
    if (!isPluginSurfaceId('file-history') || !isPluginEnabled('file-history')) { setNotice({ text: 'File history is off · turn its plugin on in Plugins' }); return }
    setOverlay(current => current ? { ...current, surface: 'file-history', path } : current)
  }, [])
  return <>
    {notice && <div role="status" style={{ position: 'fixed', bottom: 18, left: '50%', transform: 'translateX(-50%)', zIndex: 80, background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, padding: 12 }}>{notice.text}</div>}
    {overlay && <PluginSurfaceHost surfaceId={overlay.surface} placement="overlay" sessionKey={null} cwd={overlay.cwd ?? undefined} path={overlay.path ?? null} services={{ session: { session: overlay.session }, 'file-history': { open: openFileHistory }, ...(sessionTabs ? { 'session-tabs': sessionTabs } : {}), ...(sessionFleet ? { 'session-fleet': sessionFleet } : {}), ...(insertText ? { composer: { insertText } } : {}), ...(openSession ? { 'session-navigation': { open: openSession } } : {}), ...(overlay.cwd ? { repository: { cwd: overlay.cwd, sessionId: null } } : {}) }} onClose={close} />}
  </>
}
