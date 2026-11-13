'use client'

// Web entry for Mod views: its own chunk, loaded on first open.
import React, { useEffect, useState } from 'react'
import { PLUGIN_API_VERSION, type PluginViewModule } from '@/lib/plugins/types'
import type { WebPluginView, WebPluginViewProps } from '@/components/shell/pluginTypes'
import { useModView } from '@/lib/plugins/useModView'

const TONE: Record<string, string> = { default: 'var(--text)', muted: 'var(--text-2)', success: 'var(--green, #3fb950)', warning: 'var(--amber, #d29922)', error: 'var(--red, #f85149)' }

class ComponentBoundary extends React.Component<{ name: string; children: React.ReactNode }, { failed: Error | null }> {
  state = { failed: null as Error | null }
  static getDerivedStateFromError(failed: Error) { return { failed } }
  render() { return this.state.failed ? <div role="alert" style={{ color: TONE.error }}>{this.props.name} failed: {this.state.failed.message}</div> : this.props.children }
}

function ModViews({ placement, close, useState: useScopedState }: WebPluginViewProps) {
  const [selectedKey, setSelectedKey] = useScopedState<string | null>('view', null)
  const view = useModView(selectedKey)
  const [notice, setNotice] = useState<{ kind: 'info' | 'error'; text: string } | null>(null)
  const docked = placement !== 'overlay'
  useEffect(() => {
    if (docked) return undefined
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [docked, close])
  const act = async (action: string, item?: string) => setNotice(await view.run(action, item))

  const body = (
    <div data-plugin-view="mod-views" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--surface)', color: 'var(--text)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, marginRight: 6 }}>Mod views</span>
        {view.views.map(entry => {
          const key = `${entry.pluginId}:${entry.viewId}`
          const active = key === view.key
          return <button key={key} type="button" aria-pressed={active} onClick={() => setSelectedKey(key)}
            style={{ fontSize: 12, padding: '3px 10px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${active ? 'var(--border-2)' : 'var(--border)'}`, background: active ? 'var(--surface-3)' : 'transparent', color: active ? 'var(--text)' : 'var(--text-2)', fontWeight: active ? 600 : 400 }}>{entry.title}</button>
        })}
        <span style={{ flex: 1 }} />
        {view.selected ? <button type="button" onClick={view.refresh} style={{ fontSize: 12 }}>Refresh</button> : null}
        {!docked ? <button type="button" aria-label="Close" onClick={close} style={{ fontSize: 12 }}>✕</button> : null}
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '10px 16px', fontSize: 13, lineHeight: 1.55 }}>
        {!view.views.length ? <div style={{ color: 'var(--text-2)' }}>No mod provides a view. A mod declares <code>views</code> in its plugin.json and returns each from its server module.</div>
          : view.error ? <div role="alert" style={{ color: TONE.error }}>{view.error}</div>
          : view.selected?.component ? (view.component
            ? <ComponentBoundary key={view.key ?? ''} name={view.selected.title}>{React.createElement(view.component as React.ComponentType<Record<string, unknown>>, { view: view.selected, run: async (action: string, item?: string) => { const result = await view.run(action, item); setNotice(result); return result }, close, React })}</ComponentBoundary>
            : <div style={{ color: 'var(--text-2)' }}>Loading…</div>)
          : !view.content ? <div style={{ color: 'var(--text-2)' }}>Loading…</div>
          : <>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>{view.content.title}</div>
            {view.content.blocks.map((block, index) => {
              if (block.type === 'heading') return <div key={index} style={{ fontWeight: 600, marginTop: 10, color: 'var(--text)' }}>{block.text}</div>
              if (block.type === 'text') return <div key={index} style={{ color: TONE[block.tone ?? 'muted'], whiteSpace: 'pre-wrap' }}>{block.text}</div>
              if (block.type === 'button') return <button key={index} type="button" disabled={view.busy} data-mod-view-action={block.action} onClick={() => { void act(block.action) }} style={{ margin: '6px 6px 0 0', fontSize: 12 }}>{block.label}</button>
              const clickable = Boolean(block.action)
              return (
                <div key={index} role={clickable ? 'button' : undefined} tabIndex={clickable ? 0 : undefined} data-mod-view-item={block.id ?? block.label}
                  onClick={clickable ? () => { void act(block.action!, block.id) } : undefined}
                  onKeyDown={clickable ? (event) => { if (event.key === 'Enter') void act(block.action!, block.id) } : undefined}
                  style={{ display: 'flex', gap: 10, padding: '4px 6px', borderRadius: 6, cursor: clickable ? 'pointer' : 'default' }}
                  className={clickable ? 'av-hover-control' : undefined}>
                  <span style={{ color: 'var(--text)' }}>{block.label}</span>
                  {block.detail ? <span style={{ color: 'var(--text-2)' }}>{block.detail}</span> : null}
                </div>
              )
            })}
          </>}
      </div>
      {notice ? <div role="status" style={{ padding: '8px 14px', borderTop: '1px solid var(--border)', fontSize: 12, color: notice.kind === 'error' ? TONE.error : 'var(--text-2)' }}>{notice.text}</div> : null}
    </div>
  )
  if (docked) return body
  return (
    <div role="dialog" aria-label="Mod views" onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)' }}>
      <div onClick={event => event.stopPropagation()} style={{ width: 'min(760px, calc(100vw - 32px))', height: 'min(640px, calc(100vh - 48px))', border: '1px solid var(--border-2)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 16px 48px var(--shadow, rgba(0,0,0,0.3))' }}>
        {body}
      </div>
    </div>
  )
}

export const module: PluginViewModule<WebPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'mod-views',
  views: { 'mod-views': ModViews },
}
