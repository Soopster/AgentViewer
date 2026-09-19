import type { ToolResultBlock } from './types'
import type { ThreadedMessage } from './threading'

function toolResultToText(result: ToolResultBlock | null): string {
  if (!result) return ''
  if (typeof result.content === 'string') return result.content
  return result.content
    .map((b) => (b.type === 'text' && typeof (b as { text?: unknown }).text === 'string'
      ? (b as { text: string }).text
      : ''))
    .filter(Boolean)
    .join('\n')
}

function toolInputToText(input: Record<string, unknown>): string {
  if (typeof input.command === 'string') return input.command
  if (typeof input.file_path === 'string') {
    if (typeof input.old_string === 'string' && typeof input.new_string === 'string') {
      return `${input.file_path}\n\n--- old\n${input.old_string}\n+++ new\n${input.new_string}`
    }
    if (typeof input.content === 'string') return `${input.file_path}\n\n${input.content}`
    return input.file_path
  }
  if (typeof input.pattern === 'string') return input.pattern
  if (typeof input.query === 'string') return input.query
  if (typeof input.url === 'string') return input.url
  if (typeof input.prompt === 'string') return input.prompt
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return ''
  }
}

export function messageToCopyText(message: ThreadedMessage): string {
  const parts: string[] = []
  for (const block of message.blocks) {
    if (block.type === 'text' && block.text) {
      parts.push(block.text)
    } else if (block.type === 'thinking' && block.thinking) {
      parts.push(block.thinking)
    } else if (block.type === 'tool_thread') {
      const sections = [`[${block.toolUse.name}]`]
      const inputText = toolInputToText(block.toolUse.input)
      if (inputText) sections.push(inputText)
      const resultText = toolResultToText(block.result)
      if (resultText) sections.push(resultText)
      parts.push(sections.join('\n\n'))
    } else if (block.type === 'task_notification') {
      const sections = [`[Task: ${block.taskId}]`]
      if (block.summary) sections.push(block.summary)
      if (block.result) sections.push(block.result)
      parts.push(sections.join('\n\n'))
    } else if (block.type === 'local_command_stdout' && block.stdout) {
      parts.push(block.stdout)
    }
  }
  return parts.join('\n\n').trim()
}

