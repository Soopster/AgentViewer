import { NextRequest, NextResponse } from 'next/server'
import { applyPluginSettings } from '@/lib/plugins/enablement'
import { readPluginSettingsFile } from '@/lib/plugins/settingsFile'
import { isAgentProvider } from '@/lib/provider'

// Run one local plugin ("mod") command where its code lives: this daemon. The
// command answers with effects as data, which the Web client applies through
// its own command host.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { pluginId?: unknown; commandId?: unknown; target?: { session?: unknown; cwd?: unknown } }
  if (typeof body.pluginId !== 'string' || typeof body.commandId !== 'string') {
    return NextResponse.json({ error: 'pluginId and commandId are required' }, { status: 400 })
  }
  const rawSession = body.target?.session as { sessionId?: unknown; provider?: unknown; providerInstanceId?: unknown } | null | undefined
  const session = rawSession && typeof rawSession.sessionId === 'string' && isAgentProvider(rawSession.provider)
    ? { sessionId: rawSession.sessionId, provider: rawSession.provider, ...(typeof rawSession.providerInstanceId === 'string' ? { providerInstanceId: rawSession.providerInstanceId } : {}) }
    : null
  const cwd = typeof body.target?.cwd === 'string' ? body.target.cwd : null
  applyPluginSettings(readPluginSettingsFile())
  try {
    const { runLocalPluginCommand } = await import('@/lib/plugins/localPluginRuntime')
    return NextResponse.json(await runLocalPluginCommand({ pluginId: body.pluginId, commandId: body.commandId, target: { session, cwd } }, request.signal))
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Plugin command failed' }, { status: 400 })
  }
}
