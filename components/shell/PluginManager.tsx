'use client'

// The plugin manager: every bundled feature plugin, what it adds, and a switch.
// Host code, not a plugin. The choice is saved through /api/plugins into the
// same file the TUI reads, so turning Git off here turns it off there too.
import { useModDiagnostics } from '../../lib/plugins/useModDiagnostics'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Puzzle, Search, X } from 'lucide-react'
import { filterPluginManagerEntries, matchesPluginSearch, PLUGIN_ENABLEMENT_FILTERS, type PluginEnablementFilter } from '@/lib/plugins/managerSearch'
import { allPluginManifests, localPluginsVersion, subscribeLocalPlugins } from '@/lib/plugins/catalog'
import { isLocalManifest } from '@/lib/plugins/localManifest'
import { webLocalPluginReport } from './localPlugins'
import { applyPluginSettings, decodePluginSettings } from '@/lib/plugins/enablement'
import { useDisabledPlugins } from '@/lib/plugins/useDisabledPlugins'
import { PROVIDER_PLUGINS, type ProviderPlugin } from '@/lib/plugins/providerPlugins'
import type { PluginManifest } from '@/lib/plugins/types'
import { readJsonResponse } from '@/lib/httpResponse'

const RENDERER_LABELS = { tui: 'TUI', web: 'Web' } as const

export default function PluginManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const diagnostics = useModDiagnostics()
  const disabled = useDisabledPlugins()
  useSyncExternalStore(subscribeLocalPlugins, localPluginsVersion, localPluginsVersion)
  const localReport = webLocalPluginReport()
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<PluginEnablementFilter>('all')
  const search = useRef<HTMLInputElement>(null)
  const entries = [...allPluginManifests(), ...PROVIDER_PLUGINS]
  const matches = filterPluginManagerEntries(entries, query, filter, disabled)
  const refused = localReport?.refused.filter(entry => filter === 'all' && matchesPluginSearch(query, [entry.id, entry.dir, 'local mod not loaded', ...entry.problems]))
    .sort((a, b) => (a.id ?? a.dir).localeCompare(b.id ?? b.dir)) ?? []

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement
    search.current?.focus()
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  const toggle = useCallback(async (manifest: { id: string }, enabled: boolean) => {
    setSaving(manifest.id)
    setError(null)
    try {
      const response = await fetch('/api/plugins', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: manifest.id, enabled }),
      })
      applyPluginSettings(decodePluginSettings(await readJsonResponse<unknown>(response)))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(null)
    }
  }, [])

  if (!open) return null
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '48px 8px 8px' }}>
      <div
        role="dialog"
        aria-label="Plugins"
        data-plugin-manager
        onClick={(event) => event.stopPropagation()}
        style={{ width: 'min(520px, calc(100vw - 16px))', maxHeight: 'calc(100vh - 64px)', background: 'var(--surface)', border: '1px solid var(--border-2)', borderRadius: 12, boxShadow: '0 24px 60px rgba(0,0,0,0.45)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>
          <Puzzle size={18} style={{ color: 'var(--violet)' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, color: 'var(--text)' }}>Plugins</div>
            <div style={{ fontSize: 12, color: 'var(--text-2)' }}>Turn features on or off here and in the terminal app.</div>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} style={{ color: 'var(--text-2)', background: 'none', border: 0, cursor: 'pointer' }}><X size={16} /></button>
        </div>
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Search size={15} aria-hidden="true" style={{ color: 'var(--text-2)', flexShrink: 0 }} />
            <input ref={search} type="search" aria-label="Search plugins" placeholder="Search plugins, providers, commands…" value={query}
              onChange={event => setQuery(event.target.value)}
              style={{ flex: 1, minWidth: 0, background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border-2)', borderRadius: 6, padding: '7px 8px', fontSize: 12 }} />
            {query ? <button type="button" aria-label="Clear plugin search" onClick={() => setQuery('')} style={{ color: 'var(--text-2)', background: 'none', border: 0, cursor: 'pointer' }}><X size={14} /></button> : null}
          </div>
          <div role="group" aria-label="Filter plugins" style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            {PLUGIN_ENABLEMENT_FILTERS.map(option => <button key={option.id} type="button" aria-pressed={filter === option.id} onClick={() => setFilter(option.id)}
              style={{ border: '1px solid var(--border-2)', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer', background: filter === option.id ? 'var(--violet)' : 'transparent', color: filter === option.id ? 'var(--surface)' : 'var(--text-2)' }}>{option.label}</button>)}
          </div>
          <div role="status" style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 6 }}>{matches.length + refused.length} of {entries.length + (localReport?.refused.length ?? 0)} plugins</div>
        </div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 8, overflowY: 'auto' }}>
          {matches.length === 0 && refused.length === 0 ? <li style={{ padding: '16px 8px', color: 'var(--text-2)', fontSize: 12 }}>No matching plugins.</li> : null}
          {matches.map((manifest: PluginManifest | ProviderPlugin) => {
            const enabled = !disabled.has(manifest.id)
            const switchId = `plugin-switch-${manifest.id}`
            return (
              <li key={manifest.id} data-plugin-row={manifest.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 8px', borderRadius: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <label htmlFor={switchId} style={{ fontWeight: 600, color: enabled ? 'var(--text)' : 'var(--text-2)', cursor: 'pointer' }}>{manifest.title}</label>
                  <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>{manifest.description}</div>
                  {diagnostics.filter(entry => entry.pluginId === manifest.id).slice(-3).map(entry => <div key={`${entry.contribution}:${entry.message}`} role="status" style={{ fontSize: 12, color: 'var(--red, #e5484d)' }}>{entry.contribution}: {entry.message}</div>)}
                  <div style={{ fontSize: 11, color: 'var(--text-3, var(--text-2))', marginTop: 4 }}>
                    {'renderers' in manifest && isLocalManifest(manifest)
                      ? `Local mod · ${[manifest.behavior ? manifest.behavior.hooks.join(' + ') : null, ...manifest.commands.map(command => command.label)].filter(Boolean).join(', ')}`
                      : 'renderers' in manifest
                      ? `${manifest.renderers.map(renderer => RENDERER_LABELS[renderer]).join(' · ')}${manifest.commands.length ? ` · ${manifest.commands.map(command => command.label).join(', ')}` : ''}`
                      : 'Provider'}
                  </div>
                </div>
                <button
                  id={switchId}
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  disabled={saving === manifest.id}
                  onClick={() => { void toggle(manifest, !enabled) }}
                  style={{ flexShrink: 0, width: 40, height: 22, borderRadius: 11, border: '1px solid var(--border-2)', background: enabled ? 'var(--violet)' : 'var(--surface-3)', position: 'relative', cursor: 'pointer', opacity: saving === manifest.id ? 0.6 : 1 }}
                >
                  <span style={{ position: 'absolute', top: 2, left: enabled ? 20 : 2, width: 16, height: 16, borderRadius: 8, background: 'var(--surface)', transition: 'left 120ms' }} />
                </button>
              </li>
            )
          })}
          {refused.map(entry => (
            <li key={`refused:${entry.dir}`} data-plugin-refused={entry.id ?? entry.dir} style={{ padding: '10px 8px' }}>
              <div style={{ fontWeight: 600, color: 'var(--text)' }}>{entry.id ?? entry.dir} <span style={{ color: 'var(--red, #e5484d)', fontWeight: 400 }}>not loaded</span></div>
              <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>{entry.problems.join('; ')}</div>
            </li>
          ))}
          {localReport?.dir ? <li style={{ padding: '8px', fontSize: 11, color: 'var(--text-3, var(--text-2))' }}>Local mods: {localReport.dir}</li> : null}
        </ul>
        {error ? <div role="alert" style={{ padding: '8px 16px 12px', fontSize: 12, color: 'var(--red, #e5484d)' }}>Could not save: {error}</div> : null}
      </div>
    </div>
  )
}
