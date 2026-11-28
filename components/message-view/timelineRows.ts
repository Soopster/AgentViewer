'use client'
import { messageToCopyText } from '../../lib/threadedMessageText'
import type { ThreadedMessage } from '../../lib/threading'
import type { SessionMessage, ContentBlock, ToolResultBlock } from '../../lib/types'
import type { TimelineRow, ActiveTranscriptFilter } from './types'

function messageContentBlocksForTarget(message: SessionMessage): ContentBlock[] {
  if (message.type === 'system') return []
  const content = message.message.content
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : []
  return (content ?? []) as ContentBlock[]
}
function isToolResultBlock(block: ContentBlock): block is ToolResultBlock {
  return block.type === 'tool_result' && typeof (block as ToolResultBlock).tool_use_id === 'string'
}
export function resolveTimelineTargetMessageId(
  targetMessageId: string | null | undefined,
  messages: SessionMessage[],
  timelineRows: TimelineRow[]): string | null {
  if (!targetMessageId) return null
  if (timelineRows.some((row) => row.message.uuid === targetMessageId)) return targetMessageId

  const rawTarget = messages.find((message) => message.uuid === targetMessageId)
  if (!rawTarget) return targetMessageId

  const targetToolUseIds = messageContentBlocksForTarget(rawTarget)
    .filter(isToolResultBlock)
    .map((block) => block.tool_use_id)
    .filter(Boolean)

  if (targetToolUseIds.length === 0) return targetMessageId
  const targetToolUseIdSet = new Set(targetToolUseIds)
  const owningRow = timelineRows.find((row) => row.message.blocks.some((block) => (
    block.type === 'tool_thread' &&
    (targetToolUseIdSet.has(block.toolUse.id) || (block.result?.tool_use_id ? targetToolUseIdSet.has(block.result.tool_use_id) : false))
  )))
  return owningRow?.message.uuid ?? targetMessageId
}
export function timelineRowSearchText(row: TimelineRow): string {
  return [
    row.message.role,
    row.message.provider,
    row.message.sessionId,
    row.previewBadge,
    row.activityDetail,
    messageToCopyText(row.message),
  ].filter(Boolean).join(' ').toLowerCase()
}
function isAgentsToolOnlyRow(row: TimelineRow): boolean {
  const blocks = row.message.blocks
  return blocks.length > 0 && blocks.every((block) => block.type === 'tool_thread')
}
export function rowContainsMessage(row: TimelineRow, messageId: string | null | undefined): boolean {
  if (!messageId) return false
  return row.message.uuid === messageId || row.groupedMessageIds?.includes(messageId) === true
}
export function groupAgentsToolRows(rows: TimelineRow[]): TimelineRow[] {
  const grouped: TimelineRow[] = []
  let pending: TimelineRow[] = []

  const flush = () => {
    if (pending.length === 0) return
    if (pending.length === 1) {
      grouped.push(pending[0])
      pending = []
      return
    }
    const first = pending[0]
    const last = pending[pending.length - 1]
    const blocks = pending.flatMap((row) => row.message.blocks)
    grouped.push({
      key: `agents-tools:${first.key}:${last.key}:${pending.length}`,
      message: {
        ...first.message,
        uuid: first.message.uuid,
        blocks,
      },
      groupedMessageIds: pending.map((row) => row.message.uuid),
      showSession: pending.some((row) => row.showSession),
      dimmed: pending.every((row) => row.dimmed),
      streamTurnFooterHint: last.streamTurnFooterHint,
    })
    pending = []
  }

  for (const row of rows) {
    if (isAgentsToolOnlyRow(row)) {
      pending.push(row)
    } else {
      flush()
      grouped.push(row)
    }
  }
  flush()
  return grouped
}
function streamMessageTimestampMs(message: ThreadedMessage): number | null {
  if (!message.timestamp) return null
  const value = Date.parse(message.timestamp)
  return Number.isFinite(value) ? value : null
}
function formatStreamElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(1, Math.floor(elapsedMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}
export function decorateStreamTurnLandmarks(rows: TimelineRow[], showLatestFooter: boolean): TimelineRow[] {
  let turnStartedAt: number | null = null
  let turnLatestAt: number | null = null
  let hasPriorTurn = false
  const decorated = rows.map((row) => {
    const timestamp = streamMessageTimestampMs(row.message)
    if (row.message.role === 'user') {
      const elapsed = turnStartedAt != null && turnLatestAt != null ? turnLatestAt - turnStartedAt : 0
      const next = hasPriorTurn
        ? { ...row, streamTurnHint: elapsed >= 1000 ? `Worked for ${formatStreamElapsed(elapsed)}` : '' }
        : row
      hasPriorTurn = true
      turnStartedAt = timestamp
      turnLatestAt = timestamp
      return next
    }
    if (timestamp != null && (turnLatestAt == null || timestamp > turnLatestAt)) turnLatestAt = timestamp
    return row
  })

  if (!showLatestFooter || decorated.length === 0 || turnStartedAt == null || turnLatestAt == null) return decorated
  const elapsed = turnLatestAt - turnStartedAt
  const lastIndex = decorated.length - 1
  const last = decorated[lastIndex]
  if (!last || last.message.role === 'user' || elapsed < 1000) return decorated
  const next = decorated.slice()
  next[lastIndex] = { ...last, streamTurnFooterHint: `Worked for ${formatStreamElapsed(elapsed)}` }
  return next
}
function timelineRowMatchesTranscriptFilter(row: TimelineRow, filter: ActiveTranscriptFilter): boolean {
  switch (filter) {
    case 'user':
    case 'assistant':
    case 'system':
      return row.message.role === filter
    case 'tools':
      return row.message.blocks.some((block) => block.type === 'tool_thread')
    case 'errors':
      return row.message.blocks.some((block) => block.type === 'tool_thread' && (block.result?.is_error || !block.result))
    case 'thinking':
      return row.message.blocks.some((block) => block.type === 'thinking')
    case 'media':
      return row.message.blocks.some((block) => block.type === 'image')
  }
}
export function timelineRowMatchesTranscriptFilters(row: TimelineRow, filters: ActiveTranscriptFilter[]): boolean {
  return filters.length === 0 || filters.some((filter) => timelineRowMatchesTranscriptFilter(row, filter))
}
