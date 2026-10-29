import { sanitizeProtocolEvent, type AgentProtocolEvent } from '../../lib/agentProtocol'
import type { TuiTranscriptCardLine, TuiTranscriptLineTone } from './types'
import { CODE_FENCE_RE, line, compactLines, truncateLine, sanitizeLine, formatTimestamp } from './text'

function parseAgentProtocolCodeBlock(raw: string): AgentProtocolEvent | null {
  try {
    return sanitizeProtocolEvent(JSON.parse(raw))
  } catch {
    return null
  }
}

function agentProtocolTone(event: AgentProtocolEvent): TuiTranscriptLineTone {
  if (event.type === 'finding' || event.type === 'learning' || event.type === 'task.completed' || event.type === 'plan.approved') return 'result_ok'
  if (event.type === 'agent.blocked' || event.type === 'task.failed' || event.type === 'lock.denied' || event.type === 'plan.rejected') return 'result_error'
  if (event.type === 'message' || event.type === 'handoff' || event.type === 'review.requested') return 'agent'
  if (event.type.startsWith('lock.')) return 'system'
  return 'tool'
}

function agentProtocolSubject(event: AgentProtocolEvent): string {
  if (event.type === 'message' && event.to) return `to ${event.to}`
  if (event.type === 'task.created' && event.title) return event.title
  if (event.summary) return event.summary
  if (event.detail) return event.detail
  if (event.paths?.length) return event.paths.join(', ')
  return ''
}

function formatAgentProtocolEvent(event: AgentProtocolEvent, expanded: boolean): TuiTranscriptCardLine[] {
  const tone = agentProtocolTone(event)
  const target = event.to ? ` · to ${event.to}` : ''
  const task = event.taskId ? ` · ${event.taskId}` : ''
  const subject = agentProtocolSubject(event)
  const eventLabel = event.type.replace(/^agent\./, '').replace(/[._]/g, ' ')
  const lines: TuiTranscriptCardLine[] = [
    line(`coordinator ${eventLabel}${task}${target}`, tone),
    ...(subject ? [line(`  ${truncateLine(subject, 112)}`, tone === 'result_error' ? 'result_error' : 'muted')] : []),
    line(`  ${event.agentId} · run ${event.runId.slice(0, 8)}`, 'dim'),
  ]
  if (expanded) {
    if (event.detail && event.detail !== event.summary) {
      lines.push(...compactLines(event.detail).map((entry) => line(`  ${entry}`, 'muted')))
    }
    if (event.paths?.length) lines.push(line(`  paths: ${event.paths.join(', ')}`, 'dim'))
    if (event.dependsOn?.length) lines.push(line(`  depends on: ${event.dependsOn.join(', ')}`, 'dim'))
    if (event.lockId) lines.push(line(`  lock: ${event.lockId}`, 'dim'))
    if (event.timestamp) lines.push(line(`  at ${formatTimestamp(event.timestamp)}`, 'dim'))
  }
  return lines
}

export function textLinesForProtocolAwareBlock(text: string, expanded: boolean): TuiTranscriptCardLine[] | null {
  // Some clients preserve the A2A fence while others rewrite it to `json`.
  // The StreamResponse keys let us recognize both without parsing every
  // ordinary fenced code block in the transcript. Legacy AVP remains readable.
  if (!text.includes('```a2a') && !text.includes('agent-protocol') && !text.includes('"AVP/') && !text.includes('"statusUpdate"') && !text.includes('"artifactUpdate"')) return null
  const lines: TuiTranscriptCardLine[] = []
  let replacedAny = false
  let lastIndex = 0
  for (const match of text.matchAll(CODE_FENCE_RE)) {
    const lang = ((match[1] ?? '').trim() || 'text').toLowerCase()
    const start = match.index ?? 0
    const before = text.slice(lastIndex, start)
    if (before.trim()) {
      const beforeLines = expanded ? sanitizeLine(before).trim().split('\n') : compactLines(before.trim())
      lines.push(...beforeLines.map((entry) => line(entry.trimEnd())).filter((entry) => entry.text.trim()))
    }
    const content = (match[2] ?? '').trim()
    const event = (lang === 'a2a' || lang === 'agent-protocol' || lang === 'json')
      ? parseAgentProtocolCodeBlock(content)
      : null
    if (event) {
      replacedAny = true
      lines.push(...formatAgentProtocolEvent(event, expanded))
    } else {
      const fallback = match[0]
      const fallbackLines = expanded ? sanitizeLine(fallback).trim().split('\n') : compactLines(fallback.trim())
      lines.push(...fallbackLines.map((entry) => line(entry.trimEnd())).filter((entry) => entry.text.trim()))
    }
    lastIndex = start + match[0].length
  }
  const after = text.slice(lastIndex)
  if (after.trim()) {
    const afterLines = expanded ? sanitizeLine(after).trim().split('\n') : compactLines(after.trim())
    lines.push(...afterLines.map((entry) => line(entry.trimEnd())).filter((entry) => entry.text.trim()))
  }
  return replacedAny ? lines : null
}

export function isAgentProtocolText(text: string): boolean {
  return ((text.includes('```a2a') || text.includes('A2A Protocol')) && text.includes('agent-viewer.dev/extensions/coordination/v1'))
    || (text.includes('agent-protocol') && text.includes('"AVP/'))
}
