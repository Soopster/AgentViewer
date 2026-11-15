import { NextResponse } from 'next/server'
import { localPluginDiscovery } from '@/lib/plugins/localPlugins'
import { readModReloadRequest, requestModReload } from '@/lib/plugins/modReload'

// Reload mods now, without restarting: writes the revision marker every Web tab
// and TUI sharing this configuration applies, and re-reads discovery here so the
// answer says what loaded and what was refused. Local mods are trusted code, as
// for `agent-viewer mods reload`; the route is write-scoped.
export const runtime = 'nodejs'
export async function POST() {
  try {
    const request = requestModReload(readModReloadRequest().developmentDirs)
    const discovery = localPluginDiscovery()
    return NextResponse.json({ revision: request.revision, loaded: discovery.plugins.map(plugin => plugin.manifest.id), refused: discovery.refused.map(entry => ({ id: entry.id, problems: entry.problems })) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 }) }
}
