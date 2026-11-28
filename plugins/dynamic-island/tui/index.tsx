/** @jsxImportSource @opentui/react */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { PLUGIN_API_VERSION, type PluginViewModule, type PluginWidgetModule } from '../../../lib/plugins/types'
import { tuiActivityFeed as feed } from '../../../lib/plugins/activityFeed'
import { useObservedTranscripts } from '../../../lib/plugins/observedTranscripts'
import type { ActivityInput } from '../../../lib/plugins/activityFeed'
import { useActivityActions } from '../useActivityActions'
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
  const actions = useActivityActions({ feed, notifications: tuiNotifications, control: services['activity-control'], navigation: services['session-navigation'], close })
  const { status } = actions
  const selected = Math.min(cursor, Math.max(0, items.length - 1))
  const popWidth = Math.max(1, Math.min(width - 2, 84))
  const inner = Math.max(0, popWidth - 2)
  const move = (index: number) => { setCursor(Math.max(0, Math.min(items.length - 1, index))); actions.disarm() }
  useEffect(() => {
    registerKeys(key => {
      const item = items[selected]
      const pressed = key.shift && key.sequence?.length === 1 ? key.sequence.toUpperCase() : key.sequence
      const button = item && !key.ctrl && pressed ? actions.buttons(item).find(entry => entry.key === pressed) : undefined
      if (key.name === 'escape') { if (actions.armed) actions.disarm(); else close() }
      else if (button) button.press()
      // Enter only ever opens, so one stray key cannot approve.
      else if (key.name === 'return' || key.sequence === 'o') actions.open(item)
      else if (key.name === 'down') move(selected + 1)
      else if (key.name === 'up') move(selected - 1)
      else if (key.name === 'delete' || key.name === 'backspace' || key.sequence === 'd') { if (item) actions.dismiss(item) }
      else actions.disarm()
      return true
    })
    return () => registerKeys(null)
  })
  // The selected row's buttons, wrapped to the panel.
  const current = items[selected]
  const buttons = !current ? [] : [
    ...actions.buttons(current).map(button => ({ id: button.id, tone: button.armed ? 'danger' as const : button.tone, press: button.press,
      label: toBmpSafe(button.armed ? `${button.key} again: ${button.label}` : button.id === 'open' ? `⏎ ${button.label}` : button.key ? `${button.key} ${button.label}` : button.label) })),
    { id: 'dismiss', tone: undefined, label: 'd Dismiss', press: () => actions.dismiss(current) },
  ]
  const lines: (typeof buttons)[] = []
  let used = inner
  for (const button of buttons) {
    const size = Math.min(inner - 3, button.label.length + 2) + 1
    if (used + size > inner - 3) { lines.push([]); used = 0 }
    lines[lines.length - 1]!.push(button); used += size
  }
  // Two lines a row, plus the selected row's buttons, inside a frame and a footer.
  const rows = Math.max(1, Math.floor((height - 4 - lines.length) / 2))
  const start = Math.max(0, selected - rows + 1)
  const visible = items.slice(start, start + rows)
  return <box id="activity-island-expanded" position="absolute" top={Math.min(1, Math.max(0, height - 1))} left={Math.max(0, Math.floor((width - popWidth) / 2))}
    width={popWidth} height={Math.min(height, Math.max(5, visible.length * 2 + lines.length + 3))} zIndex={MODAL_CONTENT_Z_INDEX}
    border borderStyle="rounded" borderColor={theme.border2} backgroundColor={theme.surface} flexDirection="column" overflow="hidden" title={` Activity · ${items.length} `}>
    {items.length === 0 ? <text fg={theme.dim}> All quiet.</text> : null}
    {visible.map((item, index) => {
      const active = start + index === selected
      return <box key={item.id} height={2 + (active ? lines.length : 0)} flexShrink={0} flexDirection="column" backgroundColor={active ? theme.surface2 : theme.surface}
        onMouseDown={event => { if (event.button === 0) { event.stopPropagation(); if (active) actions.open(item); else move(start + index) } }}>
        <text fg={item.status === 'error' ? theme.red : item.status === 'needs-input' ? theme.amber : theme.text} wrapMode="none" selectable={false}>{fitText(toBmpSafe(` ${active ? '›' : ' '} ${item.title}`), inner)}</text>
        <text fg={theme.dim} wrapMode="none" selectable={false}>{fitText(toBmpSafe(`   ${item.status}${item.progress !== undefined ? ` ${Math.round(item.progress * 100)}%` : ''}${item.detail ? ` · ${item.detail.replace(/\s+/g, ' ')}` : ''}`), inner)}</text>
        {active ? lines.map((line, row) => <box key={row} height={1} flexShrink={0} flexDirection="row" paddingLeft={3}>
          {line.map(button => <box key={button.id} id={`activity-action-${button.id}`} flexShrink={0} flexDirection="row" marginRight={1} backgroundColor={theme.surface}
            onMouseDown={event => { if (event.button === 0) { event.stopPropagation(); button.press() } }}>
            <text fg={button.tone === 'danger' ? theme.red : button.tone === 'primary' ? theme.cyan : theme.text} wrapMode="none" selectable={false}>{` ${button.label.length > inner - 6 ? fitText(button.label, Math.max(1, inner - 6)) : button.label} `}</text>
          </box>)}
        </box>) : null}
      </box>
    })}
    <text fg={status ? (status.failed ? theme.red : theme.green) : theme.dim} wrapMode="none" selectable={false}>{fitText(status ? ` ${status.text}` : actions.armed ? ' Press again to confirm · Esc cancels' : ' ↑↓ select · Esc close', inner)}</text>
  </box>
}

export const widgets: PluginWidgetModule<TuiPluginWidget> = { apiVersion: PLUGIN_API_VERSION, pluginId: 'dynamic-island', widgets: { island: IslandWidget } }
export const module: PluginViewModule<TuiPluginView> = { apiVersion: PLUGIN_API_VERSION, pluginId: 'dynamic-island', views: { 'activity-island': IslandSurface } }
