// Remote attach transport. When AGENT_VIEWER_ATTACH is set (`agent-viewer
// --attach <url>`), the TUI stops running the provider backend in-process and
// routes every backend call through a running agent-viewer web server — the
// daemon. Turns then live in the daemon process: they survive TUI restarts
// and detaches, and the running-turn registry is shared with the web UI and
// any other attached TUI.
//
// Only provider/session operations go remote. Terminal preferences
// (lib/tuiState), bookmarks, prompts, and the git-based features (worktree
// tasks, checkpoints, coordination ledger) stay local — the git features
// operate on filesystem paths, so remote attach assumes the daemon shares the
// machine (or the mounts) with the TUI.

export function getAttachBaseUrl(): string | null {
  const raw = process.env.AGENT_VIEWER_ATTACH
  if (!raw || !raw.trim()) return null
  return raw.trim().replace(/\/+$/, '')
}

export function isRemoteAttached(): boolean {
  return getAttachBaseUrl() !== null
}

function extractError(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const message = (payload as { error?: unknown }).error
    if (typeof message === 'string' && message.trim()) return message
  }
  return `Daemon request failed (HTTP ${status})`
}

/** JSON request against the daemon; throws with the daemon's error message. */
export async function remoteJson<T>(path: string, init?: RequestInit): Promise<T> {
  const base = getAttachBaseUrl()
  if (!base) throw new Error('Not attached to a daemon (AGENT_VIEWER_ATTACH is unset)')
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(extractError(payload, response.status))
  return payload as T
}

/**
 * Streaming POST against the daemon (the send-turn SSE). Returned as-is: the
 * composer already speaks Response/SSE, so remote streams need no adaptation.
 */
export async function remoteStream(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  const base = getAttachBaseUrl()
  if (!base) throw new Error('Not attached to a daemon (AGENT_VIEWER_ATTACH is unset)')
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    signal,
  })
}

export function encodeSessionPath(sessionId: string, suffix = ''): string {
  return `/api/sessions/${encodeURIComponent(sessionId)}${suffix}`
}

export function providerQuery(provider: string | undefined | null): string {
  return provider ? `?provider=${encodeURIComponent(provider)}` : ''
}
