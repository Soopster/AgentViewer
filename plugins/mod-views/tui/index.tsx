/** @jsxImportSource @opentui/react */
// TUI entry for Mod views. Keys: ←/→ or Tab switch view, ↑/↓ or j/k select a
// row or button, Enter runs it, r refreshes, Esc closes. Rows and buttons are
// clickable too.
import { useEffect, useState } from 'react'
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import { modViewActionables } from '../../../lib/plugins/modViews'
import { useModView } from '../../../lib/plugins/useModView'
import { fitText, MODAL_CONTENT_Z_INDEX, popoverFrameCells, popoverRootProps, type TuiPluginView, type TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'

function ModViews({ theme, accent, width, height, placement, registerKeys, close, services, useState: useScopedState }: TuiPluginViewProps) {
  const [selectedKey, setSelectedKey] = useScopedState<string | null>('view', null)
  const view = useModView(selectedKey)
  const [cursor, setCursor] = useState(0)
  const [notice, setNotice] = useState<{ kind: 'info' | 'error'; text: string } | null>(null)
  const actionables = view.content ? modViewActionables(view.content) : []
  const docked = placement !== 'overlay'
  const act = async (action: string, item?: string) => {
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
  }
  useEffect(() => {
    registerKeys((key) => {
      if (key.name === 'escape' || key.sequence === 'q') { close(); return true }
      if (key.name === 'tab' || key.name === 'right' || key.name === 'left') { switchView(key.name === 'left' || key.shift ? -1 : 1); return true }
      if (key.name === 'down' || key.sequence === 'j') { setCursor(value => Math.min(value + 1, Math.max(actionables.length - 1, 0))); return true }
      if (key.name === 'up' || key.sequence === 'k') { setCursor(value => Math.max(value - 1, 0)); return true }
      if (key.sequence === 'r') { view.refresh(); return true }
      if (key.name === 'return') {
        const target = actionables[cursor]
        if (target) void act(target.action!, target.type === 'item' ? target.id : undefined)
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
  const tabs = view.views.map(entry => {
    const active = `${entry.pluginId}:${entry.viewId}` === view.key
    return { key: `${entry.pluginId}:${entry.viewId}`, label: active ? `● ${entry.title}` : `○ ${entry.title}`, active }
  })
  return (
    <box
      id="mod-views"
      {...popoverRootProps(docked, { top: Math.max(Math.floor((height - popH) / 2), 0), left: Math.max(Math.floor((width - popW) / 2), 0), width: popW, height: popH }, MODAL_CONTENT_Z_INDEX)}
      {...(docked ? {} : { border: true, borderStyle: 'single' as const, borderColor: theme.border2 })}
      backgroundColor={theme.surface}
      flexDirection="column"
      title={docked ? undefined : ' Mod views '}
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
            : !view.content ? <text fg={theme.dim}>{view.views.length ? 'Loading…' : 'A mod declares views in its plugin.json and returns each from its server module.'}</text>
            : [<text key="title" fg={theme.text} wrapMode="none">{fitText(view.content.title, innerW)}</text>,
              ...view.content.blocks.map((block, index) => {
                const selected = index === selectedIndex
                if (block.type === 'heading') return <text key={index} fg={theme.cyan} wrapMode="none">{fitText(`┄ ${block.text}`, innerW)}</text>
                if (block.type === 'text') return <text key={index} fg={block.tone === 'error' ? theme.red : block.tone === 'warning' ? theme.amber : block.tone === 'success' ? theme.green : block.tone === 'default' ? theme.text : theme.muted} wrapMode="word" width={innerW}>{block.text}</text>
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
        <text fg={notice?.kind === 'error' ? theme.red : theme.dim} wrapMode="none">{fitText(notice?.text ?? (view.busy ? 'running…' : '←→ view · j/k select · ⏎ run · r refresh · esc'), innerW)}</text>
      </box>
    </box>
  )
}

export const module: PluginViewModule<TuiPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'mod-views',
  views: { 'mod-views': ModViews },
}
