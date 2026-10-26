/** @jsxImportSource @opentui/react */
// The plugin manager: every bundled feature plugin, what it adds, and whether
// it is on. Host code, not a plugin — turning plugins off must not depend on one.
// The choice is written to .agent-viewer-data/plugins.json, which the web daemon
// reads too, and applied at once: a plugin turned off closes its overlay and
// its commands stop being offered.
import { useEffect, useRef, useState } from 'react'
import type { ScrollBoxRenderable } from '@opentui/core'
import { PLUGIN_MANIFESTS } from '../../lib/plugins/catalog'
import { applyPluginSettings, readPluginSettings, withPluginEnabled } from '../../lib/plugins/enablement'
import { useDisabledPlugins } from '../../lib/plugins/useDisabledPlugins'
import type { PluginManifest } from '../../lib/plugins/types'
import { writePluginSettingsFile } from '../../lib/plugins/settingsFile'
import { MODAL_CONTENT_Z_INDEX } from './layers'
import type { TuiThemePalette } from '../theme'

type Key = { name: string; ctrl: boolean; shift: boolean; sequence: string }

export type PluginManagerPopoverProps = {
  theme: TuiThemePalette
  width: number
  height: number
  onClose: () => void
  onKeyHandlerReady: (handler: (key: Key) => void) => void
  onNotice: (tone: 'info' | 'error', text: string) => void
}

const RENDERER_LABELS = { tui: 'TUI', web: 'Web' } as const

function pluginSummary(manifest: PluginManifest): string {
  const renderers = manifest.renderers.map(renderer => RENDERER_LABELS[renderer]).join(' · ')
  const commands = manifest.commands.map(command => (command.tuiKeyLabel ? `${command.tuiKeyLabel} ${command.label}` : command.label)).join(', ')
  return `${renderers}${commands ? ` · ${commands}` : ''}`
}

export function PluginManagerPopover({ theme, width, height, onClose, onKeyHandlerReady, onNotice }: PluginManagerPopoverProps) {
  const manifests = PLUGIN_MANIFESTS as readonly PluginManifest[]
  const disabled = useDisabledPlugins()
  const [cursor, setCursor] = useState(0)
  const scroll = useRef<ScrollBoxRenderable>(null)
  useEffect(() => {
    const timer = setTimeout(() => scroll.current?.scrollChildIntoView(`plugin-row:${manifests[cursor]?.id}`), 0)
    return () => clearTimeout(timer)
  }, [cursor, height, width])
  const toggle = (manifest: PluginManifest) => {
    const enabled = disabled.has(manifest.id)
    const next = withPluginEnabled(readPluginSettings(), manifest.id, enabled)
    try {
      writePluginSettingsFile(next)
    } catch (error) {
      onNotice('error', `Could not save plugin settings: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    applyPluginSettings(next)
    onNotice('info', `${manifest.title} ${enabled ? 'on' : 'off'}`)
  }
  useEffect(() => {
    onKeyHandlerReady((key) => {
      if (key.name === 'escape' || key.sequence === 'q') { onClose(); return }
      if (key.name === 'down' || key.sequence === 'j') setCursor(index => Math.min(manifests.length - 1, index + 1))
      else if (key.name === 'up' || key.sequence === 'k') setCursor(index => Math.max(0, index - 1))
      else if (key.name === 'pagedown') setCursor(index => Math.min(manifests.length - 1, index + Math.max(1, Math.floor((height - 6) / 3))))
      else if (key.name === 'pageup') setCursor(index => Math.max(0, index - Math.max(1, Math.floor((height - 6) / 3))))
      else if (key.name === 'home') setCursor(0)
      else if (key.name === 'end') setCursor(manifests.length - 1)
      else if (key.name === 'space' || key.sequence === ' ' || key.name === 'return') toggle(manifests[cursor]!)
    })
  })

  const panelWidth = Math.min(Math.max(width - 6, 40), 76)
  // Allow descriptions and command summaries to wrap inside the scroll area.
  const panelHeight = Math.min(height - 2, manifests.length * 3 + 4)
  const footer = '↑↓ move · wheel scroll · space toggle · esc close'
  const footerRows = Math.ceil(footer.length / Math.max(1, panelWidth - 4))
  return (
    <box
      id="plugin-manager"
      position="absolute"
      top={Math.max(1, Math.floor((height - panelHeight) / 3))}
      left={Math.max(1, Math.floor((width - panelWidth) / 2))}
      width={panelWidth}
      height={panelHeight}
      zIndex={MODAL_CONTENT_Z_INDEX}
      border
      borderStyle="rounded"
      borderColor={theme.border2}
      backgroundColor={theme.bg}
      title=" Plugins "
      flexDirection="column"
      paddingX={1}
    >
      <scrollbox id="plugin-manager-scroll" ref={scroll} height={Math.max(1, panelHeight - 2 - footerRows)} flexShrink={0} scrollY viewportCulling>
      {manifests.map((manifest, index) => {
        const on = !disabled.has(manifest.id)
        const selected = index === cursor
        return (
          <box key={manifest.id} id={`plugin-row:${manifest.id}`} flexDirection="column" flexShrink={0} backgroundColor={selected ? theme.surface2 : undefined} onMouseDown={event => { if (event.button === 0) { event.stopPropagation(); setCursor(index); toggle(manifest) } }}>
            <text width="100%" wrapMode="word" selectable={false}>
              <span fg={on ? theme.green : theme.dim}>{on ? '●' : '○'} </span>
              <span fg={theme.text}>{manifest.title}</span>
              <span fg={on ? theme.green : theme.muted}>{on ? '  on' : '  off'}</span>
            </text>
            <text fg={theme.muted} width="100%" wrapMode="word" selectable={false}>{`  ${manifest.description}`}</text>
            <text fg={theme.dim} width="100%" wrapMode="word" selectable={false}>{`  ${pluginSummary(manifest)}`}</text>
          </box>
        )
      })}
      </scrollbox>
      <text height={footerRows} flexShrink={0} fg={theme.muted} wrapMode="word" selectable={false}>{footer}</text>
    </box>
  )
}
