// Remote attach transport. When AGENT_VIEWER_ATTACH is set (`agent-viewer
// --attach <url>`), the TUI stops running the provider backend in-process and
// routes every backend call through a running agent-viewer web server — the
// daemon. Turns then live in the daemon process: they survive TUI restarts
// and detaches, and the running-turn registry is shared with the web UI and
// any other attached TUI.
//
// Provider/session and Coordinator lifecycle operations go remote. Coordinator
// controllers must live beside the provider sessions they steer so workflows,
// inbox delivery, and task dispatch survive a TUI detach or restart. Terminal
// preferences (lib/tuiState), bookmarks, prompts, and the remaining git-based
// features (worktree tasks and checkpoints) stay local — those features operate
// on filesystem paths, so remote attach assumes the daemon shares the machine
// (or the mounts) with the TUI.

import type { DaemonStatus } from '../daemonProtocol'

export function getAttachBaseUrl(): string | null {
  const raw = process.env.AGENT_VIEWER_ATTACH
  if (!raw || !raw.trim()) return null
  return raw.trim().replace(/\/+$/, '')
}

export function isRemoteAttached(): boolean {
  return getAttachBaseUrl() !== null
}

/** Subscribe to daemon-side Coordinator ledger changes over SSE. */
export function subscribeRemoteProtocolRunChanges(
  onRunChanged: (runId: string) => void,
  onReconnect: () => void,
): (() => void) | null {
  const baseUrl = getAttachBaseUrl()
  if (!baseUrl) return null
  return subscribeProtocolRunChangesAt(baseUrl, {}, onRunChanged, onReconnect)
}

/**
 * The same change stream from any daemon — the attached one, or another
 * machine's (`lib/tui/machines.ts`), which needs its device credential in
 * `headers`. Reconnects with backoff until stopped.
 */
export function subscribeProtocolRunChangesAt(
  baseUrl: string,
  headers: Record<string, string>,
  onRunChanged: (runId: string) => void,
  onReconnect: () => void,
): () => void {
  const controller = new AbortController()
  let stopped = false

  const run = async () => {
    let retryMs = 250
    while (!stopped) {
      try {
        const response = await fetch(`${baseUrl}/api/agent-protocol/runs/changes`, {
          headers: { ...headers, Accept: 'text/event-stream' },
          signal: controller.signal,
        })
        if (!response.ok || !response.body) throw new Error(`Coordinator change stream failed: ${response.status}`)
        retryMs = 250
        onReconnect()
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        while (!stopped) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.startsWith('data:')) continue
            const raw = line.slice(5).trim()
            if (!raw) continue
            try {
              const payload = JSON.parse(raw) as { runId?: unknown }
              if (typeof payload.runId === 'string' && payload.runId) onRunChanged(payload.runId)
            } catch {
              // Ignore malformed frames; the next durable snapshot reconciles state.
            }
          }
        }
      } catch {
        if (stopped || controller.signal.aborted) return
      }
      await new Promise((resolve) => setTimeout(resolve, retryMs))
      retryMs = Math.min(retryMs * 2, 5_000)
    }
  }

  void run()
  return () => {
    stopped = true
    controller.abort()
  }
}

function extractError(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const message = (payload as { error?: unknown }).error
    if (typeof message === 'string' && message.trim()) return message
  }
  // A route the daemon does not have answers 404 with Next's HTML page, so
  // there is no error to quote. Say what that most likely means rather than
  // reporting a bare status the user cannot act on (herdr: a missing method is
  // not permission to restart somebody else's server).
  if (status === 404) return 'Daemon request failed (HTTP 404). This daemon may be older than the TUI — restart it with the current agent-viewer.'
  return `Daemon request failed (HTTP ${status})`
}

/** The daemon's version handshake, or null when it cannot answer one. */
export async function readDaemonStatus(): Promise<DaemonStatus | null> {
  const base = getAttachBaseUrl()
  if (!base) return null
  try {
    const response = await fetch(`${base}/api/version`, { headers: { Accept: 'application/json' } })
    if (!response.ok) return null
    const payload = await response.json() as Partial<DaemonStatus>
    if (payload?.name !== 'agent-viewer' || typeof payload.protocol !== 'number' || !Array.isArray(payload.features)) return null
    return { name: 'agent-viewer', version: String(payload.version ?? 'unknown'), protocol: payload.protocol, features: payload.features.map(String) }
  } catch {
    return null
  }
}

/** JSON request against the daemon; throws with the daemon's error message. */
export async function remoteJson<T>(path: string, init?: RequestInit): Promise<T> {
  const base = getAttachBaseUrl()
  if (!base) throw new Error('Not attached to a daemon (AGENT_VIEWER_ATTACH is unset)')
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!response.ok) {
    const errorPayload = await response.json().catch(() => null)
    throw new Error(extractError(errorPayload, response.status))
  }
  const payload = await response.json().catch(() => null)
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
