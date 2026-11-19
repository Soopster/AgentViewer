'use client'

import { useMemo } from 'react'
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import type { WebPluginView, WebPluginViewProps } from '../../../components/shell/pluginTypes'
import type { ThreadedMessage } from '../../../lib/threading'
import { buildPluginTaskRegistry } from '../domain/registry'
import { TaskRail } from './TaskRail'
import { useTaskPresentation } from './useTaskPresentation'

const NO_MESSAGES: ThreadedMessage[] = []

function TasksSurface(props: WebPluginViewProps) {
  const persisted = props.services['session-transcript']?.threadedMessages ?? NO_MESSAGES
  const live = props.services['live-transcript']
  const registry = useMemo(() => buildPluginTaskRegistry({ persisted, live: live?.messages, todos: live?.todos, plan: live?.plan }), [persisted, live?.messages, live?.todos, live?.plan])
  const presentation = useTaskPresentation(props, registry.size)
  if (!presentation.visible) return null
  const rail = <div aria-busy={presentation.stopping !== null} style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, width: '100%' }}>
    {presentation.error ? <div role="alert" style={{ color: 'var(--red)', padding: '8px 12px', fontSize: 12 }}>{presentation.error}</div> : null}
    {presentation.notice || presentation.stopping ? <div role="status" style={{ color: 'var(--text-2)', padding: '8px 12px', fontSize: 12 }}>{presentation.stopping ? `Stopping task #${presentation.stopping}…` : presentation.notice}</div> : null}
    <TaskRail registry={registry} onJumpToEvent={uuid => { if (presentation.jumpTo(uuid) && props.placement === 'overlay') presentation.closePanel() }}
      onClose={presentation.closePanel} onStopTask={presentation.stopTask} />
  </div>
  if (props.placement !== 'overlay') return rail
  return <div role="dialog" aria-modal="true" aria-label="Tasks"
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); presentation.closePanel() } }}
    style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,0.35)' }}>
    <div style={{ width: 'min(520px, 94vw)', height: 'min(80vh, 760px)' }}>{rail}</div>
  </div>
}

export const module: PluginViewModule<WebPluginView> = {
  apiVersion: PLUGIN_API_VERSION, pluginId: 'tasks', views: { tasks: TasksSurface },
}
