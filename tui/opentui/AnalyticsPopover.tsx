/** @jsxImportSource @opentui/react */
import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import type { ScrollBoxRenderable } from '@opentui/core'
import type { TuiThemePalette } from '../theme'
import type { TuiSessionDetail } from '../../lib/tui/service'
import type { AgentProvider } from '../../lib/types'
import type { ThreadedBlock } from '../../lib/threading'

// ---------------------------------------------------------------------------
// Pricing (USD per 1M tokens). Approximate published rates for estimation.
// ---------------------------------------------------------------------------

type Price = { in: number; out: number; cacheRead?: number; cacheWrite?: number }

const MODEL_PRICING: { match: RegExp; price: Price }[] = [
  { match: /opus-4|claude-opus-4/i,            price: { in: 15,    out: 75,   cacheRead: 1.5,  cacheWrite: 18.75 } },
  { match: /claude-3-opus|opus-3/i,            price: { in: 15,    out: 75 } },
  { match: /sonnet-4|claude-sonnet-4/i,        price: { in: 3,     out: 15,   cacheRead: 0.3,  cacheWrite: 3.75 } },
  { match: /sonnet-3\.?5|claude-3-5-sonnet/i,  price: { in: 3,     out: 15,   cacheRead: 0.3,  cacheWrite: 3.75 } },
  { match: /sonnet/i,                          price: { in: 3,     out: 15 } },
  { match: /haiku-4|claude-haiku-4/i,          price: { in: 0.8,   out: 4,    cacheRead: 0.08, cacheWrite: 1 } },
  { match: /haiku/i,                           price: { in: 0.25,  out: 1.25 } },
  { match: /gpt-5|o5/i,                        price: { in: 5,     out: 40 } },
  { match: /gpt-4o-mini|4o-mini/i,             price: { in: 0.15,  out: 0.6 } },
  { match: /gpt-4o|4o/i,                       price: { in: 2.5,   out: 10 } },
  { match: /o1-mini|o3-mini/i,                 price: { in: 1.1,   out: 4.4 } },
  { match: /o1|o3/i,                           price: { in: 15,    out: 60 } },
  { match: /codex/i,                           price: { in: 2.5,   out: 10 } },
  { match: /gemini-2.*pro/i,                   price: { in: 1.25,  out: 5 } },
  { match: /gemini/i,                          price: { in: 0.3,   out: 2.5 } },
]

function priceForModel(model: string | undefined | null): Price {
  if (!model) return { in: 3, out: 15 }
  for (const p of MODEL_PRICING) if (p.match.test(model)) return p.price
  return { in: 3, out: 15 }
}

// ---------------------------------------------------------------------------
// Analytics aggregation
// ---------------------------------------------------------------------------

type ModelBucket = {
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  messages: number
  cost: number
}

type ToolBucket = { name: string; count: number; errors: number }

type TimelinePoint = {
  index: number
  ts: number | null
  role: 'user' | 'assistant' | 'system'
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  totalTokens: number
  latencyMs: number | null
}

type FileOps = {
  reads: number
  edits: number
  writes: number
  multiEdits: number
  bashCommands: number
  searches: number
  webFetches: number
  linesAdded: number
  linesRemoved: number
  filesTouched: Set<string>
  readsByFile: Map<string, number>
  editsByFile: Map<string, number>
  bashByVerb: Map<string, number>
}

type Analytics = {
  provider: AgentProvider | undefined
  model: string
  messages: number
  userMessages: number
  assistantMessages: number
  systemMessages: number
  toolUses: number
  toolErrors: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  cost: number
  startTs: number | null
  endTs: number | null
  durationMs: number | null
  tools: ToolBucket[]
  models: ModelBucket[]
  timeline: TimelinePoint[]
  // Enriched metrics
  thinkingBlocks: number
  thinkingChars: number
  assistantTextChars: number
  userTextChars: number
  turns: number
  avgFirstResponseMs: number | null
  medianFirstResponseMs: number | null
  cacheHitRate: number  // cache_read / (cache_read + input_tokens)
  idleMs: number
  activeMs: number
  ops: FileOps
  errorRate: number     // tool errors / tool uses
  costPerTurn: number
  avgOutputPerAssistant: number
  longestIdleMs: number
  // Additional
  cacheSavings: number        // USD saved by cache reads vs full input pricing
  toolsPerTurn: number        // agent depth
  maxOutputInReply: number    // biggest single assistant reply (tokens)
  longestAssistantChain: number // longest run of consecutive assistant messages
  slashCommands: number
  shellOutputLines: number
  hourActivity: number[]      // 24-slot histogram (messages per hour)
  tokensPerSecond: number     // output tokens / active seconds
}

function parseTs(value: string | undefined): number | null {
  if (!value) return null
  const t = Date.parse(value)
  return Number.isFinite(t) ? t : null
}

function countLines(s: string): number {
  if (!s) return 0
  const n = s.split('\n').length
  return s.endsWith('\n') ? n - 1 : n
}

type BlockStats = {
  thinkingBlocks: number
  thinkingChars: number
  textChars: number
  slashCommands: number
  shellOutputLines: number
}

function bashVerb(cmd: string): string {
  // Grab the first token after any env-var prefixes like FOO=bar
  const tokens = cmd.trim().split(/\s+/)
  for (const tok of tokens) {
    if (/^[A-Z_][A-Z0-9_]*=/.test(tok)) continue
    if (tok === 'sudo' || tok === 'time' || tok === 'env') continue
    // Strip leading paths: /usr/bin/foo → foo
    const base = tok.split('/').pop() ?? tok
    return base || 'bash'
  }
  return 'bash'
}

function collectBlocks(
  blocks: ThreadedBlock[],
  tools: Map<string, ToolBucket>,
  ops: FileOps,
): BlockStats {
  const stats: BlockStats = {
    thinkingBlocks: 0, thinkingChars: 0, textChars: 0,
    slashCommands: 0, shellOutputLines: 0,
  }
  for (const block of blocks) {
    if (block.type === 'text') {
      stats.textChars += block.text?.length ?? 0
    } else if (block.type === 'thinking') {
      stats.thinkingBlocks += 1
      stats.thinkingChars += block.thinking?.length ?? 0
    } else if (block.type === 'slash_command') {
      stats.slashCommands += 1
    } else if (block.type === 'local_command_stdout') {
      stats.shellOutputLines += countLines(block.stdout || '')
    } else if (block.type === 'tool_thread') {
      const name = block.toolUse.name || 'tool'
      const bucket = tools.get(name) ?? { name, count: 0, errors: 0 }
      bucket.count += 1
      if (block.result?.is_error) bucket.errors += 1
      tools.set(name, bucket)

      const input = (block.toolUse.input ?? {}) as Record<string, unknown>
      const fp = typeof input.file_path === 'string' ? input.file_path : null
      switch (name) {
        case 'Read':
          ops.reads += 1
          if (fp) {
            ops.filesTouched.add(fp)
            ops.readsByFile.set(fp, (ops.readsByFile.get(fp) ?? 0) + 1)
          }
          break
        case 'Edit': {
          ops.edits += 1
          if (fp) {
            ops.filesTouched.add(fp)
            ops.editsByFile.set(fp, (ops.editsByFile.get(fp) ?? 0) + 1)
          }
          const oldS = typeof input.old_string === 'string' ? input.old_string : ''
          const newS = typeof input.new_string === 'string' ? input.new_string : ''
          ops.linesRemoved += countLines(oldS)
          ops.linesAdded += countLines(newS)
          break
        }
        case 'MultiEdit': {
          ops.multiEdits += 1
          if (fp) {
            ops.filesTouched.add(fp)
            ops.editsByFile.set(fp, (ops.editsByFile.get(fp) ?? 0) + 1)
          }
          const edits = Array.isArray(input.edits) ? (input.edits as Record<string, unknown>[]) : []
          for (const e of edits) {
            const oldS = typeof e.old_string === 'string' ? e.old_string : ''
            const newS = typeof e.new_string === 'string' ? e.new_string : ''
            ops.linesRemoved += countLines(oldS)
            ops.linesAdded += countLines(newS)
          }
          break
        }
        case 'Write': {
          ops.writes += 1
          if (fp) {
            ops.filesTouched.add(fp)
            ops.editsByFile.set(fp, (ops.editsByFile.get(fp) ?? 0) + 1)
          }
          const content = typeof input.content === 'string' ? input.content : ''
          ops.linesAdded += countLines(content)
          break
        }
        case 'Bash': {
          ops.bashCommands += 1
          const cmd = typeof input.command === 'string' ? input.command : ''
          if (cmd) {
            const verb = bashVerb(cmd)
            ops.bashByVerb.set(verb, (ops.bashByVerb.get(verb) ?? 0) + 1)
          }
          break
        }
        case 'Grep':
        case 'Glob':
          ops.searches += 1
          break
        case 'WebFetch':
        case 'WebSearch':
          ops.webFetches += 1
          break
      }
    }
  }
  return stats
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

function computeAnalytics(detail: TuiSessionDetail | null): Analytics {
  const emptyOps: FileOps = {
    reads: 0, edits: 0, writes: 0, multiEdits: 0,
    bashCommands: 0, searches: 0, webFetches: 0,
    linesAdded: 0, linesRemoved: 0, filesTouched: new Set(),
    readsByFile: new Map(), editsByFile: new Map(), bashByVerb: new Map(),
  }
  const empty: Analytics = {
    provider: undefined, model: 'unknown',
    messages: 0, userMessages: 0, assistantMessages: 0, systemMessages: 0,
    toolUses: 0, toolErrors: 0,
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
    totalTokens: 0, cost: 0,
    startTs: null, endTs: null, durationMs: null,
    tools: [], models: [], timeline: [],
    thinkingBlocks: 0, thinkingChars: 0, assistantTextChars: 0, userTextChars: 0,
    turns: 0, avgFirstResponseMs: null, medianFirstResponseMs: null,
    cacheHitRate: 0, idleMs: 0, activeMs: 0,
    ops: emptyOps,
    errorRate: 0, costPerTurn: 0, avgOutputPerAssistant: 0, longestIdleMs: 0,
    cacheSavings: 0, toolsPerTurn: 0, maxOutputInReply: 0, longestAssistantChain: 0,
    slashCommands: 0, shellOutputLines: 0,
    hourActivity: new Array(24).fill(0),
    tokensPerSecond: 0,
  }
  if (!detail) return empty

  const info = detail.info
  const threaded = detail.threadedMessages ?? []
  const raw = detail.rawMessages ?? []

  const tools = new Map<string, ToolBucket>()
  const models = new Map<string, ModelBucket>()
  const timeline: TimelinePoint[] = []
  const ops: FileOps = {
    reads: 0, edits: 0, writes: 0, multiEdits: 0,
    bashCommands: 0, searches: 0, webFetches: 0,
    linesAdded: 0, linesRemoved: 0, filesTouched: new Set(),
    readsByFile: new Map(), editsByFile: new Map(), bashByVerb: new Map(),
  }

  let userMessages = 0, assistantMessages = 0, systemMessages = 0
  let inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, cacheWriteTokens = 0
  let startTs: number | null = null, endTs: number | null = null
  let thinkingBlocks = 0, thinkingChars = 0, assistantTextChars = 0, userTextChars = 0
  let turns = 0, lastUserTs: number | null = null, prevTs: number | null = null
  let slashCommands = 0, shellOutputLines = 0
  let maxOutputInReply = 0
  let currentChain = 0, longestAssistantChain = 0
  const hourActivity = new Array<number>(24).fill(0)
  const firstResponseLatencies: number[] = []
  const gaps: number[] = []
  let currentModel = info?.currentModel ?? 'unknown'

  for (let i = 0; i < threaded.length; i += 1) {
    const msg = threaded[i]!
    const stats = collectBlocks(msg.blocks, tools, ops)
    slashCommands += stats.slashCommands
    shellOutputLines += stats.shellOutputLines
    const ts = parseTs(msg.timestamp)
    if (ts !== null) {
      if (startTs === null || ts < startTs) startTs = ts
      if (endTs === null || ts > endTs) endTs = ts
      if (prevTs !== null) gaps.push(ts - prevTs)
      prevTs = ts
      const hour = new Date(ts).getHours()
      if (hour >= 0 && hour < 24) hourActivity[hour] = (hourActivity[hour] ?? 0) + 1
    }

    let latencyMs: number | null = null
    if (msg.role === 'user') {
      userMessages += 1
      userTextChars += stats.textChars
      lastUserTs = ts
      turns += 1
      currentChain = 0
    } else if (msg.role === 'assistant') {
      assistantMessages += 1
      assistantTextChars += stats.textChars
      thinkingBlocks += stats.thinkingBlocks
      thinkingChars += stats.thinkingChars
      currentChain += 1
      if (currentChain > longestAssistantChain) longestAssistantChain = currentChain
      const mOutLocal = msg.usage?.output_tokens ?? 0
      if (mOutLocal > maxOutputInReply) maxOutputInReply = mOutLocal
      // First assistant message after a user counts as response latency
      if (lastUserTs !== null && ts !== null) {
        latencyMs = ts - lastUserTs
        if (latencyMs >= 0) firstResponseLatencies.push(latencyMs)
        lastUserTs = null
      }
    } else {
      systemMessages += 1
      currentChain = 0
    }

    const u = msg.usage
    const mIn = u?.input_tokens ?? 0
    const mOut = u?.output_tokens ?? 0
    const mCr = u?.cache_read_input_tokens ?? 0
    const mCw = u?.cache_creation_input_tokens ?? 0
    inputTokens += mIn; outputTokens += mOut
    cacheReadTokens += mCr ?? 0; cacheWriteTokens += mCw ?? 0

    if (u && (mIn || mOut || mCr || mCw)) {
      const key = currentModel
      const bucket = models.get(key) ?? {
        model: key, inputTokens: 0, outputTokens: 0,
        cacheReadTokens: 0, cacheWriteTokens: 0, messages: 0, cost: 0,
      }
      bucket.inputTokens += mIn
      bucket.outputTokens += mOut
      bucket.cacheReadTokens += mCr ?? 0
      bucket.cacheWriteTokens += mCw ?? 0
      bucket.messages += 1
      models.set(key, bucket)
    }

    timeline.push({
      index: i,
      ts,
      role: msg.role,
      inputTokens: mIn,
      outputTokens: mOut,
      cacheReadTokens: mCr ?? 0,
      totalTokens: mIn + mOut + (mCr ?? 0) + (mCw ?? 0),
      latencyMs,
    })
  }

  // Compute cost per model bucket
  let cost = 0
  for (const bucket of models.values()) {
    const p = priceForModel(bucket.model)
    const c =
      (bucket.inputTokens  * p.in) / 1_000_000 +
      (bucket.outputTokens * p.out) / 1_000_000 +
      (bucket.cacheReadTokens  * (p.cacheRead  ?? p.in  * 0.1)) / 1_000_000 +
      (bucket.cacheWriteTokens * (p.cacheWrite ?? p.in  * 1.25)) / 1_000_000
    bucket.cost = c
    cost += c
  }

  // Fall back to raw timestamps if threaded lacked them
  if (startTs === null || endTs === null) {
    for (const m of raw) {
      const ts = parseTs(m.timestamp)
      if (ts === null) continue
      if (startTs === null || ts < startTs) startTs = ts
      if (endTs === null || ts > endTs) endTs = ts
    }
  }

  const toolList = [...tools.values()].sort((a, b) => b.count - a.count)
  const modelList = [...models.values()].sort((a, b) => b.cost - a.cost)
  const toolUses = toolList.reduce((a, b) => a + b.count, 0)
  const toolErrors = toolList.reduce((a, b) => a + b.errors, 0)

  const avgFirstResponseMs = firstResponseLatencies.length > 0
    ? firstResponseLatencies.reduce((a, b) => a + b, 0) / firstResponseLatencies.length
    : null
  const medianFirstResponseMs = median(firstResponseLatencies)

  const cacheHitRate = (cacheReadTokens + inputTokens) > 0
    ? cacheReadTokens / (cacheReadTokens + inputTokens)
    : 0

  // Idle = gaps > 2 min; active = sum of gaps ≤ 2 min
  const IDLE_THRESHOLD = 2 * 60 * 1000
  let idleMs = 0, activeMs = 0, longestIdleMs = 0
  for (const g of gaps) {
    if (g > IDLE_THRESHOLD) { idleMs += g; if (g > longestIdleMs) longestIdleMs = g }
    else activeMs += g
  }

  const durationMs = startTs !== null && endTs !== null ? endTs - startTs : null

  // Cache savings: assume the model's dominant pricing. If cache reads were
  // billed as full input instead of at the cache-read rate, how much more
  // would the session have cost?
  let cacheSavings = 0
  for (const bucket of modelList) {
    const p = priceForModel(bucket.model)
    const cacheRate = p.cacheRead ?? p.in * 0.1
    cacheSavings += (bucket.cacheReadTokens * (p.in - cacheRate)) / 1_000_000
  }

  const toolsPerTurn = turns > 0 ? toolUses / turns : 0
  const activeSeconds = activeMs > 0 ? activeMs / 1000 : (durationMs ?? 0) / 1000
  const tokensPerSecond = activeSeconds > 0 ? outputTokens / activeSeconds : 0

  return {
    provider: info?.provider,
    model: info?.currentModel ?? 'unknown',
    messages: threaded.length,
    userMessages, assistantMessages, systemMessages,
    toolUses, toolErrors,
    inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens,
    totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
    cost,
    startTs, endTs,
    durationMs,
    tools: toolList, models: modelList, timeline,
    thinkingBlocks, thinkingChars, assistantTextChars, userTextChars,
    turns,
    avgFirstResponseMs, medianFirstResponseMs,
    cacheHitRate,
    idleMs, activeMs, longestIdleMs,
    ops,
    errorRate: toolUses > 0 ? toolErrors / toolUses : 0,
    costPerTurn: turns > 0 ? cost / turns : 0,
    avgOutputPerAssistant: assistantMessages > 0 ? outputTokens / assistantMessages : 0,
    cacheSavings, toolsPerTurn, maxOutputInReply, longestAssistantChain,
    slashCommands, shellOutputLines, hourActivity, tokensPerSecond,
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 10_000)    return `${(n / 1_000).toFixed(1)}k`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(2)}k`
  return String(Math.round(n))
}

function fmtCost(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '$0.00'
  if (n < 0.01) return `$${n.toFixed(4)}`
  if (n < 1)    return `$${n.toFixed(3)}`
  return `$${n.toFixed(2)}`
}

function fmtDuration(ms: number | null): string {
  if (ms === null || ms <= 0) return '—'
  const s = Math.floor(ms / 1000)
  if (s < 60)    return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60)    return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  if (h < 24)    return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

function bar(value: number, max: number, width: number): string {
  if (max <= 0 || width <= 0) return ''
  const filled = Math.max(0, Math.min(width, Math.round((value / max) * width)))
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled))
}

// ---------------------------------------------------------------------------
// Pane definitions
// ---------------------------------------------------------------------------

type PaneId = 0 | 1 | 2 | 3 | 4
const PANE_TITLES: Record<PaneId, string> = {
  0: 'Summary',
  1: 'Tokens',
  2: 'Tools',
  3: 'Activity',
  4: 'Timeline',
}
const PANE_COUNT = 5

type AnalyticsKeyEvent = { name: string; ctrl: boolean; shift: boolean; sequence: string }

type Props = {
  detail: TuiSessionDetail | null
  theme: TuiThemePalette
  width: number
  height: number
  onClose: () => void
  onKeyHandlerReady: (handler: (key: AnalyticsKeyEvent) => void) => void
}

// ---------------------------------------------------------------------------
// Chart components
// ---------------------------------------------------------------------------

function Sparkline({
  values, width, height, theme, colors,
}: {
  values: number[]
  width: number
  height: number
  theme: TuiThemePalette
  colors: string[]
}) {
  if (values.length === 0 || height < 2) {
    return <box width={width}><text fg={theme.dim}>(no data)</text></box>
  }
  const max = Math.max(1, ...values)
  // Sample to fit width
  const cols = Math.max(1, Math.min(width, values.length))
  const step = values.length / cols
  const sampled: number[] = []
  for (let i = 0; i < cols; i += 1) {
    const start = Math.floor(i * step)
    const end = Math.max(start + 1, Math.floor((i + 1) * step))
    let s = 0
    for (let j = start; j < end && j < values.length; j += 1) s += values[j]!
    sampled.push(s / Math.max(1, end - start))
  }
  const heights = sampled.map((v) => Math.round((v / max) * (height - 1)))
  const rows: React.ReactNode[] = []
  for (let r = height - 1; r >= 0; r -= 1) {
    const chars: string[] = []
    for (let c = 0; c < cols; c += 1) {
      chars.push(heights[c]! >= r ? '█' : ' ')
    }
    const color = colors[Math.min(colors.length - 1, Math.floor(((height - 1 - r) / height) * colors.length))] ?? theme.cyan
    rows.push(
      <box key={r}><text fg={color} wrapMode="none">{chars.join('')}</text></box>
    )
  }
  return <box flexDirection="column" width={width}>{rows}</box>
}

// ---------------------------------------------------------------------------
// AnalyticsPopover
// ---------------------------------------------------------------------------

export function AnalyticsPopover({ detail, theme, width, height, onClose, onKeyHandlerReady }: Props) {
  const analytics = useMemo(() => computeAnalytics(detail), [detail])
  const [pane, setPane] = React.useState<PaneId>(0)
  const scrollRef = useRef<ScrollBoxRenderable>(null)

  const handleKey = useCallback((key: AnalyticsKeyEvent) => {
    if (key.name === 'escape') { onClose(); return }
    if (key.sequence >= '0' && key.sequence <= '4') {
      setPane(parseInt(key.sequence, 10) as PaneId)
      return
    }
    if (key.name === 'tab') {
      setPane((p) => ((p + 1) % PANE_COUNT) as PaneId)
      return
    }
    if (key.name === 'j' || key.name === 'down') { scrollRef.current?.scrollBy(1); return }
    if (key.name === 'k' || key.name === 'up')   { scrollRef.current?.scrollBy(-1); return }
    if (key.name === 'd')                         { scrollRef.current?.scrollBy(10); return }
    if (key.name === 'u')                         { scrollRef.current?.scrollBy(-10); return }
  }, [onClose])

  useEffect(() => { onKeyHandlerReady(handleKey) }, [handleKey, onKeyHandlerReady])

  const popW = Math.min(width - 4, 140)
  const popH = Math.min(height - 4, 44)
  const tabsH = 3
  const bodyH = popH - tabsH - 2
  const popTop = Math.floor((height - popH) / 2)
  const popLeft = Math.floor((width - popW) / 2)

  return (
    <box
      position="absolute"
      top={popTop}
      left={popLeft}
      width={popW}
      height={popH}
      border
      borderStyle="single"
      borderColor={theme.border2}
      backgroundColor={theme.surface}
      zIndex={50}
      flexDirection="column"
      title=" Session analytics "
      titleAlignment="left"
    >
      {/* Tabs */}
      <box
        height={tabsH}
        flexDirection="row"
        paddingX={1}
        border={['bottom']}
        borderStyle="single"
        borderColor={theme.border}
      >
        {([0, 1, 2, 3, 4] as PaneId[]).map((p) => (
          <box
            key={p}
            paddingX={1}
            marginRight={1}
            backgroundColor={pane === p ? theme.cyan : 'transparent'}
          >
            <text fg={pane === p ? theme.surface : theme.muted}>
              {`[${p}] ${PANE_TITLES[p]}`}
            </text>
          </box>
        ))}
        <box flexGrow={1} />
        <text fg={theme.dim}>{'tab/0-4 switch · j/k scroll · esc close'}</text>
      </box>

      {/* Body */}
      <scrollbox
        ref={scrollRef}
        width={popW - 2}
        height={bodyH}
        backgroundColor={theme.surface}
        scrollY
        scrollbarOptions={{ trackOptions: { foregroundColor: theme.dim, backgroundColor: theme.surface } }}
      >
        {pane === 0 ? <SummaryPane a={analytics} theme={theme} width={popW - 4} /> : null}
        {pane === 1 ? <TokensPane a={analytics} theme={theme} width={popW - 4} /> : null}
        {pane === 2 ? <ToolsPane a={analytics} theme={theme} width={popW - 4} /> : null}
        {pane === 3 ? <ActivityPane a={analytics} theme={theme} width={popW - 4} /> : null}
        {pane === 4 ? <TimelinePane a={analytics} theme={theme} width={popW - 4} /> : null}
      </scrollbox>
    </box>
  )
}

// ---------------------------------------------------------------------------
// Summary pane
// ---------------------------------------------------------------------------

function SummaryPane({ a, theme, width }: { a: Analytics; theme: TuiThemePalette; width: number }) {
  const colWidth = Math.floor((width - 2) / 2)
  const rateInPerMin = a.durationMs && a.durationMs > 0
    ? (a.inputTokens / (a.durationMs / 60_000))
    : null
  const rateOutPerMin = a.durationMs && a.durationMs > 0
    ? (a.outputTokens / (a.durationMs / 60_000))
    : null

  return (
    <box flexDirection="column" paddingX={1} width={width}>
      <box marginBottom={1}>
        <text fg={theme.muted}>Session totals · {a.provider ?? '—'} · {a.model}</text>
      </box>

      {/* KPI grid */}
      <box flexDirection="row" width={width}>
        <Kpi theme={theme} width={colWidth} label="Messages"    value={String(a.messages)} accent={theme.cyan}
             sub={`${a.userMessages} user · ${a.assistantMessages} assistant · ${a.systemMessages} system`} />
        <Kpi theme={theme} width={colWidth} label="Total tokens" value={fmtNum(a.totalTokens)} accent={theme.violet}
             sub={`${fmtNum(a.inputTokens)} in · ${fmtNum(a.outputTokens)} out`} />
      </box>
      <box flexDirection="row" width={width}>
        <Kpi theme={theme} width={colWidth} label="Cost (est.)" value={fmtCost(a.cost)} accent={theme.green}
             sub={a.cost === 0 ? 'no usage reported' : `@ ${a.model}`} />
        <Kpi theme={theme} width={colWidth} label="Duration"    value={fmtDuration(a.durationMs)} accent={theme.amber}
             sub={a.startTs && a.endTs ? new Date(a.startTs).toLocaleString() : '—'} />
      </box>
      <box flexDirection="row" width={width}>
        <Kpi theme={theme} width={colWidth} label="Tool uses"   value={String(a.toolUses)} accent={theme.pink}
             sub={`${a.toolErrors} errors (${(a.errorRate * 100).toFixed(1)}%) · ${a.tools.length} distinct`} />
        <Kpi theme={theme} width={colWidth} label="Cache hit rate" value={`${(a.cacheHitRate * 100).toFixed(1)}%`}
             accent={theme.cyan}
             sub={`${fmtNum(a.cacheReadTokens)} read · ${fmtNum(a.cacheWriteTokens)} write`} />
      </box>
      <box flexDirection="row" width={width}>
        <Kpi theme={theme} width={colWidth} label="Turns" value={String(a.turns)} accent={theme.violet}
             sub={a.turns > 0 ? `${fmtCost(a.costPerTurn)}/turn · ${fmtNum(a.totalTokens / a.turns)} tok/turn` : '—'} />
        <Kpi theme={theme} width={colWidth} label="Response latency"
             value={a.medianFirstResponseMs !== null ? fmtDuration(a.medianFirstResponseMs) : '—'}
             accent={theme.green}
             sub={a.avgFirstResponseMs !== null ? `avg ${fmtDuration(a.avgFirstResponseMs)}` : 'no paired turns'} />
      </box>
      <box flexDirection="row" width={width}>
        <Kpi theme={theme} width={colWidth} label="Thinking" value={String(a.thinkingBlocks)} accent={theme.amber}
             sub={`${fmtNum(a.thinkingChars)} chars in reasoning blocks`} />
        <Kpi theme={theme} width={colWidth} label="Text volume" value={fmtNum(a.assistantTextChars)} accent={theme.pink}
             sub={`assistant · ${fmtNum(a.userTextChars)} user`} />
      </box>
      <box flexDirection="row" width={width}>
        <Kpi theme={theme} width={colWidth} label="Active time"
             value={fmtDuration(a.activeMs > 0 ? a.activeMs : null)}
             accent={theme.green}
             sub={a.idleMs > 0 ? `idle ${fmtDuration(a.idleMs)} · longest gap ${fmtDuration(a.longestIdleMs)}` : 'no idle gaps > 2m'} />
        <Kpi theme={theme} width={colWidth} label="Avg output / reply"
             value={fmtNum(a.avgOutputPerAssistant)}
             accent={theme.violet}
             sub={a.assistantMessages > 0 ? `${a.assistantMessages} replies · max ${fmtNum(a.maxOutputInReply)}` : '—'} />
      </box>
      <box flexDirection="row" width={width}>
        <Kpi theme={theme} width={colWidth} label="Cache savings"
             value={fmtCost(a.cacheSavings)} accent={theme.green}
             sub={a.cacheReadTokens > 0
               ? `${fmtNum(a.cacheReadTokens)} tok read at cache rate`
               : 'no cache hits'} />
        <Kpi theme={theme} width={colWidth} label="Agent depth"
             value={a.toolsPerTurn > 0 ? a.toolsPerTurn.toFixed(1) : '0'} accent={theme.pink}
             sub={`tools/turn · longest chain ${a.longestAssistantChain}`} />
      </box>
      <box flexDirection="row" width={width}>
        <Kpi theme={theme} width={colWidth} label="Throughput"
             value={a.tokensPerSecond > 0 ? `${fmtNum(a.tokensPerSecond)} tok/s` : '—'}
             accent={theme.cyan}
             sub="output tokens / active second" />
        <Kpi theme={theme} width={colWidth} label="Slash / stdout"
             value={`${a.slashCommands} / ${fmtNum(a.shellOutputLines)}`}
             accent={theme.amber}
             sub="slash commands · shell stdout lines" />
      </box>

      {/* Token composition */}
      <box marginTop={1} marginBottom={1}>
        <text fg={theme.muted}>Token composition</text>
      </box>
      <CompositionBar theme={theme} width={width - 2} segments={[
        { label: 'input',      value: a.inputTokens,       color: theme.cyan },
        { label: 'output',     value: a.outputTokens,      color: theme.violet },
        { label: 'cache read', value: a.cacheReadTokens,   color: theme.green },
        { label: 'cache write',value: a.cacheWriteTokens,  color: theme.amber },
      ]} />

      {/* Rates */}
      {rateInPerMin !== null ? (
        <box marginTop={1} flexDirection="column">
          <text fg={theme.muted}>Throughput</text>
          <box><text fg={theme.text}>{`  input  ${fmtNum(rateInPerMin)} tok/min`}</text></box>
          <box><text fg={theme.text}>{`  output ${fmtNum(rateOutPerMin ?? 0)} tok/min`}</text></box>
        </box>
      ) : null}

      {/* Models */}
      {a.models.length > 0 ? (
        <box marginTop={1} flexDirection="column">
          <text fg={theme.muted}>By model</text>
          {a.models.slice(0, 6).map((m) => (
            <box key={m.model} flexDirection="row" width={width - 2}>
              <box width={24}><text fg={theme.text} wrapMode="none">{m.model}</text></box>
              <box width={14}><text fg={theme.green} wrapMode="none">{fmtCost(m.cost)}</text></box>
              <box width={14}><text fg={theme.violet} wrapMode="none">{fmtNum(m.inputTokens + m.outputTokens)} tok</text></box>
              <box flexGrow={1}><text fg={theme.dim} wrapMode="none">{`${m.messages} msgs`}</text></box>
            </box>
          ))}
        </box>
      ) : null}
    </box>
  )
}

function Kpi({
  theme, width, label, value, sub, accent,
}: {
  theme: TuiThemePalette; width: number; label: string; value: string; sub?: string; accent: string
}) {
  return (
    <box
      width={width - 1}
      marginRight={1}
      marginBottom={1}
      paddingX={1}
      paddingY={0}
      backgroundColor={theme.surface2}
      border
      borderStyle="single"
      borderColor={theme.border}
      flexDirection="column"
    >
      <text fg={theme.dim} wrapMode="none">{label}</text>
      <text fg={accent} wrapMode="none">{value}</text>
      {sub ? <text fg={theme.muted} wrapMode="none">{sub}</text> : null}
    </box>
  )
}

function CompositionBar({
  theme, width, segments,
}: {
  theme: TuiThemePalette
  width: number
  segments: { label: string; value: number; color: string }[]
}) {
  const total = segments.reduce((a, s) => a + s.value, 0)
  if (total === 0) {
    return <box width={width}><text fg={theme.dim}>(no tokens recorded)</text></box>
  }
  const chunks: React.ReactNode[] = []
  let used = 0
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i]!
    const isLast = i === segments.length - 1
    const size = isLast ? width - used : Math.round((seg.value / total) * width)
    if (size <= 0) continue
    used += size
    chunks.push(
      <text key={seg.label} fg={seg.color} wrapMode="none">{'█'.repeat(size)}</text>
    )
  }
  return (
    <box flexDirection="column" width={width}>
      <box flexDirection="row" width={width}>{chunks}</box>
      <box flexDirection="row" width={width} marginTop={0}>
        {segments.map((s) => (
          <box key={s.label} marginRight={2} flexDirection="row">
            <text fg={s.color}>■ </text>
            <text fg={theme.muted}>{`${s.label} ${fmtNum(s.value)}`}</text>
          </box>
        ))}
      </box>
    </box>
  )
}

// ---------------------------------------------------------------------------
// Tokens pane — cumulative chart + per-message breakdown
// ---------------------------------------------------------------------------

function TokensPane({ a, theme, width }: { a: Analytics; theme: TuiThemePalette; width: number }) {
  const outputSeries = a.timeline.map((p) => p.outputTokens)
  const inputSeries  = a.timeline.map((p) => p.inputTokens)
  const cacheSeries  = a.timeline.map((p) => p.cacheReadTokens)

  const chartH = 10
  const chartW = Math.max(20, width - 4)

  // Cumulative output
  let sum = 0
  const cumulative = a.timeline.map((p) => (sum += p.outputTokens))

  return (
    <box flexDirection="column" paddingX={1} width={width}>
      <box><text fg={theme.muted}>Output tokens per message</text></box>
      <Sparkline values={outputSeries} width={chartW} height={chartH} theme={theme}
                 colors={[theme.cyan, theme.violet, theme.pink]} />

      <box marginTop={1}><text fg={theme.muted}>Input tokens per message</text></box>
      <Sparkline values={inputSeries} width={chartW} height={chartH} theme={theme}
                 colors={[theme.green, theme.cyan]} />

      <box marginTop={1}><text fg={theme.muted}>Cumulative output tokens</text></box>
      <Sparkline values={cumulative} width={chartW} height={chartH / 2} theme={theme}
                 colors={[theme.amber]} />

      <box marginTop={1}><text fg={theme.muted}>Cache read tokens per message</text></box>
      <Sparkline values={cacheSeries} width={chartW} height={chartH / 2} theme={theme}
                 colors={[theme.green]} />

      <box marginTop={1} flexDirection="column">
        <text fg={theme.muted}>Top token-producing turns</text>
        {[...a.timeline]
          .sort((x, y) => y.outputTokens - x.outputTokens)
          .slice(0, 8)
          .map((p) => {
            const maxOut = Math.max(1, ...outputSeries)
            const barWidth = Math.max(10, width - 40)
            return (
              <box key={p.index} flexDirection="row" width={width - 2}>
                <box width={6}><text fg={theme.dim} wrapMode="none">{`#${p.index + 1}`}</text></box>
                <box width={10}><text fg={theme.cyan} wrapMode="none">{fmtNum(p.outputTokens)}</text></box>
                <box width={barWidth}>
                  <text fg={theme.violet} wrapMode="none">{bar(p.outputTokens, maxOut, barWidth)}</text>
                </box>
                <box flexGrow={1}>
                  <text fg={theme.muted} wrapMode="none">
                    {p.ts ? new Date(p.ts).toLocaleTimeString() : ''}
                  </text>
                </box>
              </box>
            )
          })}
      </box>
    </box>
  )
}

// ---------------------------------------------------------------------------
// Tools pane — horizontal bar chart
// ---------------------------------------------------------------------------

function ToolsPane({ a, theme, width }: { a: Analytics; theme: TuiThemePalette; width: number }) {
  if (a.tools.length === 0) {
    return (
      <box paddingX={1}><text fg={theme.dim}>(no tool calls in this session)</text></box>
    )
  }
  const max = a.tools[0]!.count
  const nameW = Math.min(20, Math.max(8, ...a.tools.map((t) => t.name.length)))
  const countW = 8
  const barWidth = Math.max(10, width - nameW - countW - 4)

  return (
    <box flexDirection="column" paddingX={1} width={width}>
      <box marginBottom={1}>
        <text fg={theme.muted}>{`${a.toolUses} total tool calls · ${a.toolErrors} errors · ${a.tools.length} distinct`}</text>
      </box>
      {a.tools.map((t) => {
        const color = t.errors > 0 ? theme.amber : theme.cyan
        const errSuffix = t.errors > 0 ? `  (${t.errors} err)` : ''
        return (
          <box key={t.name} flexDirection="row" width={width - 2}>
            <box width={nameW}><text fg={theme.text} wrapMode="none">{t.name}</text></box>
            <box width={countW}><text fg={theme.violet} wrapMode="none">{String(t.count)}</text></box>
            <box width={barWidth}>
              <text fg={color} wrapMode="none">{bar(t.count, max, barWidth)}</text>
            </box>
            <box flexGrow={1}>
              <text fg={t.errors > 0 ? theme.red : theme.dim} wrapMode="none">{errSuffix}</text>
            </box>
          </box>
        )
      })}
    </box>
  )
}

// ---------------------------------------------------------------------------
// Activity pane — file ops, diff stats, latency distribution
// ---------------------------------------------------------------------------

function ActivityPane({ a, theme, width }: { a: Analytics; theme: TuiThemePalette; width: number }) {
  const ops = a.ops
  const rows: { label: string; count: number; color: string }[] = [
    { label: 'File reads',     count: ops.reads,        color: theme.cyan },
    { label: 'Edits',          count: ops.edits,        color: theme.violet },
    { label: 'MultiEdits',     count: ops.multiEdits,   color: theme.violet },
    { label: 'Writes',         count: ops.writes,       color: theme.amber },
    { label: 'Bash commands',  count: ops.bashCommands, color: theme.green },
    { label: 'Searches',       count: ops.searches,     color: theme.pink },
    { label: 'Web calls',      count: ops.webFetches,   color: theme.cyan },
  ]
  const max = Math.max(1, ...rows.map((r) => r.count))
  const labelW = 16
  const countW = 6
  const barWidth = Math.max(10, width - labelW - countW - 4)

  const netLines = ops.linesAdded - ops.linesRemoved
  const colWidth = Math.floor((width - 2) / 2)

  // Latency distribution (ms → log-ish buckets)
  const latencies = a.timeline
    .map((p) => p.latencyMs)
    .filter((v): v is number => typeof v === 'number' && v >= 0)

  return (
    <box flexDirection="column" paddingX={1} width={width}>
      <box marginBottom={1}><text fg={theme.muted}>Code & file activity</text></box>

      <box flexDirection="row" width={width}>
        <Kpi theme={theme} width={colWidth} label="Lines added"
             value={`+${ops.linesAdded.toLocaleString()}`} accent={theme.green}
             sub={`${ops.edits + ops.multiEdits} edits · ${ops.writes} writes`} />
        <Kpi theme={theme} width={colWidth} label="Lines removed"
             value={`-${ops.linesRemoved.toLocaleString()}`} accent={theme.red}
             sub={`net ${netLines >= 0 ? '+' : ''}${netLines.toLocaleString()}`} />
      </box>
      <box flexDirection="row" width={width}>
        <Kpi theme={theme} width={colWidth} label="Files touched"
             value={String(ops.filesTouched.size)} accent={theme.pink}
             sub={`${ops.reads} reads · ${ops.edits + ops.multiEdits + ops.writes} writes` } />
        <Kpi theme={theme} width={colWidth} label="Shell commands"
             value={String(ops.bashCommands)} accent={theme.amber}
             sub={`${ops.searches} searches · ${ops.webFetches} web`} />
      </box>

      <box marginTop={1} marginBottom={1}><text fg={theme.muted}>Operations breakdown</text></box>
      {rows.map((r) => (
        <box key={r.label} flexDirection="row" width={width - 2}>
          <box width={labelW}><text fg={theme.text} wrapMode="none">{r.label}</text></box>
          <box width={countW}><text fg={r.color} wrapMode="none">{String(r.count)}</text></box>
          <box width={barWidth}>
            <text fg={r.color} wrapMode="none">{bar(r.count, max, barWidth)}</text>
          </box>
        </box>
      ))}

      {/* Diff visualization */}
      {(ops.linesAdded + ops.linesRemoved) > 0 ? (
        <box flexDirection="column" width={width} marginTop={1}>
          <text fg={theme.muted}>Added vs removed</text>
          <CompositionBar theme={theme} width={width - 2} segments={[
            { label: 'added',   value: ops.linesAdded,   color: theme.green },
            { label: 'removed', value: ops.linesRemoved, color: theme.red },
          ]} />
        </box>
      ) : null}

      {/* Most-edited files */}
      {ops.editsByFile.size > 0 ? (
        <box flexDirection="column" width={width} marginTop={1}>
          <text fg={theme.muted}>Most-edited files</text>
          <RankedBars theme={theme} width={width - 2}
            entries={[...ops.editsByFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)}
            color={theme.violet} />
        </box>
      ) : null}

      {/* Most-read files */}
      {ops.readsByFile.size > 0 ? (
        <box flexDirection="column" width={width} marginTop={1}>
          <text fg={theme.muted}>Most-read files</text>
          <RankedBars theme={theme} width={width - 2}
            entries={[...ops.readsByFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)}
            color={theme.cyan} />
        </box>
      ) : null}

      {/* Top shell commands */}
      {ops.bashByVerb.size > 0 ? (
        <box flexDirection="column" width={width} marginTop={1}>
          <text fg={theme.muted}>Top shell commands</text>
          <RankedBars theme={theme} width={width - 2}
            entries={[...ops.bashByVerb.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)}
            color={theme.amber} />
        </box>
      ) : null}

      {/* Latency histogram */}
      {latencies.length > 0 ? (
        <box flexDirection="column" width={width} marginTop={1}>
          <text fg={theme.muted}>{`Response latency distribution (${latencies.length} paired turns)`}</text>
          <LatencyHistogram latencies={latencies} theme={theme} width={width - 4} />
        </box>
      ) : null}
    </box>
  )
}

function RankedBars({
  entries, theme, width, color,
}: {
  entries: [string, number][]; theme: TuiThemePalette; width: number; color: string
}) {
  if (entries.length === 0) return null
  const max = Math.max(1, ...entries.map(([, v]) => v))
  const labelW = Math.min(40, Math.max(12, ...entries.map(([k]) => Math.min(40, k.length))))
  const countW = 6
  const barWidth = Math.max(8, width - labelW - countW - 2)
  return (
    <box flexDirection="column" width={width}>
      {entries.map(([key, count]) => {
        const trimmed = key.length > labelW ? '…' + key.slice(-(labelW - 1)) : key
        return (
          <box key={key} flexDirection="row" width={width}>
            <box width={labelW}><text fg={theme.text} wrapMode="none">{trimmed}</text></box>
            <box width={countW}><text fg={color} wrapMode="none">{String(count)}</text></box>
            <box width={barWidth}>
              <text fg={color} wrapMode="none">{bar(count, max, barWidth)}</text>
            </box>
          </box>
        )
      })}
    </box>
  )
}

function LatencyHistogram({
  latencies, theme, width,
}: {
  latencies: number[]; theme: TuiThemePalette; width: number
}) {
  const buckets: { label: string; max: number; count: number }[] = [
    { label: '<1s',    max: 1_000,    count: 0 },
    { label: '1-3s',   max: 3_000,    count: 0 },
    { label: '3-10s',  max: 10_000,   count: 0 },
    { label: '10-30s', max: 30_000,   count: 0 },
    { label: '30s-1m', max: 60_000,   count: 0 },
    { label: '1-5m',   max: 300_000,  count: 0 },
    { label: '>5m',    max: Infinity, count: 0 },
  ]
  for (const l of latencies) {
    for (const b of buckets) {
      if (l < b.max) { b.count += 1; break }
    }
  }
  const max = Math.max(1, ...buckets.map((b) => b.count))
  const labelW = 8
  const countW = 6
  const barWidth = Math.max(10, width - labelW - countW - 2)
  return (
    <box flexDirection="column" width={width}>
      {buckets.map((b) => (
        <box key={b.label} flexDirection="row" width={width}>
          <box width={labelW}><text fg={theme.dim} wrapMode="none">{b.label}</text></box>
          <box width={countW}><text fg={theme.violet} wrapMode="none">{String(b.count)}</text></box>
          <box width={barWidth}>
            <text fg={theme.cyan} wrapMode="none">{bar(b.count, max, barWidth)}</text>
          </box>
        </box>
      ))}
    </box>
  )
}

// ---------------------------------------------------------------------------
// Timeline pane — message density over time, bucketed
// ---------------------------------------------------------------------------

function TimelinePane({ a, theme, width }: { a: Analytics; theme: TuiThemePalette; width: number }) {
  if (a.timeline.length === 0 || a.startTs === null || a.endTs === null) {
    return (
      <box paddingX={1}><text fg={theme.dim}>(no timestamped messages)</text></box>
    )
  }
  const span = Math.max(1, a.endTs - a.startTs)
  const buckets = Math.max(8, Math.min(60, width - 12))
  const bucketSize = span / buckets

  const msgCounts = new Array(buckets).fill(0)
  const outTokens = new Array(buckets).fill(0)
  for (const p of a.timeline) {
    if (p.ts === null) continue
    const idx = Math.min(buckets - 1, Math.floor((p.ts - a.startTs) / bucketSize))
    msgCounts[idx] += 1
    outTokens[idx] += p.outputTokens
  }

  const startLabel = new Date(a.startTs).toLocaleString()
  const endLabel = new Date(a.endTs).toLocaleString()
  const bucketMs = bucketSize

  return (
    <box flexDirection="column" paddingX={1} width={width}>
      <box><text fg={theme.muted}>{`${startLabel}  →  ${endLabel}`}</text></box>
      <box marginBottom={1}><text fg={theme.dim}>{`${buckets} buckets · ~${fmtDuration(bucketMs)} per bucket`}</text></box>

      <box marginTop={1}><text fg={theme.muted}>Messages per bucket</text></box>
      <Sparkline values={msgCounts} width={buckets} height={8} theme={theme}
                 colors={[theme.cyan, theme.violet]} />

      <box marginTop={1}><text fg={theme.muted}>Output tokens per bucket</text></box>
      <Sparkline values={outTokens} width={buckets} height={8} theme={theme}
                 colors={[theme.green, theme.amber, theme.pink]} />

      <box marginTop={1} flexDirection="column">
        <text fg={theme.muted}>Role distribution over time</text>
        <RoleStrip theme={theme} timeline={a.timeline} width={Math.max(16, width - 4)} />
      </box>

      <box marginTop={1} flexDirection="column">
        <text fg={theme.muted}>Activity by hour of day (local)</text>
        <HourHeatmap counts={a.hourActivity} theme={theme} width={Math.max(48, width - 4)} />
      </box>
    </box>
  )
}

function HourHeatmap({
  counts, theme, width,
}: {
  counts: number[]; theme: TuiThemePalette; width: number
}) {
  const max = Math.max(1, ...counts)
  // Each hour gets a cell. Cell width scales with terminal width.
  const cellW = Math.max(1, Math.floor((width - 6) / 24))
  const height = 5
  // Build height × 24 grid
  const heights = counts.map((c) => Math.round((c / max) * (height - 1)))
  const rows: React.ReactNode[] = []
  for (let r = height - 1; r >= 0; r -= 1) {
    const cells: React.ReactNode[] = []
    for (let h = 0; h < 24; h += 1) {
      const on = (heights[h] ?? 0) >= r
      const intensity = (counts[h] ?? 0) / max
      const color = !on
        ? theme.surface2
        : intensity > 0.66 ? theme.amber
        : intensity > 0.33 ? theme.violet
        : theme.cyan
      cells.push(
        <text key={h} fg={color} wrapMode="none">{(on ? '█' : '░').repeat(cellW)}</text>
      )
    }
    rows.push(<box key={r} flexDirection="row">{cells}</box>)
  }
  // Hour axis
  const axis: React.ReactNode[] = []
  for (let h = 0; h < 24; h += 1) {
    const label = h % 6 === 0 ? String(h).padStart(2, '0') : ' '
    axis.push(
      <text key={h} fg={theme.dim} wrapMode="none">
        {label.padEnd(cellW, ' ').slice(0, cellW)}
      </text>
    )
  }
  return (
    <box flexDirection="column" width={width}>
      {rows}
      <box flexDirection="row">{axis}</box>
    </box>
  )
}

function RoleStrip({
  theme, timeline, width,
}: {
  theme: TuiThemePalette; timeline: TimelinePoint[]; width: number
}) {
  if (timeline.length === 0) return null
  const cols = Math.min(width, timeline.length)
  const step = timeline.length / cols
  const chars: { ch: string; color: string }[] = []
  for (let i = 0; i < cols; i += 1) {
    const idx = Math.min(timeline.length - 1, Math.floor(i * step))
    const p = timeline[idx]!
    if (p.role === 'assistant') chars.push({ ch: '▌', color: theme.violet })
    else if (p.role === 'user') chars.push({ ch: '▌', color: theme.cyan })
    else chars.push({ ch: '▌', color: theme.dim })
  }
  return (
    <box flexDirection="row" width={width}>
      {chars.map((c, i) => (
        <text key={i} fg={c.color}>{c.ch}</text>
      ))}
    </box>
  )
}
