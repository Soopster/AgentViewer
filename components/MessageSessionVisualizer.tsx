'use client'

import { memo, useDeferredValue, useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Eye,
  EyeOff,
  FileCode2,
  Filter,
  Gauge,
  ImageIcon,
  Maximize2,
  Minimize2,
  MessageSquareText,
  Network,
  Search,
  Sparkles,
  Target,
  Wrench,
  X,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ThreadedBlock, ThreadedMessage } from '@/lib/threading'
import type { AgentProvider, ApiMessage } from '@/lib/types'
import { getAssistantLabel } from '@/lib/provider'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export type MessageVisualizerRow = {
  key: string
  message: ThreadedMessage
  dimmed?: boolean
  previewBadge?: string
  showSession?: boolean
}

type MessageSessionVisualizerProps = {
  rows: MessageVisualizerRow[]
  rawEventCount: number
  loading: boolean
  showSession?: boolean
  onSelectMessage?: (messageId: string) => void
}

type ToolSummary = {
  name: string
  target: string
  error: boolean
  pending: boolean
}

type PhaseKey = 'prompt' | 'reasoning' | 'tooling' | 'verification' | 'handoff' | 'system'

type VisualizerEntry = {
  key: string
  id: string
  index: number
  role: ThreadedMessage['role']
  roleLabel: string
  sessionId?: string
  provider?: AgentProvider
  timestamp?: string
  timestampMs: number | null
  timeLabel: string
  preview: string
  searchText: string
  toolSummaries: ToolSummary[]
  toolCount: number
  pendingToolCount: number
  errorCount: number
  thinkingCount: number
  imageCount: number
  textChars: number
  inputTokens: number
  outputTokens: number
  cacheTokens: number
  dimmed: boolean
  previewBadge?: string
}

type SessionPhase = {
  key: PhaseKey
  label: string
  count: number
  startIndex: number
  endIndex: number
  toolCount: number
  errorCount: number
  color: string
}

type VisualizerStats = {
  turns: number
  rawEventCount: number
  userCount: number
  assistantCount: number
  systemCount: number
  toolCount: number
  toolTurnCount: number
  pendingToolCount: number
  errorCount: number
  imageCount: number
  thinkingCount: number
  inputTokens: number
  outputTokens: number
  cacheTokens: number
  durationLabel: string
  firstTimestampMs: number | null
  lastTimestampMs: number | null
  topTools: Array<{ name: string; count: number; errorCount: number; pendingCount: number }>
  roleSegments: Array<{ key: string; label: string; count: number; color: string }>
  activityBuckets: number[]
  maxChars: number
  longestEntry: VisualizerEntry | null
  busiestEntry: VisualizerEntry | null
  lastEntry: VisualizerEntry | null
}

type VisualizerFilter = 'all' | 'user' | 'assistant' | 'system' | 'tools' | 'errors' | 'thinking' | 'media'
type ActiveVisualizerFilter = Exclude<VisualizerFilter, 'all'>
type VisualizerView = 'rows' | 'graph' | 'execution'
type GraphDensity = 'comfortable' | 'compact'

type PhaseFocus = {
  label: string
  startIndex: number
  endIndex: number
}

type ExecutionNodeKind = 'request' | 'reasoning' | 'tool' | 'edit' | 'verify' | 'result'

type ExecutionNode = {
  id: string
  kind: ExecutionNodeKind
  entryId: string
  title: string
  detail: string
  tone: string
  error?: boolean
  pending?: boolean
}

type ExecutionTask = {
  id: string
  index: number
  request: ExecutionNode
  reasoning: ExecutionNode[]
  tools: ExecutionNode[]
  edits: ExecutionNode[]
  verification: ExecutionNode[]
  result: ExecutionNode | null
  entryIds: Set<string>
  errorCount: number
  pendingCount: number
}

const ROLE_META: Record<ThreadedMessage['role'], { label: string; color: string; glow: string; background: string }> = {
  user: {
    label: 'USER',
    color: 'var(--cyan)',
    glow: 'var(--cyan-glow)',
    background: 'rgba(56,217,245,0.08)',
  },
  assistant: {
    label: 'ASSISTANT',
    color: 'var(--violet)',
    glow: 'var(--violet-glow)',
    background: 'rgba(139,128,240,0.08)',
  },
  system: {
    label: 'SYSTEM',
    color: 'var(--amber, #eaaa40)',
    glow: 'rgba(234,170,64,0.14)',
    background: 'rgba(234,170,64,0.08)',
  },
}

const PHASE_META: Record<PhaseKey, { label: string; shortLabel: string; color: string; background: string }> = {
  prompt: {
    label: 'Prompting',
    shortLabel: 'PROMPT',
    color: 'var(--cyan)',
    background: 'rgba(56,217,245,0.10)',
  },
  reasoning: {
    label: 'Reasoning',
    shortLabel: 'REASON',
    color: 'var(--violet)',
    background: 'rgba(139,128,240,0.10)',
  },
  tooling: {
    label: 'Tool work',
    shortLabel: 'TOOLS',
    color: 'var(--green)',
    background: 'rgba(45,212,160,0.10)',
  },
  verification: {
    label: 'Verification',
    shortLabel: 'VERIFY',
    color: 'var(--amber, #eaaa40)',
    background: 'rgba(234,170,64,0.10)',
  },
  handoff: {
    label: 'Handoff',
    shortLabel: 'HANDOFF',
    color: 'var(--text)',
    background: 'color-mix(in srgb, var(--text) 8%, transparent)',
  },
  system: {
    label: 'System',
    shortLabel: 'SYSTEM',
    color: 'var(--amber, #eaaa40)',
    background: 'rgba(234,170,64,0.10)',
  },
}

const TOOL_COLORS: Record<string, string> = {
  Bash: 'var(--t-bash)',
  Edit: 'var(--t-edit)',
  MultiEdit: 'var(--t-edit)',
  FileChange: 'var(--t-edit)',
  Write: 'var(--t-write)',
  Read: 'var(--t-read)',
  Grep: 'var(--t-grep)',
  Glob: 'var(--t-glob)',
  Agent: 'var(--t-agent)',
  WebSearch: 'var(--cyan)',
  WebFetch: 'var(--t-read)',
  NotebookEdit: 'var(--t-edit)',
}

const FILTERS: Array<{ key: VisualizerFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'user', label: 'User' },
  { key: 'assistant', label: 'Agent' },
  { key: 'tools', label: 'Tools' },
  { key: 'errors', label: 'Errors' },
  { key: 'thinking', label: 'Thinking' },
  { key: 'media', label: 'Media' },
  { key: 'system', label: 'System' },
]

const TOOL_TARGET_KEYS = [
  'command',
  'cmd',
  'file_path',
  'filePath',
  'path',
  'pattern',
  'query',
  'url',
  'description',
  'prompt',
  'server',
  'tool',
]

const FILTER_LABELS = new Map(FILTERS.map((filter) => [filter.key, filter.label]))

const VERIFY_RE = /\b(test|tests|type-check|typecheck|tsc|build|verify|verification|passes|passed|succeeded|success|lint|diagnostic|checked)\b/i
const HANDOFF_RE = /\b(done|completed|wired|implemented|verification passed|ready|left|summary|final)\b/i
const VERIFY_TOOL_RE = /\b(npm|pnpm|bun|yarn)\s+(run\s+)?(test|build|lint|typecheck|tui:check)\b|\bnpx\s+tsc\b|\btsc\s+--noEmit\b|\bgo\s+test\b|\bcargo\s+test\b|\bpytest\b|\bvitest\b|\bjest\b/i
const EDIT_TOOL_NAMES = new Set(['Edit', 'MultiEdit', 'FileChange', 'Write', 'NotebookEdit'])

function toolColor(name: string): string {
  return TOOL_COLORS[name] ?? 'var(--t-other)'
}

function phaseFocusId(phase: SessionPhase): string {
  return `${phase.key}:${phase.startIndex}:${phase.endIndex}`
}

function phaseForEntry(entry: VisualizerEntry, total: number): PhaseKey {
  return classifyEntryPhase(entry, entry.index === total - 1)
}

function compactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`
  return String(value)
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s'
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder > 0 ? `${hours}h ${remainder}m` : `${hours}h`
}

function formatTimeLabel(value?: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function normalizePreview(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function stringifyTargetValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(stringifyTargetValue).filter(Boolean).join(', ')
  return ''
}

function toolTarget(input: Record<string, unknown>): string {
  for (const key of TOOL_TARGET_KEYS) {
    const value = stringifyTargetValue(input[key])
    if (value) return normalizePreview(value).slice(0, 90)
  }
  return ''
}

function textFromToolResult(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      if (!block || typeof block !== 'object') return ''
      const record = block as Record<string, unknown>
      return record.type === 'text' && typeof record.text === 'string' ? record.text : ''
    })
    .filter(Boolean)
    .join(' ')
}

function textFromBlock(block: ThreadedBlock): string {
  switch (block.type) {
    case 'text':
      return block.text
    case 'thinking':
      return block.thinking
    case 'tool_thread': {
      const target = toolTarget(block.toolUse.input)
      return target ? `${block.toolUse.name} ${target}` : block.toolUse.name
    }
    case 'task_notification':
      return block.summary || block.result || block.taskId
    case 'system_reminder':
      return block.content
    case 'slash_command':
      return [block.command, block.message, block.args].filter(Boolean).join(' ')
    case 'local_command_stdout':
      return block.stdout
    case 'claude_system':
      return block.subtype
    case 'image':
      return 'Image'
    default:
      return ''
  }
}

function messagePreview(message: ThreadedMessage): string {
  const preview = message.blocks
    .map(textFromBlock)
    .map(normalizePreview)
    .find(Boolean)
  return preview?.slice(0, 180) ?? `${message.role} message`
}

function messageTextLength(message: ThreadedMessage): number {
  return message.blocks.reduce((total, block) => {
    if (block.type === 'tool_thread') {
      const resultLength = textFromToolResult(block.result?.content).length
      return total + block.toolUse.name.length + toolTarget(block.toolUse.input).length + resultLength
    }
    return total + textFromBlock(block).length
  }, 0)
}

function usageTokens(usage: ApiMessage['usage'] | undefined): { inputTokens: number; outputTokens: number; cacheTokens: number } {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheTokens: (usage?.cache_read_input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0),
  }
}

function buildEntry(row: MessageVisualizerRow, index: number): VisualizerEntry {
  const { message } = row
  const toolSummaries: ToolSummary[] = []
  let thinkingCount = 0
  let imageCount = 0

  for (const block of message.blocks) {
    if (block.type === 'tool_thread') {
      toolSummaries.push({
        name: block.toolUse.name,
        target: toolTarget(block.toolUse.input),
        error: !!block.result?.is_error,
        pending: !block.result,
      })
    } else if (block.type === 'thinking') {
      thinkingCount += 1
    } else if (block.type === 'image') {
      imageCount += 1
    }
  }

  const timestampMs = message.timestamp ? Date.parse(message.timestamp) : Number.NaN
  const tokenUsage = usageTokens(message.usage)
  const roleLabel = message.role === 'assistant'
    ? getAssistantLabel(message.provider)
    : ROLE_META[message.role].label
  const preview = messagePreview(message)
  const searchText = [
    roleLabel,
    message.role,
    message.sessionId,
    message.provider,
    preview,
    ...toolSummaries.flatMap((tool) => [tool.name, tool.target]),
  ].filter(Boolean).join(' ').toLowerCase()

  return {
    key: row.key,
    id: message.uuid,
    index,
    role: message.role,
    roleLabel,
    sessionId: message.sessionId,
    provider: message.provider,
    timestamp: message.timestamp,
    timestampMs: Number.isFinite(timestampMs) ? timestampMs : null,
    timeLabel: formatTimeLabel(message.timestamp),
    preview,
    searchText,
    toolSummaries,
    toolCount: toolSummaries.length,
    pendingToolCount: toolSummaries.filter((tool) => tool.pending).length,
    errorCount: toolSummaries.filter((tool) => tool.error).length,
    thinkingCount,
    imageCount,
    textChars: messageTextLength(message),
    inputTokens: tokenUsage.inputTokens,
    outputTokens: tokenUsage.outputTokens,
    cacheTokens: tokenUsage.cacheTokens,
    dimmed: !!row.dimmed,
    previewBadge: row.previewBadge,
  }
}

function classifyEntryPhase(entry: VisualizerEntry, isLast: boolean): PhaseKey {
  if (entry.role === 'system') return 'system'
  if (entry.role === 'user') return 'prompt'
  if (entry.errorCount > 0 || entry.toolCount > 0) return 'tooling'
  if (VERIFY_RE.test(entry.preview)) return 'verification'
  if (isLast || HANDOFF_RE.test(entry.preview)) return 'handoff'
  return 'reasoning'
}

function buildPhases(entries: VisualizerEntry[]): SessionPhase[] {
  const phases: SessionPhase[] = []

  entries.forEach((entry, index) => {
    const key = classifyEntryPhase(entry, index === entries.length - 1)
    const meta = PHASE_META[key]
    const current = phases.at(-1)

    if (current && current.key === key) {
      current.count += 1
      current.endIndex = entry.index
      current.toolCount += entry.toolCount
      current.errorCount += entry.errorCount
      return
    }

    phases.push({
      key,
      label: meta.label,
      count: 1,
      startIndex: entry.index,
      endIndex: entry.index,
      toolCount: entry.toolCount,
      errorCount: entry.errorCount,
      color: meta.color,
    })
  })

  return phases
}

function buildActivityBuckets(entries: VisualizerEntry[], bucketCount = 36): number[] {
  const buckets = Array.from({ length: bucketCount }, () => 0)
  if (entries.length === 0) return buckets

  const timedEntries = entries.filter((entry) => entry.timestampMs !== null)
  if (timedEntries.length >= 2) {
    const first = timedEntries[0]?.timestampMs ?? 0
    const last = timedEntries.at(-1)?.timestampMs ?? first
    const span = Math.max(last - first, 1)
    for (const entry of timedEntries) {
      const index = Math.min(bucketCount - 1, Math.floor(((entry.timestampMs! - first) / span) * bucketCount))
      buckets[index] += 1 + entry.toolCount + entry.errorCount
    }
    return buckets
  }

  entries.forEach((entry, index) => {
    const bucketIndex = Math.min(bucketCount - 1, Math.floor((index / Math.max(entries.length - 1, 1)) * bucketCount))
    buckets[bucketIndex] += 1 + entry.toolCount + entry.errorCount
  })
  return buckets
}

function buildStats(entries: VisualizerEntry[], rawEventCount: number): VisualizerStats {
  let userCount = 0
  let assistantCount = 0
  let systemCount = 0
  let toolCount = 0
  let toolTurnCount = 0
  let pendingToolCount = 0
  let errorCount = 0
  let imageCount = 0
  let thinkingCount = 0
  let inputTokens = 0
  let outputTokens = 0
  let cacheTokens = 0
  let maxChars = 1
  let longestEntry: VisualizerEntry | null = null
  let busiestEntry: VisualizerEntry | null = null
  const tools = new Map<string, { name: string; count: number; errorCount: number; pendingCount: number }>()
  const timestamps: number[] = []

  for (const entry of entries) {
    if (entry.role === 'user') userCount += 1
    if (entry.role === 'assistant') assistantCount += 1
    if (entry.role === 'system') systemCount += 1
    if (entry.toolCount > 0) toolTurnCount += 1
    toolCount += entry.toolCount
    pendingToolCount += entry.pendingToolCount
    errorCount += entry.errorCount
    imageCount += entry.imageCount
    thinkingCount += entry.thinkingCount
    inputTokens += entry.inputTokens
    outputTokens += entry.outputTokens
    cacheTokens += entry.cacheTokens
    maxChars = Math.max(maxChars, entry.textChars)
    if (entry.timestampMs !== null) timestamps.push(entry.timestampMs)
    if (!longestEntry || entry.textChars > longestEntry.textChars) longestEntry = entry
    if (!busiestEntry || entry.toolCount > busiestEntry.toolCount || (entry.toolCount === busiestEntry.toolCount && entry.errorCount > busiestEntry.errorCount)) {
      busiestEntry = entry
    }

    for (const tool of entry.toolSummaries) {
      const current = tools.get(tool.name) ?? { name: tool.name, count: 0, errorCount: 0, pendingCount: 0 }
      current.count += 1
      if (tool.error) current.errorCount += 1
      if (tool.pending) current.pendingCount += 1
      tools.set(tool.name, current)
    }
  }

  const first = timestamps.length > 0 ? Math.min(...timestamps) : null
  const last = timestamps.length > 0 ? Math.max(...timestamps) : null
  const durationLabel = first !== null && last !== null ? formatDuration(last - first) : '0s'

  return {
    turns: entries.length,
    rawEventCount,
    userCount,
    assistantCount,
    systemCount,
    toolCount,
    toolTurnCount,
    pendingToolCount,
    errorCount,
    imageCount,
    thinkingCount,
    inputTokens,
    outputTokens,
    cacheTokens,
    durationLabel,
    firstTimestampMs: first,
    lastTimestampMs: last,
    topTools: Array.from(tools.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 8),
    roleSegments: [
      { key: 'user', label: 'USER', count: userCount, color: ROLE_META.user.color },
      { key: 'assistant', label: 'ASSISTANT', count: assistantCount, color: ROLE_META.assistant.color },
      { key: 'system', label: 'SYSTEM', count: systemCount, color: ROLE_META.system.color },
    ],
    activityBuckets: buildActivityBuckets(entries),
    maxChars,
    longestEntry,
    busiestEntry,
    lastEntry: entries.at(-1) ?? null,
  }
}

function buildHotEntries(entries: VisualizerEntry[], maxChars: number): VisualizerEntry[] {
  return entries
    .map((entry) => ({
      entry,
      score:
        entry.errorCount * 80
        + entry.pendingToolCount * 45
        + entry.toolCount * 18
        + entry.thinkingCount * 10
        + entry.imageCount * 10
        + (entry.textChars / Math.max(maxChars, 1)) * 28
        + (entry.previewBadge ? 12 : 0),
    }))
    .filter(({ score }) => score > 8)
    .sort((a, b) => b.score - a.score || a.entry.index - b.entry.index)
    .slice(0, 6)
    .map(({ entry }) => entry)
}

function executionNodeIcon(kind: ExecutionNodeKind): LucideIcon {
  switch (kind) {
    case 'request':
      return Target
    case 'reasoning':
      return Sparkles
    case 'tool':
      return Wrench
    case 'edit':
      return FileCode2
    case 'verify':
      return CheckCircle2
    case 'result':
      return MessageSquareText
  }
}

function executionNodeKindLabel(kind: ExecutionNodeKind): string {
  switch (kind) {
    case 'request':
      return 'request'
    case 'reasoning':
      return 'reasoning'
    case 'tool':
      return 'tool'
    case 'edit':
      return 'edit'
    case 'verify':
      return 'verify'
    case 'result':
      return 'result'
  }
}

function isVerificationTool(tool: ToolSummary): boolean {
  return tool.name === 'Bash' && VERIFY_TOOL_RE.test(tool.target)
}

function toolToExecutionNode(entry: VisualizerEntry, tool: ToolSummary, index: number): ExecutionNode {
  const isEdit = EDIT_TOOL_NAMES.has(tool.name)
  const isVerify = isVerificationTool(tool)
  const kind: ExecutionNodeKind = isEdit ? 'edit' : isVerify ? 'verify' : 'tool'
  const tone = tool.error ? 'var(--red)' : tool.pending ? 'var(--amber)' : kind === 'verify' ? 'var(--green)' : kind === 'edit' ? 'var(--cyan)' : toolColor(tool.name)
  return {
    id: `${entry.id}:tool:${index}`,
    kind,
    entryId: entry.id,
    title: tool.name,
    detail: tool.target || entry.preview,
    tone,
    error: tool.error,
    pending: tool.pending,
  }
}

function entryToReasoningNode(entry: VisualizerEntry): ExecutionNode {
  return {
    id: `${entry.id}:reasoning`,
    kind: 'reasoning',
    entryId: entry.id,
    title: entry.thinkingCount > 0 ? 'Reasoning' : entry.roleLabel,
    detail: entry.preview,
    tone: entry.thinkingCount > 0 ? 'var(--violet)' : ROLE_META[entry.role].color,
    error: entry.errorCount > 0,
    pending: entry.pendingToolCount > 0,
  }
}

function entryToResultNode(entry: VisualizerEntry): ExecutionNode {
  return {
    id: `${entry.id}:result`,
    kind: 'result',
    entryId: entry.id,
    title: entry.roleLabel,
    detail: entry.preview,
    tone: entry.errorCount > 0 ? 'var(--red)' : 'var(--text)',
    error: entry.errorCount > 0,
    pending: entry.pendingToolCount > 0,
  }
}

function buildExecutionTasks(entries: VisualizerEntry[]): ExecutionTask[] {
  const tasks: ExecutionTask[] = []
  let current: ExecutionTask | null = null

  const startTask = (entry: VisualizerEntry): ExecutionTask => {
    const next: ExecutionTask = {
      id: `task:${entry.id}`,
      index: tasks.length,
      request: {
        id: `${entry.id}:request`,
        kind: 'request',
        entryId: entry.id,
        title: `Request ${tasks.length + 1}`,
        detail: entry.preview,
        tone: ROLE_META.user.color,
        error: entry.errorCount > 0,
        pending: entry.pendingToolCount > 0,
      },
      reasoning: [],
      tools: [],
      edits: [],
      verification: [],
      result: null,
      entryIds: new Set([entry.id]),
      errorCount: entry.errorCount,
      pendingCount: entry.pendingToolCount,
    }
    tasks.push(next)
    return next
  }

  for (const entry of entries) {
    if (entry.role === 'user') {
      current = startTask(entry)
      continue
    }

    if (!current) current = startTask(entry)
    if (!current) continue

    if (!current.entryIds.has(entry.id)) {
      current.entryIds.add(entry.id)
      current.errorCount += entry.errorCount
      current.pendingCount += entry.pendingToolCount
    }

    if (entry.toolSummaries.length > 0) {
      entry.toolSummaries.forEach((tool, index) => {
        const node = toolToExecutionNode(entry, tool, index)
        if (node.kind === 'edit') current!.edits.push(node)
        else if (node.kind === 'verify') current!.verification.push(node)
        else current!.tools.push(node)
      })
      continue
    }

    if (entry.role === 'assistant') {
      const node = VERIFY_RE.test(entry.preview) ? { ...entryToResultNode(entry), kind: 'verify' as const, title: 'Verification note', tone: 'var(--green)' } : entryToReasoningNode(entry)
      if (node.kind === 'verify') current.verification.push(node)
      else {
        current.reasoning.push(node)
        current.result = entryToResultNode(entry)
      }
    } else if (entry.role === 'system') {
      current.reasoning.push(entryToReasoningNode(entry))
    }
  }

  return tasks
}

function entryMatchesFilter(entry: VisualizerEntry, filter: ActiveVisualizerFilter): boolean {
  switch (filter) {
    case 'user':
    case 'assistant':
    case 'system':
      return entry.role === filter
    case 'tools':
      return entry.toolCount > 0
    case 'errors':
      return entry.errorCount > 0 || entry.pendingToolCount > 0
    case 'thinking':
      return entry.thinkingCount > 0
    case 'media':
      return entry.imageCount > 0
  }
}

function entryMatchesFilters(entry: VisualizerEntry, activeFilters: ActiveVisualizerFilter[]): boolean {
  return activeFilters.length === 0 || activeFilters.some((filter) => entryMatchesFilter(entry, filter))
}

function StatPill({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: LucideIcon
  label: string
  value: string
  tone?: string
}) {
  return (
    <div className="av-session-viz-stat">
      <Icon aria-hidden="true" style={{ width: 14, height: 14, color: tone ?? 'var(--text-3)', flexShrink: 0 }} />
      <span>{label}</span>
      <strong style={{ color: tone ?? 'var(--text)' }}>{value}</strong>
    </div>
  )
}

function RoleSplit({ stats }: { stats: VisualizerStats }) {
  const total = Math.max(stats.userCount + stats.assistantCount + stats.systemCount, 1)

  return (
    <div className="av-session-viz-panel">
      <div className="av-session-viz-panel-title">ROLE SPLIT</div>
      <div className="av-session-viz-rolebar" aria-hidden="true">
        {stats.roleSegments.map((segment) => (
          <div
            key={segment.key}
            style={{
              flexBasis: `${Math.max(2, (segment.count / total) * 100)}%`,
              background: segment.color,
              opacity: segment.count > 0 ? 0.9 : 0.2,
            }}
          />
        ))}
      </div>
      <div className="av-session-viz-legend">
        {stats.roleSegments.map((segment) => (
          <span key={segment.key}>
            <i aria-hidden="true" style={{ background: segment.color }} />
            {segment.label} {segment.count}
          </span>
        ))}
      </div>
    </div>
  )
}

function ActivitySparkline({ buckets }: { buckets: number[] }) {
  const max = Math.max(...buckets, 1)

  return (
    <div className="av-session-viz-panel">
      <div className="av-session-viz-panel-title">ACTIVITY SIGNATURE</div>
      <div className="av-session-viz-sparkline" aria-hidden="true">
        {buckets.map((value, index) => (
          <span
            key={`${index}-${value}`}
            style={{
              height: `${Math.max(8, (value / max) * 100)}%`,
              opacity: value > 0 ? 0.92 : 0.18,
            }}
          />
        ))}
      </div>
    </div>
  )
}

function ToolMix({
  stats,
  activeTool,
  onSelectTool,
}: {
  stats: VisualizerStats
  activeTool: string | null
  onSelectTool: (toolName: string) => void
}) {
  const max = Math.max(...stats.topTools.map((tool) => tool.count), 1)

  return (
    <div className="av-session-viz-panel">
      <div className="av-session-viz-panel-title">TOOL MIX</div>
      {stats.topTools.length === 0 ? (
        <div className="av-session-viz-muted">No tools in this view.</div>
      ) : (
        <div className="av-session-viz-toolmix">
          {stats.topTools.map((tool) => (
            <button
              key={tool.name}
              type="button"
              className={cn('av-session-viz-toolmix-row', activeTool === tool.name && 'av-active')}
              onClick={() => onSelectTool(tool.name)}
              title={`Focus turns using ${tool.name}`}
            >
              <span title={tool.name}>{tool.name}</span>
              <div aria-hidden="true">
                <i
                  style={{
                    width: `${Math.max(7, (tool.count / max) * 100)}%`,
                    background: tool.errorCount > 0 ? 'var(--red, #f87171)' : tool.pendingCount > 0 ? 'var(--amber, #eaaa40)' : toolColor(tool.name),
                  }}
                />
              </div>
              <strong>{tool.count}</strong>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function InsightCard({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: LucideIcon
  label: string
  value: string
  detail: string
  tone: string
}) {
  return (
    <div className="av-session-viz-insight">
      <Icon aria-hidden="true" style={{ color: tone }} />
      <span>
        <b>{label}</b>
        <strong style={{ color: tone }}>{value}</strong>
        <em>{detail}</em>
      </span>
    </div>
  )
}

function InsightStack({ stats }: { stats: VisualizerStats }) {
  const toolRate = stats.turns > 0 ? Math.round((stats.toolTurnCount / stats.turns) * 100) : 0
  const outputRatio = stats.inputTokens > 0 ? Math.round((stats.outputTokens / stats.inputTokens) * 100) : 0
  const longest = stats.longestEntry ? `Turn ${stats.longestEntry.index + 1}` : 'None'

  return (
    <div className="av-session-viz-panel">
      <div className="av-session-viz-panel-title">SESSION READOUT</div>
      <div className="av-session-viz-insights">
        <InsightCard
          icon={Gauge}
          label="tool density"
          value={`${toolRate}%`}
          detail={`${stats.toolTurnCount} tool-active turns`}
          tone="var(--green)"
        />
        <InsightCard
          icon={AlertTriangle}
          label="recovery"
          value={stats.errorCount > 0 ? `${stats.errorCount}` : 'clean'}
          detail={stats.pendingToolCount > 0 ? `${stats.pendingToolCount} pending tool results` : 'no tool failures'}
          tone={stats.errorCount > 0 || stats.pendingToolCount > 0 ? 'var(--red)' : 'var(--text-3)'}
        />
        <InsightCard
          icon={Zap}
          label="token shape"
          value={stats.inputTokens > 0 || stats.outputTokens > 0 ? `${outputRatio}%` : 'n/a'}
          detail={`${compactNumber(stats.cacheTokens)} cached input tokens`}
          tone="var(--violet)"
        />
        <InsightCard
          icon={Target}
          label="largest turn"
          value={longest}
          detail={stats.longestEntry ? `${compactNumber(stats.longestEntry.textChars)} chars` : 'no content'}
          tone="var(--cyan)"
        />
      </div>
    </div>
  )
}

function PhaseStrip({
  phases,
  total,
  activePhaseId,
  onSelectPhase,
}: {
  phases: SessionPhase[]
  total: number
  activePhaseId: string | null
  onSelectPhase: (phase: SessionPhase) => void
}) {
  return (
    <div className="av-session-viz-blueprint">
      <div className="av-session-viz-blueprint-head">
        <span>
          <Sparkles aria-hidden="true" />
          Session blueprint
        </span>
        <em>{phases.length} phases</em>
      </div>
      <div className="av-session-viz-phasebar">
        {phases.map((phase, index) => (
          <button
            key={`${phase.key}-${phase.startIndex}-${index}`}
            type="button"
            className={cn('av-session-viz-phase', activePhaseId === phaseFocusId(phase) && 'av-active')}
            onClick={() => onSelectPhase(phase)}
            style={{
              '--av-phase-color': phase.color,
              flexGrow: Math.max(phase.count, 1),
              flexBasis: `${Math.max(8, (phase.count / Math.max(total, 1)) * 100)}%`,
            } as CSSProperties}
            title={`${phase.label}: turns ${phase.startIndex + 1}-${phase.endIndex + 1}`}
          >
            <strong>{PHASE_META[phase.key].shortLabel}</strong>
            <span>{phase.count}</span>
            {phase.toolCount > 0 && <b>{phase.toolCount} tools</b>}
            {phase.errorCount > 0 && <b className="av-error">{phase.errorCount} errors</b>}
          </button>
        ))}
      </div>
    </div>
  )
}

function HotTurns({
  entries,
  selectedEntryId,
  onInspectEntry,
}: {
  entries: VisualizerEntry[]
  selectedEntryId: string | null
  onInspectEntry: (entryId: string) => void
}) {
  return (
    <div className="av-session-viz-panel">
      <div className="av-session-viz-panel-title">HOT TURNS</div>
      {entries.length === 0 ? (
        <div className="av-session-viz-muted">No standout turns yet.</div>
      ) : (
        <div className="av-session-viz-hotlist">
          {entries.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className={cn(selectedEntryId === entry.id && 'av-active')}
              onClick={() => onInspectEntry(entry.id)}
              style={{ '--av-hot-color': ROLE_META[entry.role].color } as CSSProperties}
            >
              <span>{String(entry.index + 1).padStart(2, '0')}</span>
              <strong>{entry.roleLabel}</strong>
              <em>{entry.toolCount > 0 ? `${entry.toolCount} tools` : `${compactNumber(entry.textChars)} chars`}</em>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function EntryTools({ entry }: { entry: VisualizerEntry }) {
  if (entry.toolSummaries.length === 0) {
    return <span className="av-session-viz-no-tools">No tools</span>
  }

  return (
    <span className="av-session-viz-toolchips">
      {entry.toolSummaries.slice(0, 4).map((tool, index) => (
        <span
          key={`${entry.id}-${tool.name}-${index}`}
          className={cn('av-session-viz-toolchip', tool.error && 'av-error', tool.pending && 'av-pending')}
          title={[tool.name, tool.target].filter(Boolean).join(': ')}
          style={{ '--av-tool-color': tool.error ? 'var(--red)' : tool.pending ? 'var(--amber)' : toolColor(tool.name) } as CSSProperties}
        >
          <i aria-hidden="true" />
          {tool.name}
        </span>
      ))}
      {entry.toolSummaries.length > 4 && (
        <b className="av-session-viz-toolmore">+{entry.toolSummaries.length - 4}</b>
      )}
    </span>
  )
}

function FlowEntry({
  entry,
  maxChars,
  total,
  selected,
  onInspectEntry,
  showSession,
}: {
  entry: VisualizerEntry
  maxChars: number
  total: number
  selected: boolean
  onInspectEntry: (entryId: string) => void
  showSession?: boolean
}) {
  const meta = ROLE_META[entry.role]
  const phaseKey = phaseForEntry(entry, total)
  const phaseMeta = PHASE_META[phaseKey]
  const activityWidth = `${Math.max(4, Math.min(100, (entry.textChars / maxChars) * 100))}%`
  const tokenLabel = entry.inputTokens > 0 || entry.outputTokens > 0
    ? `${compactNumber(entry.inputTokens)} / ${compactNumber(entry.outputTokens)}`
    : ''

  return (
    <button
      type="button"
      className={cn('av-session-viz-entry', entry.dimmed && 'av-dimmed', entry.errorCount > 0 && 'av-has-error', selected && 'av-selected')}
      onClick={() => onInspectEntry(entry.id)}
      aria-label={`Inspect ${entry.roleLabel} message ${entry.index + 1}`}
      style={{
        '--av-entry-color': meta.color,
        '--av-entry-glow': meta.glow,
        '--av-entry-bg': meta.background,
        '--av-phase-color': phaseMeta.color,
        '--av-phase-bg': phaseMeta.background,
      } as CSSProperties}
    >
      <span className="av-session-viz-index">{String(entry.index + 1).padStart(2, '0')}</span>
      <span className="av-session-viz-entry-role">
        <i aria-hidden="true" />
        <strong>{entry.roleLabel}</strong>
        {entry.timeLabel && <em>{entry.timeLabel}</em>}
      </span>
      <span className="av-session-viz-entry-body">
        <span className="av-session-viz-entry-head">
          <b>{phaseMeta.shortLabel}</b>
          {entry.previewBadge && <b className="av-live">{entry.previewBadge}</b>}
          {entry.errorCount > 0 && <b className="av-error">{entry.errorCount} ERROR</b>}
          {entry.pendingToolCount > 0 && <b className="av-pending">{entry.pendingToolCount} PENDING</b>}
          {showSession && entry.sessionId && <em>{entry.sessionId.slice(0, 8)}</em>}
        </span>
        <span className="av-session-viz-preview">{entry.preview}</span>
        <span className="av-session-viz-activity" aria-hidden="true">
          <i style={{ width: activityWidth }} />
        </span>
      </span>
      <EntryTools entry={entry} />
      <span className="av-session-viz-entry-meta">
        {entry.toolCount > 0 && <span>{entry.toolCount} tools</span>}
        {entry.thinkingCount > 0 && <span>{entry.thinkingCount} thoughts</span>}
        {entry.imageCount > 0 && <span>{entry.imageCount} images</span>}
        {entry.textChars > 0 && <span>{compactNumber(entry.textChars)} chars</span>}
        {tokenLabel && <span>{tokenLabel} tok</span>}
      </span>
    </button>
  )
}

function GraphToolNode({
  tool,
  entryId,
  index,
}: {
  tool: ToolSummary
  entryId: string
  index: number
}) {
  const status = tool.error ? 'ERROR' : tool.pending ? 'PENDING' : 'SUCCESS'
  const nodeColor = tool.error ? 'var(--red)' : tool.pending ? 'var(--amber)' : toolColor(tool.name)

  return (
    <div
      className={cn('av-session-viz-graph-node av-tool-node', tool.error && 'av-error', tool.pending && 'av-pending')}
      style={{
        '--av-node-color': nodeColor,
        '--av-node-glow': `color-mix(in srgb, ${nodeColor} 18%, transparent)`,
      } as CSSProperties}
      title={[tool.name, tool.target].filter(Boolean).join(': ')}
    >
      <span className="av-session-viz-graph-node-kind">
        <Wrench aria-hidden="true" />
        tool
      </span>
      <strong>{tool.name}</strong>
      {tool.target && <p>{tool.target}</p>}
      <em>{status} / turn {entryId.slice(0, 8)} / #{index + 1}</em>
    </div>
  )
}

function GraphEntry({
  entry,
  total,
  selected,
  showTools,
  onInspectEntry,
}: {
  entry: VisualizerEntry
  total: number
  selected: boolean
  showTools: boolean
  onInspectEntry: (entryId: string) => void
}) {
  const meta = ROLE_META[entry.role]
  const phaseKey = phaseForEntry(entry, total)
  const phaseMeta = PHASE_META[phaseKey]
  const tokenLabel = entry.inputTokens > 0 || entry.outputTokens > 0
    ? `${compactNumber(entry.inputTokens)} / ${compactNumber(entry.outputTokens)} tokens`
    : `${compactNumber(entry.textChars)} chars`

  return (
    <div className="av-session-viz-graph-unit">
      <button
        type="button"
        className={cn('av-session-viz-graph-node av-message-node', entry.errorCount > 0 && 'av-error', selected && 'av-selected')}
        onClick={() => onInspectEntry(entry.id)}
        style={{
          '--av-node-color': meta.color,
          '--av-node-glow': meta.glow,
          '--av-phase-color': phaseMeta.color,
        } as CSSProperties}
      >
        <span className="av-session-viz-graph-node-kind">
          <Network aria-hidden="true" />
          {phaseMeta.shortLabel}
        </span>
        <strong>{entry.roleLabel}</strong>
        <p>{entry.preview}</p>
        <em>
          turn {String(entry.index + 1).padStart(2, '0')} / {tokenLabel}
          {entry.timeLabel ? ` / ${entry.timeLabel}` : ''}
        </em>
      </button>
      {showTools ? (
        entry.toolSummaries.map((tool, index) => (
          <GraphToolNode
            key={`${entry.id}:tool:${tool.name}:${index}`}
            tool={tool}
            entryId={entry.id}
            index={index}
          />
        ))
      ) : entry.toolCount > 0 ? (
        <div className="av-session-viz-graph-tool-summary">
          <Wrench aria-hidden="true" />
          <span>{entry.toolCount} tools</span>
          {entry.errorCount > 0 && <b className="av-error">{entry.errorCount} errors</b>}
          {entry.pendingToolCount > 0 && <b className="av-pending">{entry.pendingToolCount} pending</b>}
        </div>
      ) : null}
    </div>
  )
}

function NodeGraphView({
  entries,
  total,
  selectedEntryId,
  showTools,
  density,
  onToggleTools,
  onToggleDensity,
  onInspectEntry,
}: {
  entries: VisualizerEntry[]
  total: number
  selectedEntryId: string | null
  showTools: boolean
  density: GraphDensity
  onToggleTools: () => void
  onToggleDensity: () => void
  onInspectEntry: (entryId: string) => void
}) {
  if (entries.length === 0) {
    return (
      <div className="av-session-viz-no-results">
        No nodes match the current filter.
      </div>
    )
  }

  const selectedIndex = selectedEntryId ? entries.findIndex((entry) => entry.id === selectedEntryId) : -1
  const selectedEntry = selectedIndex >= 0 ? entries[selectedIndex] : null
  const visibleToolCount = entries.reduce((count, entry) => count + entry.toolCount, 0)
  const visibleErrorCount = entries.reduce((count, entry) => count + entry.errorCount + entry.pendingToolCount, 0)

  return (
    <div className={cn('av-session-viz-nodegraph', density === 'compact' && 'av-compact')} aria-label="Execution graph">
      <div className="av-session-viz-nodegraph-head">
        <span>
          <Network aria-hidden="true" />
          Node flow
        </span>
        <div className="av-session-viz-nodegraph-actions">
          <button
            type="button"
            onClick={onToggleTools}
            title={showTools ? 'Hide tool nodes' : 'Show tool nodes'}
          >
            {showTools ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
            {showTools ? 'Hide tools' : 'Show tools'}
          </button>
          <button
            type="button"
            onClick={onToggleDensity}
            title={density === 'compact' ? 'Use comfortable graph spacing' : 'Use compact graph spacing'}
          >
            <Minimize2 aria-hidden="true" />
            {density === 'compact' ? 'Comfort' : 'Compact'}
          </button>
          <em>{entries.length} turns / {visibleToolCount} tools</em>
        </div>
      </div>
      <div className="av-session-viz-graph-readout">
        <span>
          {selectedEntry
            ? `Selected turn ${selectedEntry.index + 1} / ${selectedEntry.roleLabel} / ${selectedEntry.toolCount} tools`
            : `${entries.length} visible turns / ${visibleErrorCount} issues`}
        </span>
        <div>
          <button
            type="button"
            disabled={selectedIndex <= 0}
            onClick={() => {
              if (selectedIndex > 0) onInspectEntry(entries[selectedIndex - 1]!.id)
            }}
          >
            <ChevronUp aria-hidden="true" />
            Prev
          </button>
          <button
            type="button"
            disabled={selectedIndex < 0 || selectedIndex >= entries.length - 1}
            onClick={() => {
              if (selectedIndex >= 0 && selectedIndex < entries.length - 1) onInspectEntry(entries[selectedIndex + 1]!.id)
            }}
          >
            <ChevronDown aria-hidden="true" />
            Next
          </button>
        </div>
      </div>
      <div className="av-session-viz-nodechain">
        {entries.map((entry) => (
          <GraphEntry
            key={entry.key}
            entry={entry}
            total={total}
            selected={selectedEntryId === entry.id}
            showTools={showTools}
            onInspectEntry={onInspectEntry}
          />
        ))}
      </div>
    </div>
  )
}

function ExecutionNodeButton({
  node,
  selected,
  onInspectEntry,
}: {
  node: ExecutionNode
  selected: boolean
  onInspectEntry: (entryId: string) => void
}) {
  const Icon = executionNodeIcon(node.kind)
  return (
    <button
      type="button"
      className={cn('av-session-viz-exec-node', node.error && 'av-error', node.pending && 'av-pending', selected && 'av-selected')}
      onClick={() => onInspectEntry(node.entryId)}
      style={{
        '--av-exec-node-color': node.tone,
      } as CSSProperties}
      title={node.detail}
    >
      <span>
        <Icon aria-hidden="true" />
        {executionNodeKindLabel(node.kind)}
      </span>
      <strong>{node.title}</strong>
      <p>{node.detail}</p>
      {(node.error || node.pending) && <em>{node.error ? 'error' : 'pending'}</em>}
    </button>
  )
}

function ExecutionLane({
  label,
  nodes,
  empty,
  selectedEntryId,
  onInspectEntry,
}: {
  label: string
  nodes: ExecutionNode[]
  empty: string
  selectedEntryId: string | null
  onInspectEntry: (entryId: string) => void
}) {
  return (
    <div className="av-session-viz-exec-lane">
      <span>{label}</span>
      <div>
        {nodes.length === 0 ? (
          <em>{empty}</em>
        ) : nodes.slice(0, 8).map((node) => (
          <ExecutionNodeButton
            key={node.id}
            node={node}
            selected={selectedEntryId === node.entryId}
            onInspectEntry={onInspectEntry}
          />
        ))}
        {nodes.length > 8 && <b>+{nodes.length - 8} more</b>}
      </div>
    </div>
  )
}

function ExecutionTaskCard({
  task,
  selectedEntryId,
  onInspectEntry,
}: {
  task: ExecutionTask
  selectedEntryId: string | null
  onInspectEntry: (entryId: string) => void
}) {
  const resultNodes = task.result ? [task.result] : []
  const statusTone = task.errorCount > 0 ? 'var(--red)' : task.pendingCount > 0 ? 'var(--amber)' : 'var(--green)'
  return (
    <article className="av-session-viz-exec-task">
      <div className="av-session-viz-exec-task-head">
        <span style={{ '--av-exec-status': statusTone } as CSSProperties}>
          {task.errorCount > 0 ? <AlertTriangle aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
          Task {task.index + 1}
        </span>
        <strong title={task.request.detail}>{task.request.detail}</strong>
        <em>
          {task.entryIds.size} turns / {task.tools.length + task.edits.length + task.verification.length} actions
          {task.errorCount > 0 ? ` / ${task.errorCount} errors` : ''}
          {task.pendingCount > 0 ? ` / ${task.pendingCount} pending` : ''}
        </em>
      </div>
      <div className="av-session-viz-exec-chain">
        <ExecutionNodeButton
          node={task.request}
          selected={selectedEntryId === task.request.entryId}
          onInspectEntry={onInspectEntry}
        />
        <ExecutionLane label="Reasoning" nodes={task.reasoning} empty="no agent text" selectedEntryId={selectedEntryId} onInspectEntry={onInspectEntry} />
        <ExecutionLane label="Tools" nodes={task.tools} empty="no tools" selectedEntryId={selectedEntryId} onInspectEntry={onInspectEntry} />
        <ExecutionLane label="Edits" nodes={task.edits} empty="no file edits" selectedEntryId={selectedEntryId} onInspectEntry={onInspectEntry} />
        <ExecutionLane label="Verify" nodes={task.verification} empty="not seen" selectedEntryId={selectedEntryId} onInspectEntry={onInspectEntry} />
        <ExecutionLane label="Result" nodes={resultNodes} empty="no final text" selectedEntryId={selectedEntryId} onInspectEntry={onInspectEntry} />
      </div>
    </article>
  )
}

function ExecutionFlowView({
  tasks,
  selectedEntryId,
  onInspectEntry,
}: {
  tasks: ExecutionTask[]
  selectedEntryId: string | null
  onInspectEntry: (entryId: string) => void
}) {
  if (tasks.length === 0) {
    return (
      <div className="av-session-viz-no-results">
        No execution tasks match the current filter.
      </div>
    )
  }

  const errorCount = tasks.reduce((total, task) => total + task.errorCount, 0)
  const actionCount = tasks.reduce((total, task) => total + task.tools.length + task.edits.length + task.verification.length, 0)

  return (
    <div className="av-session-viz-exec" aria-label="Execution timeline">
      <div className="av-session-viz-exec-head">
        <span>
          <Network aria-hidden="true" />
          Execution timeline
        </span>
        <em>{tasks.length} requests / {actionCount} actions / {errorCount} issues</em>
      </div>
      <div className="av-session-viz-exec-list">
        {tasks.map((task) => (
          <ExecutionTaskCard
            key={task.id}
            task={task}
            selectedEntryId={selectedEntryId}
            onInspectEntry={onInspectEntry}
          />
        ))}
      </div>
    </div>
  )
}

function ActiveFocusBar({
  activeFilters,
  phaseFocus,
  activeTool,
  query,
  shownCount,
  total,
  onClearFilter,
  onClearPhase,
  onClearTool,
  onClearQuery,
  onClearAll,
}: {
  activeFilters: ActiveVisualizerFilter[]
  phaseFocus: PhaseFocus | null
  activeTool: string | null
  query: string
  shownCount: number
  total: number
  onClearFilter: (filter: ActiveVisualizerFilter) => void
  onClearPhase: () => void
  onClearTool: () => void
  onClearQuery: () => void
  onClearAll: () => void
}) {
  const hasFocus = activeFilters.length > 0 || phaseFocus || activeTool || query.trim()
  if (!hasFocus) return null

  return (
    <div className="av-session-viz-focusbar">
      <span className="av-session-viz-focus-count">
        {shownCount} of {total} turns
      </span>
      {activeFilters.map((filter) => (
        <button
          key={filter}
          type="button"
          className="av-session-viz-focus-chip"
          onClick={() => onClearFilter(filter)}
        >
          Filter: {FILTER_LABELS.get(filter) ?? filter}
          <X aria-hidden="true" />
        </button>
      ))}
      {phaseFocus && (
        <button type="button" className="av-session-viz-focus-chip" onClick={onClearPhase}>
          Phase: {phaseFocus.label} {phaseFocus.startIndex + 1}-{phaseFocus.endIndex + 1}
          <X aria-hidden="true" />
        </button>
      )}
      {activeTool && (
        <button type="button" className="av-session-viz-focus-chip" onClick={onClearTool}>
          Tool: {activeTool}
          <X aria-hidden="true" />
        </button>
      )}
      {query.trim() && (
        <button type="button" className="av-session-viz-focus-chip" onClick={onClearQuery}>
          Search: {query.trim()}
          <X aria-hidden="true" />
        </button>
      )}
      <button type="button" className="av-session-viz-clear-focus" onClick={onClearAll}>
        Clear all
      </button>
    </div>
  )
}

function TurnInspector({
  entry,
  total,
  isPinned,
  onOpenMessage,
  onClearSelection,
}: {
  entry: VisualizerEntry | null
  total: number
  isPinned: boolean
  onOpenMessage?: (messageId: string) => void
  onClearSelection: () => void
}) {
  if (!entry) {
    return (
      <div className="av-session-viz-panel">
        <div className="av-session-viz-panel-title">TURN INSPECTOR</div>
        <div className="av-session-viz-muted">Select a turn to inspect it.</div>
      </div>
    )
  }

  const roleMeta = ROLE_META[entry.role]
  const phaseMeta = PHASE_META[phaseForEntry(entry, total)]
  const tokenLabel = entry.inputTokens > 0 || entry.outputTokens > 0
    ? `${compactNumber(entry.inputTokens)} in / ${compactNumber(entry.outputTokens)} out`
    : 'n/a'
  const statusLabel = entry.errorCount > 0
    ? `${entry.errorCount} errors`
    : entry.pendingToolCount > 0
      ? `${entry.pendingToolCount} pending`
      : 'clean'

  return (
    <div className="av-session-viz-panel av-session-viz-inspector">
      <div className="av-session-viz-panel-title av-session-viz-inspector-title">
        <span>{isPinned ? 'TURN INSPECTOR' : 'MOST ACTIVE TURN'}</span>
        {isPinned && (
          <button type="button" onClick={onClearSelection} title="Clear selected turn">
            <X aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="av-session-viz-inspector-head">
        <span
          aria-hidden="true"
          style={{ background: roleMeta.color, boxShadow: `0 0 14px ${roleMeta.glow}` }}
        />
        <div>
          <strong>Turn {entry.index + 1}</strong>
          <em>{entry.roleLabel} / {phaseMeta.shortLabel}{entry.timeLabel ? ` / ${entry.timeLabel}` : ''}</em>
        </div>
      </div>
      <p className="av-session-viz-inspector-preview">{entry.preview}</p>
      <div className="av-session-viz-inspector-metrics">
        <span><b>tools</b>{entry.toolCount}</span>
        <span><b>status</b>{statusLabel}</span>
        <span><b>tokens</b>{tokenLabel}</span>
        <span><b>size</b>{compactNumber(entry.textChars)} chars</span>
      </div>
      {entry.toolSummaries.length > 0 && (
        <div className="av-session-viz-inspector-tools">
          {entry.toolSummaries.slice(0, 6).map((tool, index) => (
            <span
              key={`${entry.id}:inspector-tool:${tool.name}:${index}`}
              style={{ '--av-tool-color': tool.error ? 'var(--red)' : tool.pending ? 'var(--amber)' : toolColor(tool.name) } as CSSProperties}
            >
              <i aria-hidden="true" />
              <b>{tool.name}</b>
              {tool.target && <em>{tool.target}</em>}
            </span>
          ))}
          {entry.toolSummaries.length > 6 && <strong>+{entry.toolSummaries.length - 6} more tools</strong>}
        </div>
      )}
      <div className="av-session-viz-inspector-actions">
        <button
          type="button"
          disabled={!onOpenMessage}
          onClick={() => onOpenMessage?.(entry.id)}
        >
          <ExternalLink aria-hidden="true" />
          Open in transcript
        </button>
      </div>
    </div>
  )
}

function MessageSessionVisualizer({
  rows,
  rawEventCount,
  loading,
  showSession,
  onSelectMessage,
}: MessageSessionVisualizerProps) {
  const [activeFilters, setActiveFilters] = useState<ActiveVisualizerFilter[]>([])
  const [activeView, setActiveView] = useState<VisualizerView>('rows')
  const [activePhaseId, setActivePhaseId] = useState<string | null>(null)
  const [activeTool, setActiveTool] = useState<string | null>(null)
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null)
  const [graphShowTools, setGraphShowTools] = useState(true)
  const [graphDensity, setGraphDensity] = useState<GraphDensity>('comfortable')
  const [timelineMaximized, setTimelineMaximized] = useState(false)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const normalizedQuery = deferredQuery.trim().toLowerCase()
  const entries = useMemo(() => rows.map(buildEntry), [rows])
  const stats = useMemo(() => buildStats(entries, rawEventCount), [entries, rawEventCount])
  const phases = useMemo(() => buildPhases(entries), [entries])
  const phaseFocus = useMemo<PhaseFocus | null>(() => {
    if (!activePhaseId) return null
    const phase = phases.find((candidate) => phaseFocusId(candidate) === activePhaseId)
    if (!phase) return null
    return {
      label: phase.label,
      startIndex: phase.startIndex,
      endIndex: phase.endIndex,
    }
  }, [activePhaseId, phases])
  const hotEntries = useMemo(() => buildHotEntries(entries, stats.maxChars), [entries, stats.maxChars])
  const filteredEntries = useMemo(() => entries.filter((entry) => {
    if (!entryMatchesFilters(entry, activeFilters)) return false
    if (phaseFocus && (entry.index < phaseFocus.startIndex || entry.index > phaseFocus.endIndex)) return false
    if (activeTool && !entry.toolSummaries.some((tool) => tool.name === activeTool)) return false
    if (!normalizedQuery) return true
    return entry.searchText.includes(normalizedQuery)
  }), [activeFilters, activeTool, entries, normalizedQuery, phaseFocus])
  const executionTasks = useMemo(() => buildExecutionTasks(filteredEntries), [filteredEntries])
  const selectedEntry = useMemo(() => {
    if (selectedEntryId) {
      const selected = entries.find((entry) => entry.id === selectedEntryId)
      if (selected) return selected
    }
    return hotEntries[0] ?? stats.longestEntry ?? stats.lastEntry
  }, [entries, hotEntries, selectedEntryId, stats.lastEntry, stats.longestEntry])
  const isPinnedSelection = selectedEntryId !== null && selectedEntry?.id === selectedEntryId

  useEffect(() => {
    if (activePhaseId && !phases.some((phase) => phaseFocusId(phase) === activePhaseId)) {
      setActivePhaseId(null)
    }
  }, [activePhaseId, phases])

  useEffect(() => {
    if (selectedEntryId && !entries.some((entry) => entry.id === selectedEntryId)) {
      setSelectedEntryId(null)
    }
  }, [entries, selectedEntryId])

  if (loading) {
    return (
      <div className="av-session-viz-loading">
        Loading...
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="av-session-viz-empty">
        No messages.
      </div>
    )
  }

  return (
    <Card className="av-session-visualizer">
      <div className="av-session-viz-fixed-header">
        <CardHeader className="av-session-viz-header">
          <div>
            <CardTitle className="av-session-viz-title">
              <Network aria-hidden="true" style={{ width: 17, height: 17 }} />
              Session Visualiser
            </CardTitle>
            <div className="av-session-viz-subtitle">
              {stats.turns} turns / {stats.rawEventCount} events / {stats.durationLabel}
            </div>
          </div>
          <div className="av-session-viz-stats">
            <StatPill icon={MessageSquareText} label="turns" value={compactNumber(stats.turns)} tone="var(--cyan)" />
            <StatPill icon={Wrench} label="tools" value={compactNumber(stats.toolCount)} tone="var(--green)" />
            <StatPill icon={AlertTriangle} label="errors" value={compactNumber(stats.errorCount)} tone={stats.errorCount > 0 ? 'var(--red, #f87171)' : 'var(--text-3)'} />
            <StatPill icon={Clock3} label="span" value={stats.durationLabel} tone="var(--amber, #eaaa40)" />
            <StatPill icon={Bot} label="tokens" value={`${compactNumber(stats.inputTokens)} / ${compactNumber(stats.outputTokens)}`} tone="var(--violet)" />
            <StatPill icon={ImageIcon} label="media" value={compactNumber(stats.imageCount)} tone="var(--t-read)" />
          </div>
        </CardHeader>
        <div className="av-session-viz-header-tools">
          <PhaseStrip
            phases={phases}
            total={entries.length}
            activePhaseId={activePhaseId}
            onSelectPhase={(phase) => {
              const id = phaseFocusId(phase)
              setActivePhaseId((current) => current === id ? null : id)
            }}
          />

          <div className="av-session-viz-controls">
            <label className="av-session-viz-search">
              <Search aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search turns, tools, paths, commands..."
              />
            </label>
            <div className="av-session-viz-filterbar" aria-label="Visualiser filters">
              <Filter aria-hidden="true" />
              {FILTERS.map((filter) => (
                <button
                  key={filter.key}
                  type="button"
                  aria-pressed={filter.key === 'all' ? activeFilters.length === 0 : activeFilters.includes(filter.key)}
                  className={cn((filter.key === 'all' ? activeFilters.length === 0 : activeFilters.includes(filter.key)) && 'av-active')}
                  onClick={() => {
                    if (filter.key === 'all') {
                      setActiveFilters([])
                      return
                    }
                    const selectedFilter = filter.key
                    setActiveFilters((current) => (
                      current.includes(selectedFilter)
                        ? current.filter((activeFilter) => activeFilter !== selectedFilter)
                        : [...current, selectedFilter]
                    ))
                  }}
                >
                  {filter.label}
                </button>
              ))}
            </div>
            <div className="av-session-viz-view-toggle" aria-label="Visualiser view">
              <button
                type="button"
                className={cn(activeView === 'rows' && 'av-active')}
                onClick={() => setActiveView('rows')}
              >
                <MessageSquareText aria-hidden="true" />
                Rows
              </button>
              <button
                type="button"
                className={cn(activeView === 'graph' && 'av-active')}
                onClick={() => setActiveView('graph')}
              >
                <Network aria-hidden="true" />
                Graph
              </button>
              <button
                type="button"
                className={cn(activeView === 'execution' && 'av-active')}
                onClick={() => setActiveView('execution')}
              >
                <Target aria-hidden="true" />
                Execution
              </button>
              <button
                type="button"
                className={cn(timelineMaximized && 'av-active')}
                onClick={() => setTimelineMaximized((value) => !value)}
                title={timelineMaximized ? 'Restore side readout' : 'Maximise timeline'}
              >
                {timelineMaximized ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
                {timelineMaximized ? 'Details' : 'Maximise'}
              </button>
            </div>
            <div className="av-session-viz-result-count">
              {filteredEntries.length} shown
            </div>
          </div>
          <ActiveFocusBar
            activeFilters={activeFilters}
            phaseFocus={phaseFocus}
            activeTool={activeTool}
            query={query}
            shownCount={filteredEntries.length}
            total={entries.length}
            onClearFilter={(filter) => {
              setActiveFilters((current) => current.filter((activeFilter) => activeFilter !== filter))
            }}
            onClearPhase={() => setActivePhaseId(null)}
            onClearTool={() => setActiveTool(null)}
            onClearQuery={() => setQuery('')}
            onClearAll={() => {
              setActiveFilters([])
              setActivePhaseId(null)
              setActiveTool(null)
              setQuery('')
            }}
          />
        </div>
      </div>
      <CardContent className={cn('av-session-viz-content', timelineMaximized && 'av-maximized')}>
        <div className={cn('av-session-viz-grid', timelineMaximized && 'av-maximized')}>
          {!timelineMaximized && (
            <aside className="av-session-viz-side">
              <InsightStack stats={stats} />
              <TurnInspector
                entry={selectedEntry}
                total={entries.length}
                isPinned={isPinnedSelection}
                onOpenMessage={onSelectMessage}
                onClearSelection={() => setSelectedEntryId(null)}
              />
              <RoleSplit stats={stats} />
              <ActivitySparkline buckets={stats.activityBuckets} />
              <ToolMix
                stats={stats}
                activeTool={activeTool}
                onSelectTool={(toolName) => setActiveTool((current) => current === toolName ? null : toolName)}
              />
              <HotTurns
                entries={hotEntries}
                selectedEntryId={selectedEntryId}
                onInspectEntry={setSelectedEntryId}
              />
            </aside>
          )}
          <section className={cn('av-session-viz-flow', activeView === 'graph' && 'av-graph-mode', activeView === 'execution' && 'av-execution-mode')} aria-label="Message flow">
            {activeView === 'execution' ? (
              <ExecutionFlowView
                tasks={executionTasks}
                selectedEntryId={selectedEntryId}
                onInspectEntry={setSelectedEntryId}
              />
            ) : activeView === 'graph' ? (
              <NodeGraphView
                entries={filteredEntries}
                total={entries.length}
                selectedEntryId={selectedEntryId}
                showTools={graphShowTools}
                density={graphDensity}
                onToggleTools={() => setGraphShowTools((value) => !value)}
                onToggleDensity={() => setGraphDensity((value) => value === 'compact' ? 'comfortable' : 'compact')}
                onInspectEntry={setSelectedEntryId}
              />
            ) : (
              <>
                <div className="av-session-viz-lane-head" aria-hidden="true">
                  <span>#</span>
                  <span>ACTOR</span>
                  <span>FLOW</span>
                  <span>TOOLS</span>
                  <span>METRICS</span>
                </div>
                {filteredEntries.length === 0 ? (
                  <div className="av-session-viz-no-results">
                    No turns match the current filter.
                  </div>
                ) : (
                  <div className="av-session-viz-entries">
                    {filteredEntries.map((entry) => (
                      <FlowEntry
                        key={entry.key}
                        entry={entry}
                        maxChars={stats.maxChars}
                        total={entries.length}
                        selected={selectedEntryId === entry.id}
                        onInspectEntry={setSelectedEntryId}
                        showSession={showSession}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </CardContent>
    </Card>
  )
}

export default memo(MessageSessionVisualizer)
