import type { ThreadedBlock, ThreadedMessage } from './threading'
import type { AgentProvider, SessionInfo, SessionMessage } from './types'

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

export type ModelBucket = {
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  messages: number
  cost: number
}

export type ToolBucket = { name: string; count: number; errors: number }

export type TimelinePoint = {
  index: number
  ts: number | null
  role: 'user' | 'assistant' | 'system'
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  totalTokens: number
  latencyMs: number | null
}

export type FileOps = {
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

export type Analytics = {
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
  thinkingBlocks: number
  thinkingChars: number
  assistantTextChars: number
  userTextChars: number
  turns: number
  avgFirstResponseMs: number | null
  medianFirstResponseMs: number | null
  cacheHitRate: number
  idleMs: number
  activeMs: number
  ops: FileOps
  errorRate: number
  costPerTurn: number
  avgOutputPerAssistant: number
  longestIdleMs: number
  cacheSavings: number
  toolsPerTurn: number
  maxOutputInReply: number
  longestAssistantChain: number
  slashCommands: number
  shellOutputLines: number
  hourActivity: number[]
  tokensPerSecond: number
}

export type AnalyticsInput = {
  info: SessionInfo | null
  threadedMessages: ThreadedMessage[]
  rawMessages: SessionMessage[]
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
  const tokens = cmd.trim().split(/\s+/)
  for (const tok of tokens) {
    if (/^[A-Z_][A-Z0-9_]*=/.test(tok)) continue
    if (tok === 'sudo' || tok === 'time' || tok === 'env') continue
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

export function computeAnalytics(input: AnalyticsInput | null): Analytics {
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
  if (!input) return empty

  const info = input.info
  const threaded = input.threadedMessages ?? []
  const raw = input.rawMessages ?? []

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
  const currentModel = info?.currentModel ?? 'unknown'

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

  const IDLE_THRESHOLD = 2 * 60 * 1000
  let idleMs = 0, activeMs = 0, longestIdleMs = 0
  for (const g of gaps) {
    if (g > IDLE_THRESHOLD) { idleMs += g; if (g > longestIdleMs) longestIdleMs = g }
    else activeMs += g
  }

  const durationMs = startTs !== null && endTs !== null ? endTs - startTs : null

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

export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 10_000)    return `${(n / 1_000).toFixed(1)}k`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(2)}k`
  return String(Math.round(n))
}

export function fmtCost(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '$0.00'
  if (n < 0.01) return `$${n.toFixed(4)}`
  if (n < 1)    return `$${n.toFixed(3)}`
  return `$${n.toFixed(2)}`
}

export function fmtDuration(ms: number | null): string {
  if (ms === null || ms <= 0) return '—'
  const s = Math.floor(ms / 1000)
  if (s < 60)    return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60)    return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  if (h < 24)    return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}
