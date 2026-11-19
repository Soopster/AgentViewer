'use client'

// Web entry for the Omni bar: the same row the TUI draws above its workspace —
// project and branch, the selected session and what it is doing, shortcuts,
// who is running and who needs you — from the same model, over the Web's
// `shell-overview` service. And its actions list, as an overlay.
import { useEffect, useRef, useState } from 'react'
import { PLUGIN_API_VERSION, type PluginViewModule, type PluginWidgetModule } from '@/lib/plugins/types'
import type { WebPluginView, WebPluginViewProps, WebPluginWidget, WebPluginWidgetProps } from '@/components/shell/pluginTypes'
import type { GitSummary } from '@/lib/gitProvider'
import { availableActions, overviewSegments, runOmniAction } from '../model'
import { moveLayoutItem, omniGlyph, omniItemLabel, toggleLayoutItem, useOmniLayout } from '../layout'
import { omniLayoutStore } from './storage'

/** The bar's width in the model's units (characters), from the window. */
function useColumns(): number {
  const measure = () => (typeof window === 'undefined' ? 160 : Math.floor(window.innerWidth / 7.5))
  const [columns, setColumns] = useState(measure)
  useEffect(() => {
    const onResize = () => setColumns(measure())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return columns
}

function OmniBar({ services }: WebPluginWidgetProps) {
  const overview = services?.['shell-overview']
  const layout = useOmniLayout(omniLayoutStore)
  const cwd = overview?.snapshot.cwd ?? ''
  const readGit = overview?.readGit
  const columns = useColumns()
  const [git, setGit] = useState<{ cwd: string; summary: GitSummary | null } | null>(null)
  useEffect(() => {
    if (!cwd || !readGit) return undefined
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      try {
        const summary = await readGit(cwd)
        if (live) setGit(previous => previous?.cwd === cwd && JSON.stringify(previous.summary) === JSON.stringify(summary) ? previous : { cwd, summary })
      } catch { /* a directory without Git still has workspace context */ }
      finally { if (live) timer = setTimeout(() => { void refresh() }, 5_000) }
    }
    void refresh()
    return () => { live = false; clearTimeout(timer) }
  }, [cwd, readGit])
  // A running turn's clock ticks once a second, and only while it runs.
  const [now, setNow] = useState(() => Date.now())
  const running = overview?.snapshot.running ?? false
  const startedAt = overview?.snapshot.startedAt ?? null
  useEffect(() => {
    if (!running || startedAt === null) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running, startedAt])
  if (!overview) return null
  const segments = overviewSegments(overview.snapshot, git?.cwd === cwd ? git.summary : null, columns, now, overview.commands?.ids, layout)
  return (
    <nav id="omni-bar" aria-label="Omni bar" title="Right-click to customize"
      onContextMenu={event => { event.preventDefault(); if (overview.commands?.ids.includes('omni-bar-settings')) overview.commands.run('omni-bar-settings') }} style={{ display: 'flex', alignItems: 'center', gap: 2, height: 28, padding: '0 8px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden' }}>
      {segments.map(segment => {
        const context = segment.action === 'repository' || segment.action === 'session'
        const tone = segment.action === 'attention' && overview.snapshot.attentionCount ? 'var(--amber, #d29922)' : segment.action === 'commands' ? 'var(--cyan, #39c5cf)' : context ? 'var(--text)' : 'var(--text-2)'
        return (
          <button key={segment.action} type="button" data-omni-segment={segment.action} onClick={() => runOmniAction(overview, segment.action)}
            className="av-hover-control"
            style={{ flex: context ? '1 1 0' : '0 0 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'left', border: 'none', background: 'transparent', color: tone, padding: '3px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>
            {segment.text}
          </button>
        )
      })}
    </nav>
  )
}

function OmniActions({ services, close }: WebPluginViewProps) {
  const overview = services['shell-overview']
  const actions = overview ? availableActions(overview) : []
  const [cursor, setCursor] = useState(0)
  const selected = Math.min(cursor, Math.max(0, actions.length - 1))
  const activate = (index: number) => { const action = actions[index]; if (overview && action) { close(); runOmniAction(overview, action.id) } }
  // The keypress that opened this overlay (Enter in the palette) is still on its way to the window
  // when the listener attaches; a key that began before the overlay existed is not for it.
  const openedAt = useRef(typeof performance === 'undefined' ? 0 : performance.now())
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.timeStamp < openedAt.current) return
      if (event.key === 'Escape') close()
      else if (event.key === 'ArrowDown') { event.preventDefault(); setCursor((selected + 1) % Math.max(1, actions.length)) }
      else if (event.key === 'ArrowUp') { event.preventDefault(); setCursor((selected + actions.length - 1) % Math.max(1, actions.length)) }
      else if (event.key === 'Enter') { event.preventDefault(); activate(selected) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  return (
    <div role="dialog" aria-label="Omni bar actions" onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '14vh', background: 'rgba(0,0,0,0.35)' }}>
      <div data-plugin-view="omni-bar-actions" onClick={event => event.stopPropagation()} style={{ width: 'min(440px, calc(100vw - 32px))', background: 'var(--surface)', border: '1px solid var(--border-2)', borderRadius: 10, overflow: 'hidden', boxShadow: '0 16px 48px var(--shadow, rgba(0,0,0,0.3))' }}>
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', fontWeight: 600, fontSize: 13 }}>Omni bar actions</div>
        {actions.map((action, index) => (
          <button key={action.id} type="button" data-omni-action={action.id} onMouseEnter={() => setCursor(index)} onClick={() => activate(index)}
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 12px', border: 'none', background: index === selected ? 'var(--surface-3)' : 'transparent', color: index === selected ? 'var(--cyan, #39c5cf)' : 'var(--text)', cursor: 'pointer', fontSize: 13 }}>
            {index === selected ? '› ' : '  '}{omniGlyph(action.id)} {action.label}
          </button>
        ))}
        <div style={{ padding: '6px 12px', borderTop: '1px solid var(--border)', color: 'var(--text-3)', fontSize: 11 }}>↑↓ select · Enter open · Esc close</div>
      </div>
    </div>
  )
}

function OmniSettings({ close }: WebPluginViewProps) {
  const layout = useOmniLayout(omniLayoutStore)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])
  const small = { border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', borderRadius: 4, padding: '1px 7px', cursor: 'pointer', fontSize: 12 } as const
  return (
    <div role="dialog" aria-label="Customize omni bar" onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '10vh', background: 'rgba(0,0,0,0.35)' }}>
      <div data-plugin-view="omni-bar-settings" onClick={event => event.stopPropagation()} style={{ width: 'min(460px, calc(100vw - 32px))', background: 'var(--surface)', border: '1px solid var(--border-2)', borderRadius: 10, overflow: 'hidden', boxShadow: '0 16px 48px var(--shadow, rgba(0,0,0,0.3))' }}>
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', fontWeight: 600, fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
          Customize omni bar
          <button type="button" onClick={() => omniLayoutStore.reset()} style={small}>Reset</button>
        </div>
        {layout.map((item, index) => (
          <div key={item.id} data-omni-item={item.id} className="av-hover-control" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', opacity: item.enabled ? 1 : 0.55 }}>
            <label style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={item.enabled} onChange={() => omniLayoutStore.set(toggleLayoutItem(layout, index))} />
              {omniGlyph(item.id)} {omniItemLabel(item.id)}
            </label>
            <button type="button" aria-label={`Move ${omniItemLabel(item.id)} earlier`} disabled={index === 0} onClick={() => omniLayoutStore.set(moveLayoutItem(layout, index, -1))} style={small}>↑</button>
            <button type="button" aria-label={`Move ${omniItemLabel(item.id)} later`} disabled={index === layout.length - 1} onClick={() => omniLayoutStore.set(moveLayoutItem(layout, index, 1))} style={small}>↓</button>
          </div>
        ))}
        <div style={{ padding: '6px 12px', borderTop: '1px solid var(--border)', color: 'var(--text-3)', fontSize: 11 }}>Commands… is always shown, last. Esc closes.</div>
      </div>
    </div>
  )
}

export const widgets: PluginWidgetModule<WebPluginWidget> = { apiVersion: PLUGIN_API_VERSION, pluginId: 'omni-bar', widgets: { overview: OmniBar } }
export const module: PluginViewModule<WebPluginView> = { apiVersion: PLUGIN_API_VERSION, pluginId: 'omni-bar', views: { 'omni-bar-actions': OmniActions, 'omni-bar-settings': OmniSettings } }
