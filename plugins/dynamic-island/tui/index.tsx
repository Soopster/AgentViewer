/** @jsxImportSource @opentui/react */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { PLUGIN_API_VERSION, type PluginViewModule, type PluginWidgetModule } from '../../../lib/plugins/types'
import { tuiActivityFeed as feed } from '../../../lib/plugins/activityFeed'
import { useObservedTranscripts } from '../../../lib/plugins/observedTranscripts'
import type { ActivityInput } from '../../../lib/plugins/activityFeed'
import { tuiWorkerUrl } from '../../../tui/opentui/shell/sdk'
import { getLoadingProviders, getServerLoadingProviders, providerLoadingLabel, subscribeLoadingProviders } from '../../../lib/providerLoading'
import { useRef } from 'react'
import { tuiNotifications } from '../../../lib/plugins/notifications'
import { useActivitySource } from '../../../lib/plugins/useActivityFeed'
import { useExpandedActivity } from '../../../lib/plugins/useActivityFeed'
import { fitText, MODAL_CONTENT_Z_INDEX, type TuiPluginView, type TuiPluginViewProps, type TuiPluginWidget, type TuiPluginWidgetProps } from '../../../tui/opentui/shell/sdk'
import { toBmpSafe } from '../../../tui/opentui/shell/sdk'

function IslandWidget({ theme, width, runCommand }: TuiPluginWidgetProps) {
  const items = useSyncExternalStore(feed.subscribe, feed.getSnapshot, feed.getServerSnapshot)
  useEffect(() => feed.claimPresentation(), [])
  const notices = useSyncExternalStore(tuiNotifications.subscribe, tuiNotifications.getSnapshot, tuiNotifications.getServerSnapshot)
  useActivitySource(feed, 'notifications', notices.map(item => ({ ...item, id: `notification:${item.id}`, source: 'notifications' })))
  const transcripts = useObservedTranscripts('tui')
  const latest = useRef(transcripts)
  const request = useRef<(() => void) | null>(null)
  useEffect(() => {
    let worker: Worker
    try { worker = new Worker(tuiWorkerUrl('plugins/dynamic-island/tui/taskWorker'), { type: 'module' }) }
    catch (error) { console.error('Activity task worker unavailable:', error); return }
    let busy = false
    let dirty = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const send = () => {
      if (busy) { dirty = true; return }
      busy = true; dirty = false; worker.postMessage(latest.current)
    }
    request.current = () => { if (!timer) timer = setTimeout(() => { timer = undefined; send() }, 200) }
    worker.onmessage = (event: MessageEvent<{ items?: ActivityInput[]; error?: string }>) => {
      busy = false
      if (event.data.items) {
        feed.replaceSource('background-tasks', event.data.items)
      }
      if (event.data.error) console.error('Activity task summary failed:', event.data.error)
      if (dirty) request.current?.()
    }
    worker.onerror = event => { busy = false; console.error('Activity task worker failed:', event) }
    send()
    return () => { request.current = null; clearTimeout(timer); worker.onmessage = null; worker.onerror = null; worker.terminate() }
  }, [])
  useEffect(() => { latest.current = transcripts; request.current?.() }, [transcripts])
  const providers = useSyncExternalStore(subscribeLoadingProviders, getLoadingProviders, getServerLoadingProviders)
  useActivitySource(feed, 'provider-startup', providers.map(provider => ({ id: `provider:${provider}`, source: 'provider-startup', title: providerLoadingLabel(provider), status: 'running' })))
  const first = items[0]
  if (!first) return null
  const label = toBmpSafe(` ● ${first.title}${items.length > 1 ? ` +${items.length - 1}` : ''} `)
  const compactWidth = Math.max(1, Math.min(width, Math.max(16, label.length + 2)))
  return <box id="activity-island-compact" width={compactWidth} height={3} border borderStyle="rounded" borderColor={first.status === 'error' ? theme.red : first.status === 'needs-input' ? theme.amber : theme.border}
    backgroundColor={theme.surface} overflow="hidden" onMouseDown={event => { if (event.button === 0) { event.stopPropagation(); runCommand?.('activity-island') } }}>
    <text fg={theme.text} wrapMode="none" selectable={false}>{fitText(label, Math.max(0, compactWidth - 2))}</text>
  </box>
}

function IslandSurface({ services, theme, width, height, registerKeys, close }: TuiPluginViewProps) {
  const items = useExpandedActivity(feed)
  useEffect(() => tuiNotifications.hold(), [])
  const [cursor, setCursor] = useState(0)
  const selected = Math.min(cursor, Math.max(0, items.length - 1))
  const popWidth = Math.max(1, Math.min(width - 2, 64))
  const rows = Math.max(1, Math.floor((height - 6) / 2))
  const start = Math.max(0, selected - rows + 1)
  const visible = items.slice(start, start + rows)
  const open = (index: number) => {
    const item = items[index]
    if (item?.target && services['session-navigation']) { close(); services['session-navigation'].open(item.target, item.messageUuid) }
  }
  useEffect(() => {
    registerKeys(key => {
      if (key.name === 'escape') close()
      else if (key.name === 'down') setCursor(value => Math.min(items.length - 1, value + 1))
      else if (key.name === 'up') setCursor(value => Math.max(0, value - 1))
      else if (key.name === 'return') open(selected)
      else if (key.name === 'delete' || key.name === 'backspace' || key.sequence === 'd') { const item = items[selected]; if (item) feed.dismiss(item.id) }
      return true
    })
    return () => registerKeys(null)
  })
  return <box id="activity-island-expanded" position="absolute" top={Math.min(1, Math.max(0, height - 1))} left={Math.max(0, Math.floor((width - popWidth) / 2))}
    width={popWidth} height={Math.min(height, Math.max(5, visible.length * 2 + 4))} zIndex={MODAL_CONTENT_Z_INDEX}
    border borderStyle="rounded" borderColor={theme.border2} backgroundColor={theme.surface} flexDirection="column" overflow="hidden" title={` Activity · ${items.length} `}>
    {items.length === 0 ? <text fg={theme.dim}> All quiet.</text> : null}
    {visible.map((item, index) => <box key={item.id} height={2} flexShrink={0} flexDirection="column" backgroundColor={start + index === selected ? theme.surface2 : theme.surface}
      onMouseDown={event => { if (event.button === 0) { event.stopPropagation(); setCursor(start + index); open(start + index) } }}>
      <text fg={item.status === 'error' ? theme.red : item.status === 'needs-input' ? theme.amber : theme.text} wrapMode="none" selectable={false}>{fitText(toBmpSafe(` ${start + index === selected ? '›' : ' '} ${item.title}`), popWidth - 2)}</text>
      <text fg={theme.dim} wrapMode="none" selectable={false}>{fitText(toBmpSafe(`   ${item.status}${item.progress !== undefined ? ` ${Math.round(item.progress * 100)}%` : ''}${item.detail ? ` · ${item.detail.replace(/\s+/g, ' ')}` : ''}`), popWidth - 2)}</text>
    </box>)}
    <text fg={theme.dim} wrapMode="none">{fitText(' ↑↓ select · Enter open · d dismiss · Esc close', popWidth - 2)}</text>
  </box>
}

export const widgets: PluginWidgetModule<TuiPluginWidget> = { apiVersion: PLUGIN_API_VERSION, pluginId: 'dynamic-island', widgets: { island: IslandWidget } }
export const module: PluginViewModule<TuiPluginView> = { apiVersion: PLUGIN_API_VERSION, pluginId: 'dynamic-island', views: { 'activity-island': IslandSurface } }
