import { decodeModAppSnapshot } from '@/lib/plugins/modApp'
import { NextRequest, NextResponse } from 'next/server'
import { applyPluginSettings } from '@/lib/plugins/enablement'
import { readPluginSettingsFile } from '@/lib/plugins/settingsFile'

// A mod's view, as data, and running one of its actions. The code is the
// daemon's (the user's own mods), so an action is write-scoped.
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const pluginId = url.searchParams.get('plugin') ?? ''
  const viewId = url.searchParams.get('view') ?? ''
  applyPluginSettings(readPluginSettingsFile())
  try {
    const { renderLocalPluginView } = await import('@/lib/plugins/localPluginRuntime')
    return NextResponse.json({ view: await renderLocalPluginView(pluginId, viewId, request.signal) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'View failed' }, { status: 400 })
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { operation?: unknown; app?: unknown; plugin?: unknown; view?: unknown; action?: unknown; item?: unknown }
  if (body.operation === 'render' && typeof body.plugin === 'string' && typeof body.view === 'string') {
    applyPluginSettings(readPluginSettingsFile())
    try {
      const { renderLocalPluginView } = await import('@/lib/plugins/localPluginRuntime')
      return NextResponse.json({ view: await renderLocalPluginView(body.plugin, body.view, request.signal, decodeModAppSnapshot(body.app)) })
    } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'View failed' }, { status: 400 }) }
  }
  if (typeof body.plugin !== 'string' || typeof body.view !== 'string' || typeof body.action !== 'string') {
    return NextResponse.json({ error: 'plugin, view and action are required' }, { status: 400 })
  }
  applyPluginSettings(readPluginSettingsFile())
  try {
    const { runLocalPluginViewAction } = await import('@/lib/plugins/localPluginRuntime')
    return NextResponse.json(await runLocalPluginViewAction(body.plugin, body.view, body.action, typeof body.item === 'string' ? body.item : undefined, request.signal, decodeModAppSnapshot(body.app)))
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Action failed' }, { status: 400 })
  }
}
