import { NextRequest, NextResponse } from 'next/server'
import { decodeModAppSnapshot } from '@/lib/plugins/modApp'
import { readModDiagnostics, type ModDiagnostic } from '@/lib/plugins/modDiagnostics'
import { localPluginDiscovery } from '@/lib/plugins/localPlugins'
import { readPluginSettingsFile } from '@/lib/plugins/settingsFile'
import { writeAppInspection, readAppInspections } from '@/lib/plugins/appInspection.mjs'

export async function GET(request: NextRequest) {
  return NextResponse.json({ instances: readAppInspections(request.nextUrl.searchParams.get('instance') ?? undefined), diagnostics: readModDiagnostics() }, { headers: { 'Cache-Control': 'no-store' } })
}
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const app = decodeModAppSnapshot(body?.app)
  if (!app || app.renderer !== 'web') return NextResponse.json({ error: 'A Web app snapshot is required' }, { status: 400 })
  const discovery = localPluginDiscovery()
  const disabled = new Set(readPluginSettingsFile().disabled)
  const browserErrors: ModDiagnostic[] = (Array.isArray(body?.diagnostics) ? body.diagnostics.slice(-50) : []).flatMap((entry: ModDiagnostic | null) => entry && typeof entry.pluginId === 'string' && typeof entry.contribution === 'string' && typeof entry.message === 'string' ? [{ pluginId: entry.pluginId.slice(0, 48), contribution: entry.contribution.slice(0, 128), message: entry.message.slice(0, 1000), at: Number.isFinite(entry.at) ? entry.at : Date.now(), count: Number.isFinite(entry.count) ? entry.count : 1 }] : [])
  const diagnostics = readModDiagnostics()
  writeAppInspection({ ...(Number.isSafeInteger(body?.revision) && body.revision >= 0 ? { revision: body.revision } : {}), app, mods: discovery.plugins.map(({ manifest }) => ({ id: manifest.id, title: manifest.title, enabled: !disabled.has(manifest.id) })), diagnostics: [...diagnostics, ...browserErrors].slice(-50), refused: discovery.refused })
  return NextResponse.json({ diagnostics })
}
