/** @jsxImportSource @opentui/react */
import { useEffect, useState } from 'react'
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import type { IdeId } from '../../../lib/ideCatalog'
import { effectiveIde } from '../../../lib/plugins/openInIde'
import { popoverRootProps, fitText, type TuiPluginView, type TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'
import { ideController, useIde } from '../store'

type Row = { id: IdeId; label: string; detail: string; available: boolean }

function Picker({ services, theme, width, height, placement, registerKeys, close, focused }: TuiPluginViewProps) {
  const controller = ideController(services['open-in-ide']!)
  const { state, error } = useIde(controller)
  const [cursor, setCursor] = useState(0)
  const [notice, setNotice] = useState('')
  useEffect(() => { void controller.refresh() }, [controller])
  const current = effectiveIde(state, 'tui')
  const rows: Row[] = [
    { id: 'builtin', label: 'Built-in editor', detail: 'the project editor in this terminal', available: true },
    ...(state?.detected ?? []).map(choice => ({ id: choice.id, label: choice.label, detail: 'installed', available: true })),
    ...(state?.editor ? [{ id: 'editor' as const, label: '$VISUAL / $EDITOR', detail: state.editor.terminal ? `${state.editor.command} · a terminal editor, so it cannot open from here` : state.editor.command, available: !state.editor.terminal }] : []),
  ]
  const pick = (row: Row | undefined) => {
    if (!row) return
    if (!row.available) { setNotice(`${row.label} cannot be opened from here.`); return }
    void controller.choose(row.id).then(() => setNotice(`Files now open in ${row.label}.`)).catch(cause => setNotice(cause instanceof Error ? cause.message : String(cause)))
  }
  useEffect(() => {
    registerKeys(key => {
      if (!focused || key.ctrl || key.meta || key.option) return false
      switch (key.name) {
        case 'escape': close(); return true
        case 'down': case 'j': setCursor(value => Math.min(rows.length - 1, value + 1)); return true
        case 'up': case 'k': setCursor(value => Math.max(0, value - 1)); return true
        case 'return': case 'space': pick(rows[cursor]); return true
      }
      return false
    })
    return () => registerKeys(null)
  })

  const overlay = placement === 'overlay'
  const w = overlay ? Math.max(1, Math.min(width - 4, 72)) : width
  const extra = state && !state.detected.length ? 2 : 0
  const h = overlay ? Math.max(1, Math.min(height - 4, rows.length + 6 + extra)) : height
  const inner = Math.max(1, w - (overlay ? 4 : 2))
  const message = error ?? notice
  return <box {...popoverRootProps(!overlay, { top: 2, left: Math.max(0, Math.floor((width - w) / 2)), width: w, height: h }, 50)}
    {...(overlay ? { border: true, borderColor: theme.border2, title: ' Open files in ' } : {})} backgroundColor={theme.surface} flexDirection="column" paddingX={1}>
    <text fg={theme.muted} wrapMode="none">{fitText('Transcript links, Engineering, Files and changed files open here, at the line.', inner)}</text>
    {rows.map((row, index) => {
      const selected = index === cursor
      return <text key={row.id} wrapMode="none" fg={!row.available ? theme.dim : selected ? theme.cyan : theme.text} onMouseDown={() => { setCursor(index); pick(row) }}>
        <span fg={selected ? theme.cyan : theme.dim}>{selected ? '› ' : '  '}</span>
        <span fg={row.id === current ? theme.green : theme.dim}>{row.id === current ? '✓ ' : '  '}</span>
        {fitText(row.label, 20).padEnd(20)}<span fg={theme.muted}>{fitText(`  ${row.detail}`, Math.max(1, inner - 24))}</span>
      </text>
    })}
    {extra ? <text fg={theme.muted} wrapMode="word">No GUI editor found on PATH. In VS Code: ⇧⌘P “Shell Command: Install ‘code’ command”; Cursor and Windsurf have the same.</text> : null}
    {message ? <text fg={error ? theme.red : theme.muted} wrapMode="none">{fitText(message, inner)}</text> : null}
    <text fg={theme.dim} wrapMode="none">{fitText('j/k move · ⏎ choose · Esc close', inner)}</text>
  </box>
}

export const module: PluginViewModule<TuiPluginView> = { apiVersion: PLUGIN_API_VERSION, pluginId: 'open-in-ide', views: { 'open-in-ide': Picker } }
