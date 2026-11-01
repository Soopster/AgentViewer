import type { ThinkingBlock } from './types'

export function hasReasoningContent(block: ThinkingBlock): boolean {
  return Boolean(block.thinking.trim() || block.reasoningText?.trim()) || (block.reasoning?.tokens ?? 0) > 0
}

export function thinkingTranscriptText(block: ThinkingBlock): string {
  const summary = block.thinking.trim()
  const text = block.reasoningText?.trim() ?? ''
  if (!text || text === summary) return summary
  return summary ? `${summary}\n\nReasoning transcript\n${text}` : text
}

export function reasoningLabel(block: ThinkingBlock, now = Date.now()): string {
  const info = block.reasoning
  if (!info) return 'Thinking'
  const complete = info.completed || info.completedAt !== undefined
  const elapsed = info.startedAt === undefined || (complete && info.completedAt === undefined) ? undefined : Math.max(0, Math.floor(((info.completedAt ?? now) - info.startedAt) / 1000))
  const duration = elapsed === undefined || (complete && elapsed === 0) ? '' : elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
  const tokens = info.tokens === undefined ? '' : ` · ${info.tokens >= 1000 ? `${(info.tokens / 1000).toFixed(1)}k` : info.tokens} ${info.tokenScope === 'turn' ? 'turn reasoning tokens' : 'reasoning tokens'}`
  return `${complete ? duration ? 'Thought for' : 'Thought' : 'Thinking'}${duration ? ` ${duration}` : ''}${tokens}`
}

export function latestReasoningSummary(text: string): string {
  return text.trim().split('\n').map(line => line.trim()).filter(Boolean).at(-1) ?? ''
}
