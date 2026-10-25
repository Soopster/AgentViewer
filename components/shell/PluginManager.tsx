'use client'

// The plugin manager: every bundled feature plugin, what it adds, and a switch.
// Host code, not a plugin. The choice is saved through /api/plugins into the
// same file the TUI reads, so turning Git off here turns it off there too.
import { useCallback, useEffect, useState } from 'react'
import { Puzzle, X } from 'lucide-react'
import { PLUGIN_MANIFESTS } from '@/lib/plugins/catalog'
import { applyPluginSettings, decodePluginSettings } from '@/lib/plugins/enablement'
import { useDisabledPlugins } from '@/lib/plugins/useDisabledPlugins'
import type { PluginManifest } from '@/lib/plugins/types'
import { readJsonResponse } from '@/lib/httpResponse'

const RENDERER_LABELS = { tui: 'TUI', web: 'Web' } as const

export default function PluginManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const disabled = useDisabledPlugins()
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  const toggle = useCallback(async (manifest: PluginManifest, enabled: boolean) => {
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
        <ul style={{ listStyle: 'none', margin: 0, padding: 8, overflowY: 'auto' }}>
          {(PLUGIN_MANIFESTS as readonly PluginManifest[]).map((manifest) => {
            const enabled = !disabled.has(manifest.id)
            const switchId = `plugin-switch-${manifest.id}`
            return (
              <li key={manifest.id} data-plugin-row={manifest.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 8px', borderRadius: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <label htmlFor={switchId} style={{ fontWeight: 600, color: enabled ? 'var(--text)' : 'var(--text-2)', cursor: 'pointer' }}>{manifest.title}</label>
                  <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>{manifest.description}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3, var(--text-2))', marginTop: 4 }}>
                    {manifest.renderers.map(renderer => RENDERER_LABELS[renderer]).join(' · ')}
                    {manifest.commands.length ? ` · ${manifest.commands.map(command => command.label).join(', ')}` : ''}
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
        </ul>
        {error ? <div role="alert" style={{ padding: '8px 16px 12px', fontSize: 12, color: 'var(--red, #e5484d)' }}>Could not save: {error}</div> : null}
      </div>
    </div>
  )
}
