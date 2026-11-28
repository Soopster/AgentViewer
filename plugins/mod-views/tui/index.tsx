/** @jsxImportSource @opentui/react */
// TUI entry for Mod views. Keys: ←/→ or Tab switch view, ↑/↓ or j/k select a
// row or button, Enter runs it, r refreshes, Esc closes. Rows and buttons are
// clickable too.
import { recordModDiagnostic } from '../../../lib/plugins/modDiagnostics'
import React, { useEffect, useState } from 'react'
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import { modViewActionables } from '../../../lib/plugins/modViews'
import { useModView } from '../../../lib/plugins/useModView'
import { fitText, MODAL_CONTENT_Z_INDEX, popoverFrameCells, popoverRootProps, type TuiPluginView, type TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'

class ComponentBoundary extends React.Component<{ pluginId?: string; name: string; color: string; children: React.ReactNode }, { failed: Error | null }> {
  state = { failed: null as Error | null }
  static getDerivedStateFromError(failed: Error) { return { failed } }
  componentDidCatch(error: Error) { recordModDiagnostic(this.props.pluginId ?? this.props.name, 'component-render', error) }
  render() { return this.state.failed ? <text fg={this.props.color}>{`${this.props.name} failed: ${this.state.failed.message}`}</text> : this.props.children }
}

function PortableInput({ value, placeholder, focused, submit }: { value: string; placeholder?: string; focused: boolean; submit: (value: string) => void }) {
  const [draft, setDraft] = useState(value)
  return <input focused={focused} value={draft} maxLength={4000} placeholder={placeholder} onInput={setDraft} onSubmit={() => submit(draft)} />
}

function ModViews(props: TuiPluginViewProps) { return <ModViewPanel {...props} fixedKey={null} /> }

function ModViewPanel({ theme, accent, width, height, placement, registerKeys, setCapture, focused, close, services, useState: useScopedState, fixedKey }: TuiPluginViewProps & { fixedKey: string | null }) {
  const [chosenKey, setChosenKey] = useScopedState<string | null>('view', null)
  const selectedKey = fixedKey ?? chosenKey
  const setSelectedKey = (key: string) => { if (!fixedKey) setChosenKey(key) }
  const view = useModView(selectedKey)
  const [editing, setEditing] = useState<number | null>(null)
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [cursor, setCursor] = useState(0)
  const [notice, setNotice] = useState<{ kind: 'info' | 'error'; text: string } | null>(null)
  useEffect(() => {
    setCapture?.(editing !== null && focused ? 'input' : false)
    return () => setCapture?.(false)
  }, [editing, focused, setCapture])
  const actionables = view.content ? modViewActionables(view.content) : []
  const docked = placement !== 'overlay'
  const act = async (action: string, item?: string) => {
    if (view.busy) return
    const result = await view.run(action, item)
    setNotice(result)
    if (result && services.notices) services.notices.show(result.kind, result.text)
  }
  const switchView = (step: number) => {
    if (!view.views.length) return
    const index = Math.max(0, view.views.findIndex(entry => `${entry.pluginId}:${entry.viewId}` === view.key))
    const next = view.views[(index + step + view.views.length) % view.views.length]!
    setSelectedKey(`${next.pluginId}:${next.viewId}`)
    setCursor(0)
    setEditing(null)
  }
  const componentKeys = React.useRef<((key: { name: string; sequence: string; ctrl: boolean; shift: boolean }) => boolean | void) | null>(null)
  useEffect(() => {
    registerKeys((key) => {
      // A mod component sees keys first; returning true keeps one.
      if (view.selected?.component && componentKeys.current?.(key) === true) return true
      if (editing !== null) {
        if (key.name === 'escape') { setEditing(null); return true }
        return false
      }
      const current = actionables[cursor]
      if (current?.type === 'select' && (key.name === 'left' || key.name === 'right')) {
        const choiceKey = `${view.key}:${current.id}`
        const index = Math.max(0, current.options.findIndex(option => option.value === (choices[choiceKey] ?? current.value)))
        const option = current.options[(index + (key.name === 'left' ? -1 : 1) + current.options.length) % current.options.length]!
        setChoices(previous => ({ ...previous, [choiceKey]: option.value }))
        return true
      }
      if (key.name === 'escape' || key.sequence === 'q') { close(); return true }
      if (!fixedKey && (key.name === 'tab' || key.name === 'right' || key.name === 'left')) { switchView(key.name === 'left' || key.shift ? -1 : 1); return true }
      if (key.name === 'down' || key.sequence === 'j') { setCursor(value => Math.min(value + 1, Math.max(actionables.length - 1, 0))); return true }
      if (key.name === 'up' || key.sequence === 'k') { setCursor(value => Math.max(value - 1, 0)); return true }
      if (key.sequence === 'r') { view.refresh(); return true }
      if (key.name === 'return') {
        if (view.busy) return true
        const target = actionables[cursor]
        if (target?.type === 'input') setEditing(target.index)
        else if (target) void act(target.action!, target.type === 'select' ? choices[`${view.key}:${target.id}`] ?? target.value : target.type === 'item' ? target.id : undefined)
        return true
      }
      return placement === 'overlay'
    })
    return () => registerKeys(null)
  })

  const frame = popoverFrameCells(docked)
  const popW = docked ? width : Math.min(width - 4, 96)
  const popH = docked ? height : Math.min(height - 2, 36)
  const innerW = popW - frame - 2
  const selectedIndex = actionables[cursor]?.index
  const tabs = (fixedKey ? view.views.filter(entry => `${entry.pluginId}:${entry.viewId}` === fixedKey) : view.views).map(entry => {
    const active = `${entry.pluginId}:${entry.viewId}` === view.key
    return { key: `${entry.pluginId}:${entry.viewId}`, label: active ? `● ${entry.title}` : `○ ${entry.title}`, active }
  })
  return (
    <box
      id={fixedKey ? `mod-view:${fixedKey}` : 'mod-views'}
      {...popoverRootProps(docked, { top: Math.max(Math.floor((height - popH) / 2), 0), left: Math.max(Math.floor((width - popW) / 2), 0), width: popW, height: popH }, MODAL_CONTENT_Z_INDEX)}
      {...(docked ? {} : { border: true, borderStyle: 'single' as const, borderColor: theme.border2 })}
      backgroundColor={theme.surface}
      flexDirection="column"
      title={docked ? undefined : fixedKey ? ` ${view.selected?.title ?? 'Mod view'} ` : ' Mod views '}
      titleColor={accent}
    >
      <box paddingX={1} flexDirection="row" backgroundColor={theme.surface2}>
        {tabs.length === 0 ? <text fg={theme.dim}>no mod provides a view</text> : tabs.map(tab => (
          <box key={tab.key} paddingRight={2} onMouseDown={() => { setSelectedKey(tab.key); setCursor(0) }}>
            <text fg={tab.active ? accent : theme.dim} wrapMode="none" selectable={false}>{tab.label}</text>
          </box>
        ))}
      </box>
      <scrollbox height={Math.max(popH - frame - 3, 3)} scrollY backgroundColor={theme.surface}>
        <box paddingX={1} flexDirection="column">
          {view.error ? <text fg={theme.red} wrapMode="word" width={innerW}>{view.error}</text>
            : view.selected?.component ? (view.component
              ? <ComponentBoundary key={view.key ?? ''} name={view.selected.title} pluginId={view.selected.pluginId} color={theme.red}>{React.createElement(view.component as React.ComponentType<Record<string, unknown>>, {
                  view: view.selected, app: view.app, close, React, theme, width: innerW, height: Math.max(popH - frame - 3, 3),
                  run: async (action: string, item?: string) => { const result = await view.run(action, item); setNotice(result); return result },
                  registerKeys: (handler: typeof componentKeys.current) => { componentKeys.current = handler },
                })}</ComponentBoundary>
              : <text fg={theme.dim}>Loading…</text>)
            : !view.content ? <text fg={theme.dim}>{view.views.length ? 'Loading…' : 'A mod declares views in its plugin.json and returns each from its server module.'}</text>
            : [<text key="title" fg={theme.text} wrapMode="none">{fitText(view.content.title, innerW)}</text>,
              ...view.content.blocks.map((block, index) => {
                const selected = index === selectedIndex
                if (block.type === 'heading') return <text key={index} fg={theme.cyan} wrapMode="none">{fitText(`┄ ${block.text}`, innerW)}</text>
                if (block.type === 'text') return <text key={index} fg={block.tone === 'error' ? theme.red : block.tone === 'warning' ? theme.amber : block.tone === 'success' ? theme.green : block.tone === 'default' ? theme.text : theme.muted} wrapMode="word" width={innerW}>{block.text}</text>
                if (block.type === 'progress') {
                  const filled = Math.round(20 * block.value / block.max)
                  return <text key={index} fg={theme.cyan} wrapMode="word" width={innerW}>{`${block.label} [${'#'.repeat(filled)}${'-'.repeat(20 - filled)}] ${Math.round(100 * block.value / block.max)}%`}</text>
                }
                if (block.type === 'code') return <text key={index} fg={theme.text} wrapMode="word" width={innerW}>{block.text}</text>
                if (block.type === 'table') {
                  const cellWidth = Math.max(1, Math.floor(innerW / block.columns.length) - 1)
                  const rowText = (row: readonly string[]) => row.map(cell => fitText(cell, cellWidth).padEnd(cellWidth)).join(' ')
                  return <box key={index} flexDirection="column"><text fg={theme.cyan}>{rowText(block.columns)}</text>{block.rows.map((row, i) => <text key={i} fg={theme.text}>{rowText(row)}</text>)}</box>
                }
                if (block.type === 'input') return <box key={`${view.key}:${block.id}`} flexDirection="column" onMouseDown={() => { setCursor(actionables.findIndex(entry => entry.index === index)); setEditing(index) }}>
                  <text fg={selected ? accent : theme.text}>{`${selected ? '▎' : ' '}${block.label}${editing === index ? ' (enter to apply, esc to cancel)' : ' (enter to edit)'}`}</text>
                  {editing === index ? <PortableInput focused={focused} value={block.value ?? ''} placeholder={block.placeholder} submit={value => { setEditing(null); void act(block.action, value) }} /> : <text fg={theme.muted}>{block.value || block.placeholder || ' '}</text>}
                </box>
                if (block.type === 'select') {
                  const value = choices[`${view.key}:${block.id}`] ?? block.value
                  return <box key={index} onMouseDown={() => { setCursor(actionables.findIndex(entry => entry.index === index)); const n = block.options.findIndex(option => option.value === value); setChoices(previous => ({ ...previous, [`${view.key}:${block.id}`]: block.options[(n + 1) % block.options.length]!.value })) }}><text fg={selected ? accent : theme.text}>{`${selected ? '▎' : ' '}${block.label}: ${block.options.find(option => option.value === value)?.label ?? ''} (left/right choose, enter apply)`}</text></box>
                }
                const run = () => { const position = actionables.findIndex(entry => entry.index === index); if (position >= 0) setCursor(position); void act(block.action!, block.type === 'item' ? block.id : undefined) }
                if (block.type === 'button') {
                  return (
                    <box key={index} id={`mod-view-action:${block.action}`} flexDirection="row" backgroundColor={selected ? theme.surface3 : theme.surface} onMouseDown={run}>
                      <text fg={selected ? accent : theme.cyan} wrapMode="none" selectable={false}>{fitText(`${selected ? '▎' : ' '}[ ${block.label} ]`, innerW)}</text>
                    </box>
                  )
                }
                return (
                  <box key={index} id={`mod-view-item:${block.id ?? index}`} flexDirection="row" backgroundColor={selected ? theme.surface3 : theme.surface} onMouseDown={block.action ? run : undefined}>
                    <text wrapMode="none" selectable={false}>
                      <span fg={theme.cyan}>{selected ? '▎' : ' '}</span>
                      <span fg={block.action ? theme.text : theme.muted}>{block.label}</span>
                      <span fg={theme.dim}>{block.detail ? `  ${block.detail}` : ''}</span>
                    </text>
                  </box>
                )
              })]}
        </box>
      </scrollbox>
      <box paddingX={1} backgroundColor={theme.surface2}>
        <text fg={notice?.kind === 'error' ? theme.red : theme.dim} wrapMode="none">{fitText(notice?.text ?? (view.busy ? 'running…' : fixedKey ? 'j/k select · ⏎ run · r refresh · esc' : '←→ view · j/k select · ⏎ run · r refresh · esc'), innerW)}</text>
      </box>
    </box>
  )
}

/** A mod's own surfaces, each pinned to one of its views. The host loads this for a mod like a built-in's module. */
export function modViewSurfaces(manifest: { readonly id: string; readonly surfaces: readonly { readonly id: string }[] }): PluginViewModule<TuiPluginView> {
  const views: Record<string, TuiPluginView> = {}
  for (const surface of manifest.surfaces) {
    const fixedKey = surface.id.replace('.', ':')
    const View = (props: TuiPluginViewProps) => <ModViewPanel {...props} fixedKey={fixedKey} />
    View.displayName = `ModView(${surface.id})`
    views[surface.id] = View
  }
  return { apiVersion: PLUGIN_API_VERSION, pluginId: manifest.id, views }
}

export const module: PluginViewModule<TuiPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'mod-views',
  views: { 'mod-views': ModViews },
}
