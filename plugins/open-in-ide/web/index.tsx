'use client'
import { useEffect, useState } from 'react'
import type { WebPluginView, WebPluginViewProps } from '@/components/shell/pluginTypes'
import { PLUGIN_API_VERSION, type PluginViewModule } from '@/lib/plugins/types'
import type { IdeId } from '@/lib/ideCatalog'
import { effectiveIde } from '@/lib/plugins/openInIde'
import { ideController, useIde } from '../store'

type Row = { id: IdeId; label: string; detail: string; available: boolean }

function Picker({ services }: WebPluginViewProps) {
  const controller = ideController(services['open-in-ide']!)
  const { state, error } = useIde(controller)
  const [notice, setNotice] = useState('')
  useEffect(() => { void controller.refresh() }, [controller])
  const current = effectiveIde(state, 'web')
  // The web has no editor of its own, so the built-in choice is not offered here.
  const rows: Row[] = [
    ...(state?.detected ?? []).map(choice => ({ id: choice.id, label: choice.label, detail: 'installed', available: true })),
    ...(state?.editor ? [{ id: 'editor' as const, label: '$VISUAL / $EDITOR', detail: state.editor.terminal ? `${state.editor.command} — runs in a terminal, so a browser cannot open it` : state.editor.command, available: !state.editor.terminal }] : []),
  ]
  const pick = (row: Row) => {
    if (!row.available) return
    void controller.choose(row.id).then(() => setNotice(`Files now open in ${row.label}.`)).catch(cause => setNotice(cause instanceof Error ? cause.message : String(cause)))
  }
  return <div className="flex h-full min-h-0 flex-col gap-3 p-4" style={{ minWidth: 360 }}>
    <header className="flex flex-col gap-1">
      <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>Open files in</h2>
      <p style={{ fontSize: 12, color: 'var(--text-3)' }}>Click a file path in a transcript to open it here, at the line.</p>
    </header>
    <div role="radiogroup" aria-label="Editor" className="flex flex-col gap-1">
      {rows.map(row => <button key={row.id} type="button" role="radio" aria-checked={row.id === current} disabled={!row.available} onClick={() => pick(row)}
        className="flex items-center gap-2 rounded px-2 py-1.5 text-left disabled:opacity-50"
        style={{ fontSize: 13, color: 'var(--text)', background: row.id === current ? 'var(--surface-2)' : 'transparent', border: '1px solid var(--border)' }}>
        <span style={{ width: 14, color: 'var(--green, #3fb950)' }}>{row.id === current ? '✓' : ''}</span>
        <span style={{ fontWeight: 500 }}>{row.label}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-3)' }}>{row.detail}</span>
      </button>)}
      {state && !rows.length ? <p style={{ fontSize: 12, color: 'var(--text-3)' }}>No editor found on PATH. In VS Code run “Shell Command: Install ‘code’ command in PATH” (Cursor and Windsurf have the same command).</p> : null}
    </div>
    {error || notice ? <p style={{ fontSize: 12, color: error ? 'var(--red, #f85149)' : 'var(--text-3)' }}>{error ?? notice}</p> : null}
  </div>
}

export const module: PluginViewModule<WebPluginView> = { apiVersion: PLUGIN_API_VERSION, pluginId: 'open-in-ide', views: { 'open-in-ide': Picker } }
