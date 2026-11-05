import { NextRequest, NextResponse } from 'next/server'
import { PLUGIN_MANIFESTS } from '@/lib/plugins/catalog'
import { applyPluginSettings, withPluginEnabled } from '@/lib/plugins/enablement'
import { isProviderPluginId, PROVIDER_PLUGINS, wouldDisableEveryProvider } from '@/lib/plugins/providerPlugins'
import { readPluginSettingsFile, writePluginSettingsFile } from '@/lib/plugins/settingsFile'

// Which feature plugins are turned off. Shared with the TUI through the same file.
export async function GET() {
  return NextResponse.json(readPluginSettingsFile())
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { id?: unknown; enabled?: unknown }
  const ids = [...PLUGIN_MANIFESTS.map(manifest => manifest.id as string), ...PROVIDER_PLUGINS.map(plugin => plugin.id)]
  if (typeof body.id !== 'string' || !ids.includes(body.id)) {
    return NextResponse.json({ error: `id must be one of: ${ids.join(', ')}` }, { status: 400 })
  }
  if (typeof body.enabled !== 'boolean') return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 })
  try {
    const next = withPluginEnabled(readPluginSettingsFile(), body.id, body.enabled)
    if (isProviderPluginId(body.id) && wouldDisableEveryProvider(new Set(next.disabled))) {
      return NextResponse.json({ error: 'At least one provider must stay on' }, { status: 400 })
    }
    writePluginSettingsFile(next)
    applyPluginSettings(next)
    return NextResponse.json(next)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
