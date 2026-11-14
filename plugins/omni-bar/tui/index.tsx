/** @jsxImportSource @opentui/react */
import { useEffect, useState } from 'react'
import { PLUGIN_API_VERSION, type PluginViewModule, type PluginWidgetModule } from '../../../lib/plugins/types'
import type { GitSummary } from '../../../lib/gitProvider'
import { fitText, MODAL_CONTENT_Z_INDEX, type TuiPluginView, type TuiPluginViewProps, type TuiPluginWidget, type TuiPluginWidgetProps } from '../../../tui/opentui/shell/sdk'
import { availableActions, overviewSegments, runOmniAction } from '../model'

export function OmniBar({ services, theme, width }: TuiPluginWidgetProps) {
  const overview = services?.['shell-overview']
  const cwd = overview?.snapshot.cwd ?? ''
  const readGit = overview?.readGit
  const [gitState, setGit] = useState<{ cwd: string; summary: GitSummary | null } | null>(null)
  const [now, setNow] = useState(Date.now)
  const running = overview?.snapshot.running ?? false
  const startedAt = overview?.snapshot.startedAt ?? null
  useEffect(() => {
    if (!cwd || !readGit) return
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      try {
        const summary = await readGit(cwd)
        if (live) setGit(previous => previous?.cwd === cwd && JSON.stringify(previous.summary) === JSON.stringify(summary) ? previous : { cwd, summary })
      } catch { /* A directory without Git still has workspace context. */ }
      finally { if (live) timer = setTimeout(() => { void refresh() }, 5_000) }
    }
    void refresh()
    return () => { live = false; clearTimeout(timer) }
  }, [cwd, readGit])
  useEffect(() => {
    if (!running || startedAt === null) return
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [running, startedAt])
  if (!overview) return null
  const segments = overviewSegments(overview.snapshot, gitState?.cwd === cwd ? gitState.summary : null, width, now, overview.commands?.ids)
  // Keep attention and command access intact; the repository/activity share the rest.
  const right = segments.filter(segment => segment.action !== 'repository' && segment.action !== 'session')
  const rightWidth = right.reduce((sum, item) => sum + item.text.length + 2, 0)
  const contextWidth = Math.max(0, width - rightWidth)
  const leftCount = segments.length - right.length
  return <box id="omni-bar" width={width} height={1} flexShrink={0} flexDirection="row" backgroundColor={theme.surface2} overflow="hidden">
    {segments.map((segment, index) => {
      const cells = index < leftCount ? Math.floor(contextWidth / leftCount) + (index === 0 ? contextWidth % leftCount : 0) : Math.min(width, segment.text.length + 2)
      return <box key={segment.action} id={`omni-bar:${segment.action}`} width={cells} height={1} flexShrink={0}
        onMouseDown={event => { if (event.button === 0) { event.stopPropagation(); runOmniAction(overview, segment.action) } }}>
        <text fg={segment.action === 'attention' && overview.snapshot.attentionCount ? theme.amber : segment.action === 'commands' ? theme.cyan : theme.text} wrapMode="none" selectable={false}>{fitText(` ${segment.text} `, cells)}</text>
      </box>
    })}
  </box>
}

export function OmniActions({ services, theme, width, height, registerKeys, close }: TuiPluginViewProps) {
  const overview = services['shell-overview']
  const actions = overview ? availableActions(overview) : []
  const [cursor, setCursor] = useState(0)
  const selected = Math.min(cursor, Math.max(0, actions.length - 1))
  const activate = (index: number) => {
    const action = actions[index]
    if (overview && action) { close(); runOmniAction(overview, action.id) }
  }
  useEffect(() => {
    registerKeys(key => {
      if (key.name === 'escape') { close(); return true }
      if (key.name === 'down' || key.sequence === 'j') { setCursor((selected + 1) % Math.max(1, actions.length)); return true }
      if (key.name === 'up' || key.sequence === 'k') { setCursor((selected + actions.length - 1) % Math.max(1, actions.length)); return true }
      if (key.name === 'return') { activate(selected); return true }
      return true
    })
    return () => registerKeys(null)
  })
  const popWidth = Math.max(1, Math.min(width - 2, 56))
  const popHeight = Math.min(height, actions.length + 3)
  const visibleRows = Math.max(0, popHeight - 3)
  const start = Math.max(0, selected - visibleRows + 1)
  return <box id="omni-bar-actions" position="absolute" top={Math.max(0, Math.floor((height - popHeight) / 2))} left={Math.max(0, Math.floor((width - popWidth) / 2))}
    width={popWidth} height={popHeight} zIndex={MODAL_CONTENT_Z_INDEX} border borderStyle="single" borderColor={theme.border2} backgroundColor={theme.surface} flexDirection="column" overflow="hidden" title=" Omni bar actions ">
    {actions.slice(start, start + visibleRows).map((action, offset) => {
      const index = start + offset
      return <box key={action.id} height={1} flexShrink={0} backgroundColor={selected === index ? theme.surface2 : theme.surface}
      onMouseDown={event => { if (event.button === 0) { event.stopPropagation(); activate(index) } }}>
      <text fg={selected === index ? theme.cyan : theme.text} wrapMode="none" selectable={false}>{fitText(` ${selected === index ? '›' : ' '} ${action.label}`, popWidth - 2)}</text>
      </box>
    })}
    <text fg={theme.dim} wrapMode="none">{fitText(' ↑↓ select · Enter open · Esc close', popWidth - 2)}</text>
  </box>
}

export const widgets: PluginWidgetModule<TuiPluginWidget> = {
  apiVersion: PLUGIN_API_VERSION, pluginId: 'omni-bar', widgets: { overview: OmniBar },
}
export const module: PluginViewModule<TuiPluginView> = {
  apiVersion: PLUGIN_API_VERSION, pluginId: 'omni-bar', views: { 'omni-bar-actions': OmniActions },
}
