import { readFile } from 'node:fs/promises'
import { NextRequest, NextResponse } from 'next/server'
import { applyPluginSettings } from '@/lib/plugins/enablement'
import { readPluginSettingsFile } from '@/lib/plugins/settingsFile'

// A mod's Web components module (web.mjs): a plain ES module importing nothing,
// served as-is for the page to load. It is the user's own code from their own
// plugin directory, the same code the daemon already runs for that mod.
export async function GET(request: NextRequest) {
  const pluginId = new URL(request.url).searchParams.get('plugin') ?? ''
  applyPluginSettings(readPluginSettingsFile())
  const { localPluginComponentFile } = await import('@/lib/plugins/localPluginRuntime')
  const file = localPluginComponentFile(pluginId, 'web')
  if (!file) return NextResponse.json({ error: `Mod "${pluginId}" ships no web.mjs` }, { status: 404 })
  return new NextResponse(await readFile(file, 'utf8'), { headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' } })
}
