'use client'
import { countLinesUpTo } from '../../lib/boundedLineCount'
import { extractClaudeReadFileSummary } from '../../lib/claudeSdkFeatures'
import type { ThreadedBlock } from '../../lib/threading'
import type { ContentBlock, ToolResultBlock } from '../../lib/types'
import { ESTIMATED_CHARS_PER_LINE, ESTIMATED_TIMELINE_ROW_HEIGHT, TIMELINE_CALIBRATION_MIN_SAMPLES, TIMELINE_CALIBRATION_BUCKET_CONFIDENCE, TIMELINE_CALIBRATION_MIN_RATIO, TIMELINE_CALIBRATION_MAX_RATIO } from './constants'
import type { TimelineRow, TimelineEstimateBucket, TimelineEstimateCalibration } from './types'
import type { WebViewMode, MessageDensity } from '../MessageItem'

function estimateWrappedLines(text: string, charsPerLine = ESTIMATED_CHARS_PER_LINE): number {
  if (!text) return 1

  let lines = 0
  for (const rawLine of text.replace(/\t/g, '    ').split('\n')) {
    if (!rawLine) {
      lines += 1
      continue
    }
    lines += Math.max(1, Math.ceil(rawLine.length / charsPerLine))
  }
  return Math.max(lines, 1)
}
function estimateTextSectionHeight(
  text: string,
  { lineHeight = 24, padding = 26, min = 56, max }: { lineHeight?: number; padding?: number; min?: number; max?: number}  = {}
): number {
  const estimated = padding + estimateWrappedLines(text) * lineHeight
  const bounded = max != null ? Math.min(estimated, max) : estimated
  return Math.max(min, bounded)
}
const STANDALONE_DATA_IMAGE_ESTIMATE_RE = /^(?:\[image\]\s*)?data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+\s*$/
function hasStandaloneDataImage(text: string): boolean {
  return text.split('\n').some((line) => STANDALONE_DATA_IMAGE_ESTIMATE_RE.test(line.trim()))
}
function estimateRenderedTextHeight(text: string): number {
  if (!hasStandaloneDataImage(text)) return estimateTextSectionHeight(text)

  let estimated = 0
  const textLines: string[] = []
  const flushText = () => {
    const chunk = textLines.join('\n').trimEnd()
    if (chunk) estimated += estimateTextSectionHeight(chunk)
    textLines.length = 0
  }

  for (const line of text.split('\n')) {
    if (!STANDALONE_DATA_IMAGE_ESTIMATE_RE.test(line.trim())) {
      textLines.push(line)
      continue
    }
    flushText()
    estimated += 520
  }
  flushText()
  return Math.max(estimated, 56)
}
function estimateContentBlockHeight(block: ContentBlock): number {
  if (block.type === 'text') return estimateTextSectionHeight(typeof block.text === 'string' ? block.text : '')
  if (block.type === 'thinking') return 70
  if (block.type === 'image') return 520
  if (block.type === 'tool_result') {
    if (typeof block.content === 'string') {
      return estimateTextSectionHeight(block.content, { lineHeight: 18, padding: 18, min: 60, max: 260 })
    }
    if (Array.isArray(block.content)) {
      return 60 + block.content.reduce((total: number, child: ContentBlock) => total + estimateContentBlockHeight(child), 0)
    }
    return 60
  }
  return 68
}
function toolResultContentToText(content: ToolResultBlock['content']): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (!block || typeof block !== 'object') return ''
        const record = block as Record<string, unknown>
        if (record.type !== 'text') return JSON.stringify(block)
        if (typeof record.text === 'string') return record.text
        const file = record.file
        if (file && typeof file === 'object' && typeof (file as Record<string, unknown>).content === 'string') {
          return (file as { content: string} ).content
        }
        return JSON.stringify(block)
      })
      .filter(Boolean)
      .join('\n')
  }
  return JSON.stringify(content, null, 2)
}
function toolResultHasImage(content: ToolResultBlock['content']): boolean {
  return Array.isArray(content) && content.some((block) => !!block && typeof block === 'object' && (block as { type?: unknown} ).type === 'image')
}
function estimateLimitedPreHeight(text: string, limit: number): { lineHeight: number; hidden: boolean}  {
  const lineCount = countLinesUpTo(text, limit + 1)
  const visibleLines = Math.min(lineCount, limit)
  return {
    lineHeight: 16 + visibleLines * 21,
    hidden: lineCount > limit,
  }
}
function estimateGenericToolResultHeight(result: ToolResultBlock): number {
  const raw = toolResultContentToText(result.content)
  if (!result.is_error && raw.length < 140 && raw.split('\n').filter((line) => line.trim()).length === 1) return 30

  const persistedMatch = raw.match(/<persisted-output>[\s\S]*?Preview[^\n]*:\n([\s\S]*)/)
  const displayText = persistedMatch ? persistedMatch[1].trim() : raw
  const { lineHeight, hidden } = estimateLimitedPreHeight(displayText, 20)
  return 28 + lineHeight + (hidden ? 31 : 0)
}
function estimateReadToolResultHeight(result: ToolResultBlock, filePath?: string): number {
  const summary = extractClaudeReadFileSummary(result, filePath)
  if (summary && summary.kind !== 'text') {
    return estimateGenericToolResultHeight({
      ...result,
      content: summary.content,
    })
  }

  const raw = summary?.content ?? toolResultContentToText(result.content)
  const lineCount = countLinesUpTo(raw, 26)
  const visibleLines = Math.min(lineCount, 25)
  const metadataHeight = summary ? 30 : 0
  const codeHeight = Math.min(500, Math.max(44, 38 + visibleLines * 20))
  const expandHeight = lineCount > 25 ? 31 : 0
  return 1 + metadataHeight + codeHeight + expandHeight
}
function estimateToolResultHeight(result: ToolResultBlock | null | undefined, toolName: string, filePath?: string): number {
  if (!result) return 0
  if (toolResultHasImage(result.content)) return 540
  if (toolName === 'Read') return estimateReadToolResultHeight(result, filePath)
  return estimateGenericToolResultHeight(result)
}
function estimateSimpleToolHeaderHeight(toolName: string, input: Record<string, unknown>): number {
  if (toolName === 'Bash') {
    const command = typeof input.command === 'string' ? input.command : ''
    return estimateTextSectionHeight(command, { lineHeight: 20, padding: 18, min: 38, max: 180 })
  }
  return 38
}
function estimateToolThreadHeight(block: Extract<ThreadedBlock, { type: 'tool_thread'} >): number {
  const { toolUse, result } = block
  const input = toolUse.input as Record<string, unknown>

  if (toolUse.name === 'FileChange') {
    const changes = Array.isArray(input.changes) ? input.changes : []
    const bodyHeight = changes.length === 0
      ? 56
      : changes.reduce((total, change) => {
        const record = change && typeof change === 'object' ? change as Record<string, unknown> : {}
        const diff = typeof record.diff === 'string' ? record.diff : ''
        return total + 84 + estimateTextSectionHeight(diff, { lineHeight: 17, padding: 20, min: 96, max: 420 })
      }, 0)
    return 72 + bodyHeight
  }

  if (toolUse.name === 'MultiEdit') {
    const edits = Array.isArray(input.edits) ? input.edits : []
    const bodyHeight = edits.reduce((total, edit) => {
      const record = edit && typeof edit === 'object' ? edit as Record<string, unknown> : {}
      const oldString = typeof record.old_string === 'string' ? record.old_string : ''
      const newString = typeof record.new_string === 'string' ? record.new_string : ''
      const diffText = `${oldString}\n${newString}`.trim()
      return total + 54 + estimateTextSectionHeight(diffText, { lineHeight: 17, padding: 20, min: 88, max: 260 })
    }, 28)
    return 78 + bodyHeight
  }

  if (toolUse.name === 'TodoWrite') {
    const todos = Array.isArray(input.todos) ? input.todos : []
    return 88 + Math.max(42, todos.length * 28)
  }

  if (toolUse.name === 'AskUserQuestion') {
    const questions = Array.isArray(input.questions) ? input.questions : []
    return 92 + questions.length * 92
  }

  if (toolUse.name === 'Read' || toolUse.name === 'Glob' || toolUse.name === 'Grep' || toolUse.name === 'Bash') {
    const filePath = typeof input.file_path === 'string' ? input.file_path : undefined
    const bodyHeight = toolUse.name === 'Bash' && typeof input.description === 'string' && input.description
      ? 24
      : 0
    return 8 + estimateSimpleToolHeaderHeight(toolUse.name, input) + bodyHeight + estimateToolResultHeight(result, toolUse.name, filePath)
  }

  if (toolUse.name === 'Agent') {
    const description = typeof input.description === 'string' ? input.description : ''
    return 86 + (result ? estimateTextSectionHeight(description, { lineHeight: 16, padding: 10, min: 0, max: 80 }) : 0)
  }

  if (result?.content) {
    if (typeof result.content === 'string') {
      return 86 + estimateTextSectionHeight(result.content, { lineHeight: 18, padding: 16, min: 40, max: 220 })
    }
    return 92 + result.content.reduce((total, child) => total + estimateContentBlockHeight(child), 0)
  }

  return 84
}
function estimateThreadedBlockHeight(block: ThreadedBlock): number {
  if (block.type === 'text') return estimateRenderedTextHeight(block.text)
  if (block.type === 'thinking') return 72
  if (block.type === 'image') return 220
  if (block.type === 'tool_thread') return estimateToolThreadHeight(block)
  if (block.type === 'task_notification') return 96
  if (block.type === 'system_reminder') return 72
  if (block.type === 'coordinator_brief') return 36
  if (block.type === 'coordinator_mail') {
    return 40 + block.messages.reduce((total, message) => total + 30 + Math.min(message.body.split('\n').length, 12) * 19, 0)
  }
  if (block.type === 'slash_command') return 64
  if (block.type === 'local_command_stdout') {
    return 60 + estimateTextSectionHeight(block.stdout, { lineHeight: 17, padding: 8, min: 20, max: 80 })
  }
  if (block.type === 'claude_system') return 72
  return 68
}
export function timelineEstimateBucket(row: TimelineRow, viewMode: WebViewMode): TimelineEstimateBucket {
  if (viewMode === 'stream') return 'stream'
  if (row.message.role === 'system') return 'system'
  if (row.message.blocks.some((block) => (
    block.type === 'image' ||
    (block.type === 'text' && hasStandaloneDataImage(block.text))
  ))) return 'media'
  if (row.message.blocks.some((block) => block.type === 'tool_thread')) return 'tool'
  return 'text'
}
export function estimateTimelineRowHeight(
  row: TimelineRow,
  density: MessageDensity = 'balanced',
  viewMode: WebViewMode = 'conversation'): number {
  const { message } = row
  if (viewMode === 'stream') {
    const textHeight = message.blocks.reduce((total: number, block: ThreadedBlock) => (
      block.type === 'text' ? total + estimateRenderedTextHeight(block.text) : total
    ), 0)
    const toolRowHeight = density === 'dense' ? 26 : density === 'comfortable' ? 36 : 30
    const toolHeight = message.blocks.reduce((total: number, block: ThreadedBlock) => (
      block.type === 'tool_thread' ? total + toolRowHeight : total
    ), 0)
    const marginBottom = message.role === 'user'
      ? (density === 'dense' ? 8 : density === 'comfortable' ? 24 : 14)
      : (density === 'dense' ? 1 : density === 'comfortable' ? 6 : 2)
    const landmarkHeight = (row.streamTurnHint !== undefined ? 24 : 0) + (row.streamTurnFooterHint ? 22 : 0)
    return Math.max(36, 20 + textHeight + toolHeight + marginBottom + landmarkHeight)
  }

  const headerHeight = 82
  const previewHeight = row.previewBadge ? (row.activityDetail ? 42 : 28) : 0
  const liveToolsHeight = row.liveToolActivities && row.liveToolActivities.length > 0
    ? 34 * Math.ceil(row.liveToolActivities.length / 3) + 10
    : 0
  const blockGap = Math.max(message.blocks.length - 1, 0) * 8
  const blockHeight = message.blocks.reduce((total: number, block: ThreadedBlock) => total + estimateThreadedBlockHeight(block), 0)
  const densityAdjustment = density === 'comfortable' ? 16 : density === 'dense' ? -24 : 0
  const estimated = headerHeight + previewHeight + liveToolsHeight + blockGap + blockHeight + densityAdjustment
  return Math.max(estimated, message.role === 'system' ? 120 : ESTIMATED_TIMELINE_ROW_HEIGHT)
}
export function calibratedTimelineRowHeight(
  row: TimelineRow,
  rawEstimate: number,
  viewMode: WebViewMode,
  calibration: ReadonlyMap<TimelineEstimateBucket | 'all', TimelineEstimateCalibration>): number {
  const global = calibration.get('all')
  if (!global || global.sampleCount < TIMELINE_CALIBRATION_MIN_SAMPLES || global.estimatedTotal <= 0) {
    return rawEstimate
  }

  const globalRatio = global.measuredTotal / global.estimatedTotal
  const bucket = calibration.get(timelineEstimateBucket(row, viewMode))
  const bucketRatio = bucket && bucket.estimatedTotal > 0
    ? bucket.measuredTotal / bucket.estimatedTotal
    : globalRatio
  const bucketConfidence = bucket
    ? Math.min(bucket.sampleCount / TIMELINE_CALIBRATION_BUCKET_CONFIDENCE, 1)
    : 0
  const ratio = Math.max(
    TIMELINE_CALIBRATION_MIN_RATIO,
    Math.min(
      TIMELINE_CALIBRATION_MAX_RATIO,
      globalRatio + (bucketRatio - globalRatio) * bucketConfidence
    )
  )
  return Math.max(48, Math.round(rawEstimate * ratio))
}
export function readResizeObserverHeight(entry: ResizeObserverEntry, fallbackNode: HTMLElement): number {
  const borderBoxSize = entry.borderBoxSize
  const firstBorderBox = Array.isArray(borderBoxSize) ? borderBoxSize[0] : borderBoxSize
  if (firstBorderBox?.blockSize) return firstBorderBox.blockSize
  if (entry.contentRect.height) return entry.contentRect.height
  return fallbackNode.getBoundingClientRect().height
}
// One shared ResizeObserver for every mounted timeline row instead of one
// observer instance per row. The virtual scroll keeps dozens of rows mounted
// (visible + overscan), and each native observer carries its own allocation
// and per-frame delivery bookkeeping — pooling them into a single instance
// with a per-element callback map cuts that to one. Semantics match the
// per-row version: observe() still delivers an initial entry per element.
const timelineRowResizeCallbacks = new Map<Element, (entry: ResizeObserverEntry) => void>()
let timelineRowResizeObserver: ResizeObserver | null = null
export function observeTimelineRowResize(node: Element, onResize: (entry: ResizeObserverEntry) => void): () => void {
  if (!timelineRowResizeObserver) {
    timelineRowResizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) timelineRowResizeCallbacks.get(entry.target)?.(entry)
    })
  }
  timelineRowResizeCallbacks.set(node, onResize)
  timelineRowResizeObserver.observe(node)
  return () => {
    timelineRowResizeCallbacks.delete(node)
    timelineRowResizeObserver?.unobserve(node)
    if (timelineRowResizeCallbacks.size === 0) {
      timelineRowResizeObserver?.disconnect()
      timelineRowResizeObserver = null
    }
  }
}
