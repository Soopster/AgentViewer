'use client'

import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { WebPluginView, WebPluginViewProps, WebPluginWidget } from '../../../components/shell/pluginTypes'
import { PLUGIN_API_VERSION, type PluginViewModule, type PluginWidgetModule } from '../../../lib/plugins/types'
import { webActivityFeed as feed, type ActivityStatus } from '../../../lib/plugins/activityFeed'
import { useObservedTranscripts } from '../../../lib/plugins/observedTranscripts'
import { taskActivities } from '../taskActivities'
import { webNotifications } from '../../../lib/plugins/notifications'
import { useActivitySource } from '../../../lib/plugins/useActivityFeed'
import { useExpandedActivity } from '../../../lib/plugins/useActivityFeed'
import { dispatchPluginCommand } from '../../../lib/plugins/commandBus'
import './island.css'

const STATUS: Record<ActivityStatus, string> = { 'needs-input': 'Needs input', running: 'Running', waiting: 'Waiting', error: 'Error', success: 'Done', info: 'Update' }

function IslandWidget() {
  const items = useSyncExternalStore(feed.subscribe, feed.getSnapshot, feed.getServerSnapshot)
  useEffect(() => feed.claimPresentation(), [])
  const notices = useSyncExternalStore(webNotifications.subscribe, webNotifications.getSnapshot, webNotifications.getServerSnapshot)
  useActivitySource(feed, 'notifications', notices.map(item => ({ ...item, id: `notification:${item.id}`, source: 'notifications' })))
  const transcripts = useObservedTranscripts('web')
  const lastTaskUpdate = useRef(0)
  useEffect(() => {
    // Keep a fixed deadline during a stream so updates cannot starve the summary.
    const timer = setTimeout(() => {
      lastTaskUpdate.current = Date.now()
      feed.replaceSource('background-tasks', taskActivities(transcripts))
    }, Math.max(0, 200 - (Date.now() - lastTaskUpdate.current)))
    return () => clearTimeout(timer)
  }, [transcripts])
  const first = items[0]
  if (!first) return null
  return <button type="button" className="activity-island-pill" data-activity-status={first.status}
    aria-label={`Open activity island: ${first.title}, ${items.length} activities`} aria-haspopup="dialog"
    onClick={() => dispatchPluginCommand('activity-island')}>
    <span className="activity-island-dot" aria-hidden="true" />
    <span className="activity-island-title">{first.title}</span>
    <span className="activity-island-count">{items.length > 1 ? `+${items.length - 1}` : STATUS[first.status]}</span>
  </button>
}

function IslandSurface({ services, close }: WebPluginViewProps) {
  const items = useExpandedActivity(feed)
  useEffect(() => webNotifications.hold(), [])
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const node = dialog.current
    const previous = document.activeElement
    const outside = (event: MouseEvent) => { if (event.target === node) close() }
    node?.addEventListener('click', outside)
    node?.showModal()
    return () => { node?.removeEventListener('click', outside); node?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [close])
  return <dialog ref={dialog} className="activity-island-dialog" aria-label="Activity island"
    onCancel={event => { event.preventDefault(); close() }}>
    <section className="activity-island-panel">
      <header><strong>Activity</strong><span>{items.length}</span><button type="button" autoFocus onClick={close} aria-label="Close activity island">×</button></header>
      {items.length === 0 ? <p className="activity-island-empty">All quiet. New activity will appear here.</p> : null}
      <ul>{items.map(item => <li key={item.id} data-activity-status={item.status}>
        <span className="activity-island-dot" aria-hidden="true" />
        <div className="activity-island-body">
          <div className="activity-island-row-title">{item.title}</div>
          <div className="activity-island-detail">{STATUS[item.status]}{item.detail && item.detail !== STATUS[item.status] ? ` · ${item.detail}` : ''}</div>
          {item.progress !== undefined ? <progress aria-label={`${item.title} progress`} value={item.progress} max={1} /> : null}
          {item.target && services['session-navigation'] ? <button type="button" onClick={() => { close(); services['session-navigation']!.open(item.target!, item.messageUuid) }}>Open session</button> : null}
        </div>
        <button type="button" className="activity-island-dismiss" aria-label={`Dismiss ${item.title}`} onClick={() => feed.dismiss(item.id)}>×</button>
      </li>)}</ul>
    </section>
  </dialog>
}

export const widgets: PluginWidgetModule<WebPluginWidget> = { apiVersion: PLUGIN_API_VERSION, pluginId: 'dynamic-island', widgets: { island: IslandWidget } }
export const module: PluginViewModule<WebPluginView> = { apiVersion: PLUGIN_API_VERSION, pluginId: 'dynamic-island', views: { 'activity-island': IslandSurface } }
