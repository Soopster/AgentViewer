export type BetterTool = { id: string; label: string; status: 'running' | 'ok' | 'error' }
export type BetterProgress = { stage: number; tools: BetterTool[]; total: number; failed: number; startedAt: number }
export const BETTER_STAGES = ['Reading your code and files', 'Considering the professional approach (1 of 4)', 'Finding the raw material (2 of 4)', 'Picking the methods and tools (3 of 4)', 'Choosing independent checks (4 of 4)', 'Writing your improved prompt'] as const
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {}
const string = (value: unknown): string => typeof value === 'string' ? value : ''
function detail(input: unknown): string {
  const data = record(input)
  const value = data.command ?? data.path ?? data.file_path ?? data.pattern ?? data.query ?? data.fileName
  return (Array.isArray(value) ? value.join(' ') : string(value)).replace(/[\r\n\t]+/g, ' ').slice(0, 140)
}

/** Provider frames enter once on the server. UI adapters consume only this shape. */
export function createBetterProgress() {
  const tools = new Map<string, BetterTool>()
  const indices = new Map<number, string>()
  const inputs = new Map<number, string>()
  let stage = 0
  const startedAt = Date.now()
  const put = (id: string, name: string, input?: unknown, status: BetterTool['status'] = 'running') => {
    if (!id) return
    const prior = tools.get(id)
    const path = detail(input)
    tools.set(id, { id, label: path ? `${name} ${path}` : prior?.label ?? name, status: status === 'running' && prior?.status !== 'running' && prior ? prior.status : status })
  }
  const complete = (id: string, failed: boolean) => { if (id) put(id, tools.get(id)?.label ?? 'tool', undefined, failed ? 'error' : 'ok') }
  const blocks = (value: unknown) => {
    if (!Array.isArray(value)) return
    for (const raw of value) {
      const block = record(raw)
      if (block.type === 'tool_use') put(string(block.id), string(block.name) || 'tool', block.input)
      if (block.type === 'tool_result') complete(string(block.tool_use_id), block.is_error === true)
    }
  }
  return {
    update(payload: Record<string, unknown>, reply: string): BetterProgress {
      if (/(?:^|\n)\s*<improved-prompt>/.test(reply)) stage = 5
      else for (const match of reply.matchAll(/(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*\*)?(?:\(([1-4])\)|([1-4])[.)])/g)) stage = Math.max(stage, Number(match[1] ?? match[2]))
      const event = record(payload.event)
      const data = record(event.data)
      if (payload.type === 'stream_event') {
        const index = Number(event.index)
        const block = record(event.content_block)
        if (event.type === 'content_block_start' && block.type === 'tool_use') { indices.set(index, string(block.id)); put(string(block.id), string(block.name) || 'tool', block.input) }
        const delta = record(event.delta)
        if (delta.type === 'input_json_delta') {
          const input = (inputs.get(index) ?? '') + string(delta.partial_json); inputs.set(index, input)
          try { const id = indices.get(index) ?? ''; put(id, tools.get(id)?.label.split(' ')[0] ?? 'tool', JSON.parse(input)) } catch { /* partial JSON */ }
        }
      }
      if (payload.type === 'assistant' || payload.type === 'user') blocks(record(payload.message).content)
      if (payload.type === 'acp_message') blocks(record(record(payload.message).message).content)
      if (payload.type === 'codex_item_started' || payload.type === 'codex_item_completed') {
        const item = record(payload.item)
        if (['commandExecution', 'mcpToolCall', 'dynamicToolCall', 'fileChange', 'webSearch'].includes(string(item.type))) {
          put(string(item.id), item.type === 'commandExecution' ? 'shell' : string(item.tool) || string(item.type), item)
          if (payload.type === 'codex_item_completed') complete(string(item.id), item.status === 'failed' || item.status === 'declined' || (typeof item.exitCode === 'number' && item.exitCode !== 0) || Boolean(item.error))
        }
      }
      if (payload.type === 'pi_event') {
        if (event.type === 'tool_execution_start') put(string(event.toolCallId), string(event.toolName) || 'tool', event.args)
        if (event.type === 'tool_execution_end') complete(string(event.toolCallId), event.isError === true)
      }
      if (payload.type === 'copilot_event') {
        if (event.type === 'tool.execution_start') put(string(data.toolCallId), string(data.toolName) || string(data.mcpToolName) || 'tool', data.arguments)
        if (event.type === 'tool.execution_complete') complete(string(data.toolCallId), data.success === false || Boolean(data.error))
      }
      if (payload.type === 'opencode_event') {
        const part = record(record(event.properties).part), state = record(part.state)
        if (part.type === 'tool') {
          const id = string(part.callID) || string(part.id)
          put(id, string(part.tool) || 'tool', state.input)
          if (state.status === 'completed' || state.status === 'error') complete(id, state.status === 'error')
        }
      }
      const all = [...tools.values()]
      return { stage, tools: all.slice(-6), total: all.length, failed: all.filter(tool => tool.status === 'error').length, startedAt }
    },
  }
}
export function betterElapsed(startedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}
export function betterToolsLine(progress: BetterProgress): string {
  const recent = progress.tools.map(tool => `${tool.status === 'running' ? '·' : tool.status === 'error' ? '✗' : '✓'} ${tool.label}`).join('  ')
  return `${recent || 'Waiting for file reads…'}   ${progress.total} tools${progress.failed ? ` · ${progress.failed} failed` : ''}`
}

/** Drop old tools first while keeping the latest call's command/path visible. */
export function recentBetterTools(progress: BetterProgress, width: number): string {
  const labels = progress.tools.map(tool => `${tool.status === 'running' ? '·' : tool.status === 'error' ? '✗' : '✓'} ${tool.label}`)
  while (labels.length > 1 && labels.join('  ').length > width) labels.shift()
  return labels.join('  ') || 'Waiting for file reads…'
}
