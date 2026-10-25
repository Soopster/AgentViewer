import { NextRequest, NextResponse } from 'next/server'
import { PLUGIN_MANIFESTS } from '@/lib/plugins/catalog'
import { withPluginEnabled } from '@/lib/plugins/enablement'
import { readPluginSettingsFile, writePluginSettingsFile } from '@/lib/plugins/settingsFile'

// Which feature plugins are turned off. Shared with the TUI through the same file.
export async function GET() {
  return NextResponse.json(readPluginSettingsFile())
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { id?: unknown; enabled?: unknown }
  if (typeof body.id !== 'string' || !PLUGIN_MANIFESTS.some(manifest => manifest.id === body.id)) {
    return NextResponse.json({ error: `id must be one of: ${PLUGIN_MANIFESTS.map(manifest => manifest.id).join(', ')}` }, { status: 400 })
  }
  if (typeof body.enabled !== 'boolean') return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 })
  try {
    const next = withPluginEnabled(readPluginSettingsFile(), body.id, body.enabled)
    writePluginSettingsFile(next)
    return NextResponse.json(next)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
