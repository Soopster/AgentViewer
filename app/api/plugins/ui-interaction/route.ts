import { NextResponse } from 'next/server'
import { isAgentProvider } from '@/lib/provider'
import { publishPluginRuntimeEvent } from '@/lib/plugins/runtimeEvents'
import { UI_INTERACTION_SUBJECT } from '@/lib/plugins/uiInteractions'

// Batched counts of what a person did to cards, from the Web renderer, published to plugins as
// `ui.interaction`. Counts and tool names only. Write-scoped: it feeds plugins, so a read-only device may not.
export const runtime = 'nodejs'
const ACTIONS = new Set(['expand', 'fold', 'toggle', 'view-switch'])
export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { reports?: unknown } | null
  if (!body || !Array.isArray(body.reports) || body.reports.length > 200) return NextResponse.json({ error: 'reports must be an array of at most 200' }, { status: 400 })
  let accepted = 0
  for (const entry of body.reports) {
    const r = entry as { target?: { provider?: unknown; providerInstanceId?: unknown; sessionId?: unknown }; action?: unknown; subject?: unknown; count?: unknown } | null
    if (!r || !r.target || typeof r.target.provider !== 'string' || !isAgentProvider(r.target.provider) || typeof r.target.sessionId !== 'string' || !r.target.sessionId || r.target.sessionId.length > 200) continue
    if (typeof r.action !== 'string' || !ACTIONS.has(r.action) || typeof r.subject !== 'string' || !UI_INTERACTION_SUBJECT.test(r.subject)) continue
    if (typeof r.count !== 'number' || !Number.isInteger(r.count) || r.count < 1 || r.count > 10_000) continue
    publishPluginRuntimeEvent({ type: 'ui.interaction', source: 'renderer', target: { provider: r.target.provider, ...(typeof r.target.providerInstanceId === 'string' && r.target.providerInstanceId.length <= 200 ? { providerInstanceId: r.target.providerInstanceId } : {}), sessionId: r.target.sessionId }, interaction: { action: r.action as 'expand', subject: r.subject, count: r.count } })
    accepted++
  }
  return NextResponse.json({ accepted })
}
