// Client for the agentViewer IDE host (channels/agentviewer-ide.ts), the third
// Claude composer flow alongside the SDK flow and the channel flow
// (lib/channelBridge.ts). Here agentViewer acts as a Claude Code IDE: it hosts a
// WebSocket MCP server an external `claude` connects to, and this client drives
// the host's HTTP control surface — pushing at-mentions/selections into the
// running session and observing the IDE tool calls Claude makes (openDiff, …).
//
// Shared by the web composer (components/IdeBridgePanel.tsx via useIdeBridge)
// and the OpenTUI composer. Pure-ish: only fetch/ReadableStream/AbortController,
// available in both the Next.js and the Bun/OpenTUI bundle — no React, no
// Node-only APIs. Mirrors lib/channelBridge.ts deliberately.

export const DEFAULT_IDE_BRIDGE_URL = 'http://127.0.0.1:8791'

export type IdeBridgeConfig = {
  baseUrl: string
  token?: string
}

// Events streamed from the host's /events SSE.
export type IdeConnectionEvent = { type: 'connected' | 'disconnected' | 'initialized' }
export type IdeToolCallEvent = { type: 'tool_call'; name: string; arguments: Record<string, unknown> }
export type IdeOpenDiffEvent = {
  type: 'open_diff'
  diff_id: string
  old_file_path: string
  // Original on-disk contents the host read for old_file_path (empty for a new
  // file), so agentViewer can render a real old-vs-new diff.
  old_file_contents: string
  new_file_path: string
  new_file_contents: string
  tab_name: string
}
export type IdeEvent = IdeConnectionEvent | IdeToolCallEvent | IdeOpenDiffEvent

export type IdeBridgeStatus = 'idle' | 'connecting' | 'connected' | 'error'

// Reads bridge connection settings from the environment. TUI-only — the web UI
// persists its config in localStorage instead (see useIdeBridge). Safe to leave
// unused in the browser bundle; it only touches process.env when called.
export function readIdeBridgeConfigFromEnv(): IdeBridgeConfig {
  const baseUrl =
    (typeof process !== 'undefined' && process.env?.AGENTVIEWER_IDE_URL?.trim()) || DEFAULT_IDE_BRIDGE_URL
  const token = (typeof process !== 'undefined' && process.env?.AGENTVIEWER_IDE_CONTROL_TOKEN?.trim()) || undefined
  return { baseUrl, token }
}

function authHeaders(config: IdeBridgeConfig): Record<string, string> {
  return config.token ? { 'x-agentviewer-token': config.token } : {}
}

// EventSource can't set custom headers, so the SSE subscriber also carries the
// token as a query param — the server accepts either.
function withToken(url: string, config: IdeBridgeConfig): string {
  if (!config.token) return url
  const joiner = url.includes('?') ? '&' : '?'
  return `${url}${joiner}token=${encodeURIComponent(config.token)}`
}

// Push an at-mention (file + optional line range) into the running session.
export async function sendIdeAtMention(
  config: IdeBridgeConfig,
  filePath: string,
  lineStart?: number,
  lineEnd?: number,
): Promise<{ delivered: boolean }> {
  const res = await fetch(`${config.baseUrl}/at-mention`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(config) },
    body: JSON.stringify({ filePath, lineStart, lineEnd }),
  })
  if (!res.ok) throw new Error(`ide bridge at-mention failed: ${res.status}`)
  return res.json() as Promise<{ delivered: boolean }>
}

// Push a selection update; also stored so getCurrentSelection serves it.
export async function sendIdeSelection(
  config: IdeBridgeConfig,
  payload: {
    text: string
    filePath: string | null
    selection: { start: { line: number; character: number }; end: { line: number; character: number }; isEmpty?: boolean }
  },
): Promise<{ delivered: boolean }> {
  const res = await fetch(`${config.baseUrl}/selection`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(config) },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`ide bridge selection failed: ${res.status}`)
  return res.json() as Promise<{ delivered: boolean }>
}

// Resolve a blocking openDiff: 'accept' → FILE_SAVED, 'reject' → DIFF_REJECTED.
export async function resolveIdeDiff(
  config: IdeBridgeConfig,
  diffId: string,
  behavior: 'accept' | 'reject',
): Promise<void> {
  const res = await fetch(`${config.baseUrl}/diff-result`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(config) },
    body: JSON.stringify({ diff_id: diffId, behavior }),
  })
  if (!res.ok) throw new Error(`ide bridge diff verdict failed: ${res.status}`)
}

function parseIdeEvent(raw: unknown): IdeEvent | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  if (value.type === 'connected' || value.type === 'disconnected' || value.type === 'initialized') {
    return { type: value.type }
  }
  if (value.type === 'tool_call' && typeof value.name === 'string') {
    return {
      type: 'tool_call',
      name: value.name,
      arguments: (value.arguments && typeof value.arguments === 'object' ? value.arguments : {}) as Record<string, unknown>,
    }
  }
  if (
    value.type === 'open_diff' &&
    typeof value.diff_id === 'string' &&
    typeof value.old_file_path === 'string' &&
    typeof value.new_file_path === 'string' &&
    typeof value.new_file_contents === 'string' &&
    typeof value.tab_name === 'string'
  ) {
    return {
      type: 'open_diff',
      diff_id: value.diff_id,
      old_file_path: value.old_file_path,
      old_file_contents: typeof value.old_file_contents === 'string' ? value.old_file_contents : '',
      new_file_path: value.new_file_path,
      new_file_contents: value.new_file_contents,
      tab_name: value.tab_name,
    }
  }
  return null
}

// Manual SSE line-reader over fetch's streaming body (same approach as the
// channel bridge): EventSource can't attach headers and its availability under
// Bun varies, so a hand-rolled reader works identically everywhere `fetch` does
// and reconnects on its own.
export function subscribeToIdeEvents(
  config: IdeBridgeConfig,
  onEvent: (event: IdeEvent) => void,
  onStatus?: (status: IdeBridgeStatus) => void,
): () => void {
  const controller = new AbortController()
  let stopped = false

  async function run() {
    while (!stopped) {
      onStatus?.('connecting')
      try {
        const res = await fetch(withToken(`${config.baseUrl}/events`, config), {
          headers: authHeaders(config),
          signal: controller.signal,
        })
        if (!res.ok || !res.body) throw new Error(`ide bridge events failed: ${res.status}`)
        onStatus?.('connected')

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        while (!stopped) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            const trimmed = line.trimEnd()
            if (!trimmed.startsWith('data:')) continue
            const payload = trimmed.slice(5).trim()
            if (!payload) continue
            try {
              const event = parseIdeEvent(JSON.parse(payload))
              if (event) onEvent(event)
            } catch {
              // malformed frame — ignore and keep reading
            }
          }
        }
      } catch {
        if (stopped || controller.signal.aborted) return
        onStatus?.('error')
      }
      if (stopped) return
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
  }

  void run()

  return () => {
    stopped = true
    controller.abort()
  }
}
