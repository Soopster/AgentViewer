// Observe the existing attached SSE response without changing, buffering or reserializing its bytes.
import type { PluginTurnTarget } from './behavior'
import { hasPluginRuntimeObservers, pluginRuntimeCapabilities, publishPluginRuntimeEvent, type PluginRuntimeEvent } from './runtimeEvents'
type RecordValue = Record<string, unknown>
const record = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {}
const string = (value: unknown): string | undefined => typeof value === 'string' && value.length > 0 ? value.slice(0, 160) : undefined
const number = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
/** Unknown native events remain unobserved; this is telemetry, never an execution boundary. */
export function normalizePluginStreamEvent(target: PluginTurnTarget, name: string, payload: unknown): Array<Omit<PluginRuntimeEvent, 'at'>> {
  const raw = record(payload)
  const events: Array<Omit<PluginRuntimeEvent, 'at'>> = []
  const tool = (type: 'tool.started' | 'tool.completed', id: unknown, toolName?: unknown, failed?: boolean) => {
    const toolId = string(id)
    if (toolId) events.push({ type, target, source: 'response-stream', tool: { id: toolId, ...(string(toolName) ? { name: string(toolName) } : {}), ...(failed !== undefined ? { failed } : {}) } })
  }
  if (name === 'context-usage' || name === 'turn-usage') {
    const usage = { ...(number(raw.totalTokens) !== undefined ? { totalTokens: number(raw.totalTokens) } : {}), ...(number(raw.outputTokens) !== undefined ? { outputTokens: number(raw.outputTokens) } : {}) }
    if (Object.keys(usage).length) events.push({ type: 'usage.updated', target, source: 'response-stream', usage })
  }
  if (target.provider === 'claude') {
    const event = raw.type === 'stream_event' ? record(raw.event) : raw
    const block = record(event.content_block)
    if (event.type === 'content_block_start' && block.type === 'tool_use') tool('tool.started', block.id, block.name)
    const content = record(raw.message).content
    if (Array.isArray(content)) for (const value of content) {
      const block = record(value)
      if (block.type === 'tool_use') tool('tool.started', block.id, block.name)
      if (block.type === 'tool_result') tool('tool.completed', block.tool_use_id, undefined, block.is_error === true)
    }
  } else if (target.provider === 'codex' && (raw.type === 'codex_item_started' || raw.type === 'codex_item_completed')) {
    const item = record(raw.item)
    if (['commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'webSearch', 'imageView', 'toolSearch'].includes(String(item.type))) tool(raw.type === 'codex_item_started' ? 'tool.started' : 'tool.completed', item.id, item.tool ?? item.type, item.status === 'failed')
  } else if (target.provider === 'copilot' && raw.type === 'copilot_event') {
    const event = record(raw.event), data = record(event.data)
    if (event.type === 'tool.execution_start') tool('tool.started', data.toolCallId, data.toolName)
    if (event.type === 'tool.execution_complete') tool('tool.completed', data.toolCallId, data.toolName, data.success === false)
  } else if (target.provider === 'pi' && raw.type === 'pi_event') {
    const event = record(raw.event)
    if (event.type === 'tool_execution_start') tool('tool.started', event.toolCallId, event.toolName)
    if (event.type === 'tool_execution_end') tool('tool.completed', event.toolCallId, event.toolName, event.isError === true)
  } else if (target.provider === 'opencode' && raw.type === 'opencode_event') {
    const event = record(raw.event), part = record(record(event.properties).part), state = record(part.state)
    if (event.type === 'message.part.updated' && part.type === 'tool') {
      if (state.status === 'running') tool('tool.started', part.callID, part.tool)
      if (state.status === 'completed' || state.status === 'error') tool('tool.completed', part.callID, part.tool, state.status === 'error')
    }
  }
  return events
}
export function observePluginRuntimeResponse(response: Response, target: PluginTurnTarget): Response {
  if (!response.body || !response.ok || !hasPluginRuntimeObservers() || pluginRuntimeCapabilities(target.provider).tools === 'unsupported' || !response.headers.get('content-type')?.includes('text/event-stream')) return response
  const decoder = new TextDecoder()
  const seen = new Set<string>()
  let buffer = '', skipping = false
  const inspect = (frame: string) => {
    let name = 'message'
    const data: string[] = []
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) name = line.slice(6).trim()
      if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
    }
    if (!data.length) return
    try {
      for (const event of normalizePluginStreamEvent(target, name, JSON.parse(data.join('\n')))) {
        if (event.tool) {
          const key = `${event.type}:${event.tool.id}`
          if (seen.has(key)) continue
          seen.add(key)
          if (seen.size > 2048) seen.delete(seen.values().next().value!)
        }
        publishPluginRuntimeEvent(event)
      }
    } catch { /* malformed or oversized telemetry never breaks the stream */ }
  }
  const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk)
      // The bound includes old buffered bytes; a single large chunk is skipped safely.
      const text = decoder.decode(chunk, { stream: true })
      buffer = (buffer + text).replace(/\r\n/g, '\n')
      let boundary: number
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        if (!skipping && frame.length <= 262144) inspect(frame)
        skipping = false
      }
      if (buffer.length > 262144) { buffer = buffer.slice(-1); skipping = true }
    },
  }))
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
}
