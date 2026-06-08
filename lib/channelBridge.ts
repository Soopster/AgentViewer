// Client for the local agentViewer channel bridge (channels/agentviewer-channel.ts),
// shared by the web composer (components/ChannelBridgePanel.tsx) and the OpenTUI
// composer (tui/opentui/ChannelBridgePopover.tsx).
//
// Pure-ish: only fetch/ReadableStream/AbortController, all available in both the
// Next.js bundle and the Bun/OpenTUI bundle — no React, no Node-only APIs.

import type { PendingPermission } from './permissions'

export const DEFAULT_CHANNEL_BRIDGE_URL = 'http://127.0.0.1:8790'

export type ChannelBridgeConfig = {
  baseUrl: string
  token?: string
}

export type ChannelReplyEvent = {
  type: 'reply'
  chat_id: string
  text: string
}

export type ChannelPermissionRequestEvent = {
  type: 'permission_request'
  request_id: string
  tool_name: string
  description: string
  input_preview: string
}

export type ChannelEvent = ChannelReplyEvent | ChannelPermissionRequestEvent

export type ChannelBridgeStatus = 'idle' | 'connecting' | 'connected' | 'error'

function authHeaders(config: ChannelBridgeConfig): Record<string, string> {
  return config.token ? { 'x-agentviewer-token': config.token } : {}
}

// EventSource can't set custom headers, so the SSE subscriber also carries the
// token as a query param — the server accepts either.
function withToken(url: string, config: ChannelBridgeConfig): string {
  if (!config.token) return url
  const joiner = url.includes('?') ? '&' : '?'
  return `${url}${joiner}token=${encodeURIComponent(config.token)}`
}

export async function sendChannelMessage(
  config: ChannelBridgeConfig,
  text: string,
  chatId?: string,
): Promise<{ chat_id: string }> {
  const res = await fetch(`${config.baseUrl}/message`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(config) },
    body: JSON.stringify({ text, chat_id: chatId }),
  })
  if (!res.ok) throw new Error(`channel bridge send failed: ${res.status}`)
  return res.json() as Promise<{ chat_id: string }>
}

export async function respondToChannelPermission(
  config: ChannelBridgeConfig,
  requestId: string,
  behavior: 'allow' | 'deny',
): Promise<void> {
  const res = await fetch(`${config.baseUrl}/permission`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(config) },
    body: JSON.stringify({ request_id: requestId, behavior }),
  })
  if (!res.ok) throw new Error(`channel bridge verdict failed: ${res.status}`)
}

function parseChannelEvent(raw: unknown): ChannelEvent | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  if (value.type === 'reply' && typeof value.chat_id === 'string' && typeof value.text === 'string') {
    return { type: 'reply', chat_id: value.chat_id, text: value.text }
  }
  if (
    value.type === 'permission_request' &&
    typeof value.request_id === 'string' &&
    typeof value.tool_name === 'string' &&
    typeof value.description === 'string' &&
    typeof value.input_preview === 'string'
  ) {
    return {
      type: 'permission_request',
      request_id: value.request_id,
      tool_name: value.tool_name,
      description: value.description,
      input_preview: value.input_preview,
    }
  }
  return null
}

// Manual SSE line-reader over fetch's streaming body. Deliberately not
// EventSource: browsers can't attach custom headers to it, and its
// availability under Bun varies — a hand-rolled reader works identically
// everywhere `fetch` does, and reconnects on its own.
export function subscribeToChannelEvents(
  config: ChannelBridgeConfig,
  onEvent: (event: ChannelEvent) => void,
  onStatus?: (status: ChannelBridgeStatus) => void,
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
        if (!res.ok || !res.body) throw new Error(`channel bridge events failed: ${res.status}`)
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
              const event = parseChannelEvent(JSON.parse(payload))
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

// Adapts an inbound permission_request into the shared PendingPermission shape
// so both UIs can reuse their existing approval-card rendering. The channel
// only supports a binary verdict (no "always allow"), unlike native providers.
export function channelPermissionToPending(event: ChannelPermissionRequestEvent): PendingPermission {
  const isBash = event.tool_name.toLowerCase() === 'bash'
  return {
    id: `channel:${event.request_id}`,
    title: event.tool_name,
    detail: event.description,
    toolName: event.tool_name,
    command: isBash ? event.input_preview : undefined,
    reason: isBash ? undefined : event.input_preview,
  }
}
