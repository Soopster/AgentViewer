import type { PluginSessionDiagnosticsService } from '../../lib/plugins/diagnostics'

async function result(response: Response): Promise<Record<string, unknown>> {
  const data = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok || data.error) throw new Error(typeof data.error === 'string' ? data.error : `Diagnostics request failed (${response.status})`)
  return data
}

/** HTTP adapter only. Plugins own presentation, reads and action policy. */
export const webSessionDiagnostics: PluginSessionDiagnosticsService = {
  async read(session, signal) {
    const query = new URLSearchParams({ provider: session.provider ?? 'claude' })
    if (session.providerInstanceId) query.set('providerInstanceId', session.providerInstanceId)
    const data = await result(await fetch(`/api/sessions/${encodeURIComponent(session.sessionId)}/diagnostics?${query}`, { signal, cache: 'no-store' }))
    return Array.isArray(data.sections) ? data.sections as Awaited<ReturnType<PluginSessionDiagnosticsService['read']>> : []
  },
  async run(session, action, extra, signal) {
    const data = await result(await fetch(`/api/sessions/${encodeURIComponent(session.sessionId)}/actions`, {
      method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...extra, action, provider: session.provider ?? 'claude', providerInstanceId: session.providerInstanceId }),
    }))
    return data.result && typeof data.result === 'object' && !Array.isArray(data.result) ? data.result as Record<string, unknown> : data
  },
  hasControls: session => session.provider === 'claude',
}
