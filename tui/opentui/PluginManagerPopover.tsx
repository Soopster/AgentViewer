/** @jsxImportSource @opentui/react */
// The plugin manager: every bundled feature plugin, what it adds, and whether
// it is on. Host code, not a plugin — turning plugins off must not depend on one.
// The choice is written to .agent-viewer-data/plugins.json, which the web daemon
// reads too, and applied at once: a plugin turned off closes its overlay and
// its commands stop being offered.
import { useEffect, useRef, useState } from 'react'
import type { ScrollBoxRenderable } from '@opentui/core'
import { allPluginManifests } from '../../lib/plugins/catalog'
import { filterPluginManagerEntries, matchesPluginSearch, PLUGIN_ENABLEMENT_FILTERS, type PluginEnablementFilter } from '../../lib/plugins/managerSearch'
import { isLocalManifest } from '../../lib/plugins/localManifest'
import { localPluginDiscovery } from '../../lib/plugins/localPlugins'
import { applyPluginSettings, readPluginSettings, withPluginEnabled } from '../../lib/plugins/enablement'
import { useDisabledPlugins } from '../../lib/plugins/useDisabledPlugins'
import { PROVIDER_PLUGINS, isProviderPluginId, wouldDisableEveryProvider, type ProviderPlugin } from '../../lib/plugins/providerPlugins'
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

function pluginSummary(manifest: PluginManifest | ProviderPlugin): string {
  if (!('renderers' in manifest)) return 'Provider'
  if (isLocalManifest(manifest)) {
    const parts = [manifest.behavior ? manifest.behavior.hooks.join(' + ') : null, ...manifest.commands.map(command => (command.tuiChord ? `⌃K ${command.tuiChord.key} ${command.label}` : command.label))].filter(Boolean)
    return `Local mod · ${parts.join(', ')}`
  }
  const renderers = manifest.renderers.map(renderer => RENDERER_LABELS[renderer]).join(' · ')
  const commands = manifest.commands.map(command => (command.tuiKeyLabel ? `${command.tuiKeyLabel} ${command.label}` : command.label)).join(', ')
  return `${renderers}${commands ? ` · ${commands}` : ''}`
}

export function PluginManagerPopover({ theme, width, height, onClose, onKeyHandlerReady, onNotice }: PluginManagerPopoverProps) {
  const manifests: readonly (PluginManifest | ProviderPlugin)[] = [...allPluginManifests(), ...PROVIDER_PLUGINS]
  const local = localPluginDiscovery()
  const disabled = useDisabledPlugins()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<PluginEnablementFilter>('all')
  const [searching, setSearching] = useState(false)
  const matches = filterPluginManagerEntries(manifests, query, filter, disabled)
  const refused = local.refused.filter(entry => filter === 'all' && matchesPluginSearch(query, [entry.id, entry.dir, 'local mod not loaded', ...entry.problems]))
    .sort((a, b) => (a.id ?? a.dir).localeCompare(b.id ?? b.dir))
  const [cursor, setCursor] = useState(0)
  const selectedIndex = Math.min(cursor, Math.max(0, matches.length - 1))
  const selectedId = matches[selectedIndex]?.id
  const scroll = useRef<ScrollBoxRenderable>(null)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (selectedId) scroll.current?.scrollChildIntoView(`plugin-row:${selectedId}`)
      else scroll.current?.scrollTo(0)
    }, 0)
    return () => clearTimeout(timer)
  }, [selectedId, query, filter, height, width])
  const toggle = (manifest: PluginManifest | ProviderPlugin) => {
    const enabled = disabled.has(manifest.id)
    const next = withPluginEnabled(readPluginSettings(), manifest.id, enabled)
    if (isProviderPluginId(manifest.id) && wouldDisableEveryProvider(new Set(next.disabled))) {
      onNotice('error', 'At least one provider must stay on')
      return
    }
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
      if (searching) {
        if (key.name === 'escape' || key.name === 'return' || key.name === 'tab') { setSearching(false); return }
        if (key.ctrl && key.name === 'u') { setQuery(''); setCursor(0); return }
        if (key.name === 'backspace') { setQuery(value => Array.from(value).slice(0, -1).join('')); setCursor(0); return }
        if (!key.ctrl && key.sequence && !/[\x00-\x1f\x7f]/.test(key.sequence)) { setQuery(value => value + key.sequence); setCursor(0) }
        return
      }
      if (key.name === 'escape' || key.sequence === 'q') { onClose(); return }
      const option = PLUGIN_ENABLEMENT_FILTERS[Number(key.sequence) - 1]
      if (option && /^[123]$/.test(key.sequence)) { setFilter(option.id); setCursor(0); return }
      if (key.sequence === '/') { setSearching(true); return }
      if (key.ctrl && key.name === 'u') { setQuery(''); setCursor(0); return }
      if (key.name === 'down' || key.sequence === 'j') setCursor(Math.min(Math.max(0, matches.length - 1), selectedIndex + 1))
      else if (key.name === 'up' || key.sequence === 'k') setCursor(Math.max(0, selectedIndex - 1))
      else if (key.name === 'pagedown') setCursor(Math.min(Math.max(0, matches.length - 1), selectedIndex + Math.max(1, Math.floor((height - 9) / 3))))
      else if (key.name === 'pageup') setCursor(Math.max(0, selectedIndex - Math.max(1, Math.floor((height - 9) / 3))))
      else if (key.name === 'home') setCursor(0)
      else if (key.name === 'end') setCursor(Math.max(0, matches.length - 1))
      else if (key.name === 'space' || key.sequence === ' ' || key.name === 'return') { const manifest = matches[selectedIndex]; if (manifest) toggle(manifest) }
    })
  })

  const panelWidth = Math.min(Math.max(width - 6, 40), 76)
  // Allow descriptions and command summaries to wrap inside the scroll area.
  const panelHeight = Math.min(height - 2, (manifests.length + local.refused.length) * 3 + 8)
  const footer = searching ? 'Type to filter · enter browse · ctrl+u clear · esc done' : '/ search · ↑↓ move · space toggle · ctrl+u clear · esc close'
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
      <box height={1} flexShrink={0} backgroundColor={searching ? theme.surface2 : undefined} onMouseDown={event => { if (event.button === 0) { event.stopPropagation(); setSearching(true) } }}>
        <text fg={searching ? theme.cyan : theme.muted} wrapMode="none" selectable={false}>{`Search: ${query || (searching ? '│' : '/ to search plugins')}`}</text>
      </box>
      <box height={1} flexShrink={0} flexDirection="row">
        {PLUGIN_ENABLEMENT_FILTERS.map((option, index) => <box key={option.id} id={`plugin-filter:${option.id}`} height={1} marginRight={1} backgroundColor={filter === option.id ? theme.surface2 : undefined}
          onMouseDown={event => { if (event.button === 0) { event.stopPropagation(); setFilter(option.id); setCursor(0); setSearching(false) } }}>
          <text fg={filter === option.id ? theme.cyan : theme.muted} wrapMode="none" selectable={false}>{`${index + 1} ${option.label}`}</text>
        </box>)}
      </box>
      <text height={1} flexShrink={0} fg={theme.dim} wrapMode="none" selectable={false}>{`${matches.length + refused.length} of ${manifests.length + local.refused.length} plugins`}</text>
      <scrollbox id="plugin-manager-scroll" ref={scroll} height={Math.max(1, panelHeight - 5 - footerRows)} flexShrink={0} scrollY viewportCulling>
      {matches.length === 0 && refused.length === 0 ? <text fg={theme.dim}>No matching plugins.</text> : null}
      {matches.map((manifest, index) => {
        const on = !disabled.has(manifest.id)
        const selected = index === selectedIndex
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
      {refused.map(entry => (
        <box key={`refused:${entry.dir}`} flexDirection="column" flexShrink={0}>
          <text width="100%" wrapMode="word" selectable={false}><span fg={theme.red}>✕ </span><span fg={theme.text}>{entry.id ?? entry.dir}</span><span fg={theme.red}>  not loaded</span></text>
          <text fg={theme.muted} width="100%" wrapMode="word" selectable={false}>{`  ${entry.problems.join('; ')}`}</text>
        </box>
      ))}
      <text fg={theme.dim} width="100%" wrapMode="word" selectable={false}>{`Local mods: ${local.dir}`}</text>
      </scrollbox>
      <text height={footerRows} flexShrink={0} fg={theme.muted} wrapMode="word" selectable={false}>{footer}</text>
    </box>
  )
}
