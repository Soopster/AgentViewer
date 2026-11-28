import { getAttachBaseUrl } from '../../../lib/tui/remote'
import type { PluginRemoteAccessService, RemoteAccessView } from '../../../lib/plugins/remoteAccess'

/**
 * The daemon a phone pairs with: the one this TUI is attached to, else the
 * default local `agent-viewer web` (AGENT_VIEWER_DAEMON_URL overrides).
 */
function daemonUrl(): string {
  return getAttachBaseUrl() ?? (process.env.AGENT_VIEWER_DAEMON_URL?.replace(/\/+$/, '') || `http://localhost:${process.env.PORT || 3000}`)
}

async function call(path: string, init: RequestInit = {}): Promise<RemoteAccessView> {
  let response: Response
  try {
    response = await fetch(`${daemonUrl()}${path}`, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } })
  } catch {
    throw new Error(`No Agent Viewer daemon at ${daemonUrl()}: start one with \`agent-viewer --daemon\` (pairing is with the daemon a phone can reach)`)
  }
  const body = await response.json().catch(() => ({}))
  if (!response.ok || body?.error) throw new Error(body?.error || `Remote access failed (${response.status})`)
  return body as RemoteAccessView
}

export const tuiRemoteAccess: PluginRemoteAccessService = {
  get daemonUrl() { return daemonUrl() },
  read: (signal) => call('/api/remote-access', { signal }),
  act: (request, signal) => call('/api/remote-access', { method: 'POST', body: JSON.stringify(request), signal }),
}
