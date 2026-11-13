'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '../../lib/types'
import { sessionIdentityKey } from '../../lib/sessionIdentity'
import { useApplicationPlugins } from '../../lib/plugins/useApplicationPlugins'
import { pluginRuntimeActivity } from '../../lib/plugins/runtimeActivity'
import { getPluginCommand, isPluginSurfaceId, type PluginSurfaceId } from '../../lib/plugins/catalog'
import { subscribePluginCommands } from '../../lib/plugins/commandBus'
import { isPluginEnabled } from '../../lib/plugins/enablement'
import type { PluginApplicationServices } from '../../lib/plugins/application'
import { webApplicationPlugins } from './applicationPlugins'
import PluginSurfaceHost from './PluginSurfaceHost'
import { usePluginCommands } from '../../lib/plugins/usePluginCommands'
import { webPluginCommands } from './pluginCommands'

/** The Web shell adapter for app events and capability sinks. Contains no feature policy. */
export function ApplicationPluginHost({ sessions, selectedSession, cwd = null }: { sessions: readonly Session[]; selectedSession: Session | null; cwd?: string | null }) {
  const [notice, setNotice] = useState<{ text: string } | null>(null)
  const [overlay, setOverlay] = useState<{ surface: PluginSurfaceId; cwd: string | null; session: Session | null } | null>(null)
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
    if (command.handler && command.scope === 'repository') {
      if (!cwd) return false
      void executeRepositoryCommand(id, { session: selectedSession, cwd }, { notices: { show: (_kind, text) => setNotice({ text }) } })
        .catch(error => { if (!(error instanceof Error && error.name === 'AbortError')) setNotice({ text: error instanceof Error ? error.message : 'Plugin command failed' }) })
      return true
    }
    if (command.webDashboard || command.webReader) return false
    if (command.scope !== 'application' && command.scope !== 'repository') return false
    if (command.scope === 'repository' && !cwd) return false
    if (command.handler) {
      void executeCommand(id, { session: null, cwd: null }, { notices: { show: (_kind, text) => setNotice({ text }) } })
        .catch(error => { if (!(error instanceof Error && error.name === 'AbortError')) setNotice({ text: error instanceof Error ? error.message : 'Plugin command failed' }) })
      return true
    }
    if (!isPluginSurfaceId(command.opens)) return false
    setOverlay({ surface: command.opens, cwd: command.scope === 'repository' ? cwd : null, session: selectedSession ? { ...selectedSession } : null })
    return true
  }), [executeCommand, executeRepositoryCommand, cwd, selectedSession])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 6000)
    return () => window.clearTimeout(timer)
  }, [notice])
  const close = useCallback(() => setOverlay(null), [])
  return <>
    {notice && <div role="status" style={{ position: 'fixed', bottom: 18, right: 18, zIndex: 80, background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, padding: 12 }}>{notice.text}</div>}
    {overlay && <PluginSurfaceHost surfaceId={overlay.surface} placement="overlay" sessionKey={null} cwd={overlay.cwd ?? undefined} services={{ session: { session: overlay.session }, ...(overlay.cwd ? { repository: { cwd: overlay.cwd, sessionId: null } } : {}) }} onClose={close} />}
  </>
}
