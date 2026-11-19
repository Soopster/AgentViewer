import { priceForModel } from '../analytics'
import { isAgentProvider } from '../provider'
import { normalizeProjectPath, pathBasename } from '../projectPaths'
import type { AgentProvider } from '../types'
import type { PersistedIndexFilters, PersistedSessionRecord, SqliteDatabase } from './types'
import { toFiniteNumber, optionalString, chunkArray } from './rows'

export type PersistedAnalyticsFilters = PersistedIndexFilters & {
  from?: number
  to?: number
}

export type CrossSessionAnalytics = {
  range: { from: number | null; to: number | null }
  totals: {
    sessions: number
    messages: number
    activeDays: number
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
    totalTokens: number
    estCost: number
    cacheHitRate: number
    cacheSavings: number
    avgMessagesPerSession: number
    avgTokensPerSession: number
    avgCostPerSession: number
  }
  daily: Array<{
    day: string
    messages: number
    tokens: number
    cost: number
    cumulativeCost: number
    cacheHitRate: number
    costPerMessage: number
  }>
  sessionsPerDay: Array<{ day: string; sessions: number }>
  hourHeatmap: Array<{ dow: number; hour: number; messages: number }>
  providers: Array<{ provider: AgentProvider; sessions: number; messages: number; tokens: number; cost: number }>
  projects: Array<{ cwd: string; name: string; sessions: number; messages: number; tokens: number; cost: number }>
  tools: Array<{ name: string; count: number }>
  toolErrors: Array<{ name: string; total: number; errors: number; rate: number }>
  models: Array<{ model: string; messages: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; cost: number }>
  modelKeys: string[]
  dailyByModel: Array<Record<string, string | number> & { day: string }>
  latency: Array<{ day: string; samples: number; p50: number; p95: number }>
  origins: Array<{ kind: string; count: number }>
  roleMix: { user: number; assistant: number; system: number }
  durationBuckets: Array<{ bucket: string; sessions: number }>
  streak: { current: number; longest: number }
  topSessions: Array<{
    key: string
    provider: AgentProvider
    sessionId: string
    title: string
    cwd: string | null
    messages: number
    tokens: number
    cost: number
    lastMessageAt: number | null
  }>
}

export function emptyCrossSessionAnalytics(): CrossSessionAnalytics {
  return {
    range: { from: null, to: null },
    totals: {
      sessions: 0,
      messages: 0,
      activeDays: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      estCost: 0,
      cacheHitRate: 0,
      cacheSavings: 0,
      avgMessagesPerSession: 0,
      avgTokensPerSession: 0,
      avgCostPerSession: 0,
    },
    daily: [],
    sessionsPerDay: [],
    hourHeatmap: [],
    providers: [],
    projects: [],
    tools: [],
    toolErrors: [],
    models: [],
    modelKeys: [],
    dailyByModel: [],
    latency: [],
    origins: [],
    roleMix: { user: 0, assistant: 0, system: 0 },
    durationBuckets: [],
    streak: { current: 0, longest: 0 },
    topSessions: [],
  }
}

function costFor(model: string | null, i: number, o: number, cr: number, cw: number): number {
  const p = priceForModel(model)
  return (i * p.in + o * p.out + cr * (p.cacheRead ?? p.in) + cw * (p.cacheWrite ?? p.in)) / 1_000_000
}

export async function queryCrossSessionAnalytics(
  db: SqliteDatabase,
  sessions: PersistedSessionRecord[],
  filters: PersistedAnalyticsFilters = {},
): Promise<CrossSessionAnalytics> {
  if (sessions.length === 0) {
    const empty = emptyCrossSessionAnalytics()
    empty.range = { from: filters.from ?? null, to: filters.to ?? null }
    return empty
  }

  const sessionKeys = sessions.map((s) => s.key)
  const sessionByKey = new Map<string, PersistedSessionRecord>()
  for (const s of sessions) sessionByKey.set(s.key, s)

  const fromMs = typeof filters.from === 'number' && Number.isFinite(filters.from) ? filters.from : 0
  const toMs = typeof filters.to === 'number' && Number.isFinite(filters.to) ? filters.to : Number.MAX_SAFE_INTEGER

  type Row = Record<string, unknown>

  // Aggregate messages by (day, model, provider, cwd) in a single pass.
  type AggRow = {
    day: string
    model: string | null
    provider: AgentProvider
    cwd: string
    messages: number
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
  }
  const aggregateRows: AggRow[] = []
  for (const chunk of chunkArray(sessionKeys, 500)) {
    const placeholders = chunk.map(() => '?').join(', ')
    const rows = db.prepare(`
      SELECT
        strftime('%Y-%m-%d', m.timestamp_ms/1000.0, 'unixepoch') AS day,
        m.model AS model,
        s.provider AS provider,
        s.cwd AS cwd,
        COUNT(*) AS messages,
        SUM(m.input_tokens) AS i,
        SUM(m.output_tokens) AS o,
        SUM(m.cache_read_tokens) AS cr,
        SUM(m.cache_write_tokens) AS cw
      FROM messages m
      JOIN sessions s ON s.key = m.session_key
      WHERE m.session_key IN (${placeholders})
        AND m.timestamp_ms IS NOT NULL
        AND m.timestamp_ms BETWEEN ? AND ?
      GROUP BY day, m.model, s.provider, s.cwd
    `).all(...chunk, fromMs, toMs) as Row[]
    for (const row of rows) {
      const day = optionalString(row.day)
      if (!day) continue
      const provider = isAgentProvider(row.provider) ? row.provider : null
      if (!provider) continue
      aggregateRows.push({
        day,
        model: optionalString(row.model) ?? null,
        provider,
        cwd: normalizeProjectPath(optionalString(row.cwd)) || '(unknown)',
        messages: toFiniteNumber(row.messages),
        inputTokens: toFiniteNumber(row.i),
        outputTokens: toFiniteNumber(row.o),
        cacheReadTokens: toFiniteNumber(row.cr),
        cacheWriteTokens: toFiniteNumber(row.cw),
      })
    }
  }

  const dailyMap = new Map<string, {
    messages: number
    tokens: number
    cost: number
    inputTokens: number
    cacheReadTokens: number
  }>()
  const dailyByModelMap = new Map<string, Map<string, number>>()
  const providerMap = new Map<AgentProvider, { provider: AgentProvider; sessions: number; messages: number; tokens: number; cost: number }>()
  const projectMap = new Map<string, { cwd: string; name: string; sessions: number; messages: number; tokens: number; cost: number }>()
  const modelMap = new Map<string, CrossSessionAnalytics['models'][number]>()

  let totalMessages = 0
  let totalInput = 0
  let totalOutput = 0
  let totalCacheRead = 0
  let totalCacheWrite = 0
  let totalCost = 0

  for (const row of aggregateRows) {
    const tokens = row.inputTokens + row.outputTokens + row.cacheReadTokens + row.cacheWriteTokens
    const cost = costFor(row.model, row.inputTokens, row.outputTokens, row.cacheReadTokens, row.cacheWriteTokens)

    totalMessages += row.messages
    totalInput += row.inputTokens
    totalOutput += row.outputTokens
    totalCacheRead += row.cacheReadTokens
    totalCacheWrite += row.cacheWriteTokens
    totalCost += cost

    const dayBucket = dailyMap.get(row.day) ?? {
      messages: 0,
      tokens: 0,
      cost: 0,
      inputTokens: 0,
      cacheReadTokens: 0,
    }
    dayBucket.messages += row.messages
    dayBucket.tokens += tokens
    dayBucket.cost += cost
    dayBucket.inputTokens += row.inputTokens
    dayBucket.cacheReadTokens += row.cacheReadTokens
    dailyMap.set(row.day, dayBucket)

    const modelLabel = row.model ?? '(unknown)'
    let perModel = dailyByModelMap.get(row.day)
    if (!perModel) {
      perModel = new Map<string, number>()
      dailyByModelMap.set(row.day, perModel)
    }
    perModel.set(modelLabel, (perModel.get(modelLabel) ?? 0) + tokens)

    const providerBucket = providerMap.get(row.provider) ?? { provider: row.provider, sessions: 0, messages: 0, tokens: 0, cost: 0 }
    providerBucket.messages += row.messages
    providerBucket.tokens += tokens
    providerBucket.cost += cost
    providerMap.set(row.provider, providerBucket)

    const projectBucket = projectMap.get(row.cwd) ?? { cwd: row.cwd, name: pathBasename(row.cwd) || row.cwd, sessions: 0, messages: 0, tokens: 0, cost: 0 }
    projectBucket.messages += row.messages
    projectBucket.tokens += tokens
    projectBucket.cost += cost
    projectMap.set(row.cwd, projectBucket)

    const modelKey = row.model ?? '(unknown)'
    const modelBucket = modelMap.get(modelKey) ?? {
      model: modelKey,
      messages: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cost: 0,
    }
    modelBucket.messages += row.messages
    modelBucket.inputTokens += row.inputTokens
    modelBucket.outputTokens += row.outputTokens
    modelBucket.cacheReadTokens += row.cacheReadTokens
    modelBucket.cacheWriteTokens += row.cacheWriteTokens
    modelBucket.cost += cost
    modelMap.set(modelKey, modelBucket)
  }

  // Session counts per provider / cwd come from the filtered session list,
  // not the message aggregate (a session with zero messages in range still counts).
  for (const session of sessions) {
    const providerBucket = providerMap.get(session.provider)
    if (providerBucket) providerBucket.sessions += 1
    const cwd = normalizeProjectPath(session.cwd) || '(unknown)'
    const projectBucket = projectMap.get(cwd)
    if (projectBucket) projectBucket.sessions += 1
  }

  // Hour-of-day x day-of-week heatmap.
  const heatmap: Array<{ dow: number; hour: number; messages: number }> = []
  for (const chunk of chunkArray(sessionKeys, 500)) {
    const placeholders = chunk.map(() => '?').join(', ')
    const rows = db.prepare(`
      SELECT
        CAST(strftime('%w', m.timestamp_ms/1000.0, 'unixepoch') AS INTEGER) AS dow,
        CAST(strftime('%H', m.timestamp_ms/1000.0, 'unixepoch') AS INTEGER) AS hour,
        COUNT(*) AS messages
      FROM messages m
      WHERE m.session_key IN (${placeholders})
        AND m.timestamp_ms IS NOT NULL
        AND m.timestamp_ms BETWEEN ? AND ?
      GROUP BY dow, hour
    `).all(...chunk, fromMs, toMs) as Row[]
    for (const row of rows) {
      const dow = toFiniteNumber(row.dow)
      const hour = toFiniteNumber(row.hour)
      heatmap.push({ dow, hour, messages: toFiniteNumber(row.messages) })
    }
  }
  // Fold duplicate (dow, hour) entries that come from chunked queries.
  const heatmapFold = new Map<string, number>()
  for (const cell of heatmap) {
    const k = `${cell.dow}:${cell.hour}`
    heatmapFold.set(k, (heatmapFold.get(k) ?? 0) + cell.messages)
  }
  const hourHeatmap = [...heatmapFold.entries()].map(([k, messages]) => {
    const [dow, hour] = k.split(':').map(Number)
    return { dow, hour, messages }
  })

  // Tool usage + error counts within date range.
  const toolMap = new Map<string, { count: number; errors: number }>()
  for (const chunk of chunkArray(sessionKeys, 500)) {
    const placeholders = chunk.map(() => '?').join(', ')
    const rows = db.prepare(`
      SELECT mt.name AS name, COUNT(*) AS count, SUM(mt.is_error) AS errors
      FROM message_tools mt
      JOIN messages m ON m.key = mt.message_key
      WHERE mt.session_key IN (${placeholders})
        AND m.timestamp_ms IS NOT NULL
        AND m.timestamp_ms BETWEEN ? AND ?
      GROUP BY mt.name
    `).all(...chunk, fromMs, toMs) as Row[]
    for (const row of rows) {
      const name = optionalString(row.name)
      if (!name) continue
      const bucket = toolMap.get(name) ?? { count: 0, errors: 0 }
      bucket.count += toFiniteNumber(row.count)
      bucket.errors += toFiniteNumber(row.errors)
      toolMap.set(name, bucket)
    }
  }

  // Origin breakdown (origin_kind on messages — e.g. 'user', 'slash_command', 'system').
  const originMap = new Map<string, number>()
  for (const chunk of chunkArray(sessionKeys, 500)) {
    const placeholders = chunk.map(() => '?').join(', ')
    const rows = db.prepare(`
      SELECT m.origin_kind AS kind, COUNT(*) AS count
      FROM messages m
      WHERE m.session_key IN (${placeholders})
        AND m.timestamp_ms IS NOT NULL
        AND m.timestamp_ms BETWEEN ? AND ?
      GROUP BY m.origin_kind
    `).all(...chunk, fromMs, toMs) as Row[]
    for (const row of rows) {
      const kind = optionalString(row.kind) ?? '(none)'
      originMap.set(kind, (originMap.get(kind) ?? 0) + toFiniteNumber(row.count))
    }
  }

  // Assistant response latency: gap from preceding user-message timestamp within the same session.
  // Cap at 10 minutes — anything longer is almost certainly an idle/abandoned conversation.
  const LATENCY_CAP_MS = 10 * 60 * 1000
  const latencyByDay = new Map<string, number[]>()
  for (const chunk of chunkArray(sessionKeys, 500)) {
    const placeholders = chunk.map(() => '?').join(', ')
    const rows = db.prepare(`
      SELECT day, latency_ms FROM (
        SELECT
          strftime('%Y-%m-%d', m.timestamp_ms/1000.0, 'unixepoch') AS day,
          m.type AS type,
          LAG(m.type) OVER (PARTITION BY m.session_key ORDER BY m.timestamp_ms) AS prev_type,
          m.timestamp_ms - LAG(m.timestamp_ms) OVER (PARTITION BY m.session_key ORDER BY m.timestamp_ms) AS latency_ms
        FROM messages m
        WHERE m.session_key IN (${placeholders})
          AND m.timestamp_ms IS NOT NULL
          AND m.timestamp_ms BETWEEN ? AND ?
      )
      WHERE type = 'assistant' AND prev_type = 'user' AND latency_ms IS NOT NULL AND latency_ms > 0 AND latency_ms <= ?
    `).all(...chunk, fromMs, toMs, LATENCY_CAP_MS) as Row[]
    for (const row of rows) {
      const day = optionalString(row.day)
      const ms = toFiniteNumber(row.latency_ms)
      if (!day || ms <= 0) continue
      const list = latencyByDay.get(day)
      if (list) list.push(ms)
      else latencyByDay.set(day, [ms])
    }
  }
  const latency: CrossSessionAnalytics['latency'] = [...latencyByDay.entries()]
    .map(([day, samples]) => {
      const sorted = samples.slice().sort((a, b) => a - b)
      const p50 = sorted[Math.floor((sorted.length - 1) * 0.5)] ?? 0
      const p95 = sorted[Math.floor((sorted.length - 1) * 0.95)] ?? 0
      return { day, samples: sorted.length, p50, p95 }
    })
    .sort((a, b) => a.day.localeCompare(b.day))

  const cacheHitRate = totalInput + totalCacheRead > 0
    ? totalCacheRead / (totalInput + totalCacheRead)
    : 0

  // Cache savings: what cache reads would have cost at full input price minus the cache-read price.
  let cacheSavings = 0
  for (const m of modelMap.values()) {
    const p = priceForModel(m.model === '(unknown)' ? null : m.model)
    const cacheRate = p.cacheRead ?? p.in
    cacheSavings += (m.cacheReadTokens * (p.in - cacheRate)) / 1_000_000
  }

  // Sessions started per day (derived from session.firstMessageAt).
  const sessionsPerDayMap = new Map<string, number>()
  for (const s of sessions) {
    if (s.firstMessageAt === null) continue
    if (s.firstMessageAt < fromMs || s.firstMessageAt > toMs) continue
    const day = new Date(s.firstMessageAt).toISOString().slice(0, 10)
    sessionsPerDayMap.set(day, (sessionsPerDayMap.get(day) ?? 0) + 1)
  }

  // Top sessions by cost within the date range (per-session token rollup joined with model for pricing).
  type SessionAgg = { tokens: number; cost: number; messages: number }
  const sessionAgg = new Map<string, SessionAgg>()
  for (const chunk of chunkArray(sessionKeys, 500)) {
    const placeholders = chunk.map(() => '?').join(', ')
    const rows = db.prepare(`
      SELECT
        m.session_key AS session_key,
        m.model AS model,
        COUNT(*) AS messages,
        SUM(m.input_tokens) AS i,
        SUM(m.output_tokens) AS o,
        SUM(m.cache_read_tokens) AS cr,
        SUM(m.cache_write_tokens) AS cw
      FROM messages m
      WHERE m.session_key IN (${placeholders})
        AND m.timestamp_ms IS NOT NULL
        AND m.timestamp_ms BETWEEN ? AND ?
      GROUP BY m.session_key, m.model
    `).all(...chunk, fromMs, toMs) as Row[]
    for (const row of rows) {
      const key = optionalString(row.session_key)
      if (!key) continue
      const i = toFiniteNumber(row.i)
      const o = toFiniteNumber(row.o)
      const cr = toFiniteNumber(row.cr)
      const cw = toFiniteNumber(row.cw)
      const messages = toFiniteNumber(row.messages)
      const cost = costFor(optionalString(row.model) ?? null, i, o, cr, cw)
      const agg = sessionAgg.get(key) ?? { tokens: 0, cost: 0, messages: 0 }
      agg.tokens += i + o + cr + cw
      agg.cost += cost
      agg.messages += messages
      sessionAgg.set(key, agg)
    }
  }

  const topSessions = [...sessionAgg.entries()]
    .map(([key, agg]) => {
      const session = sessionByKey.get(key)
      if (!session) return null
      return {
        key,
        provider: session.provider,
        sessionId: session.sessionId,
        title: session.title,
        cwd: session.cwd ?? null,
        messages: agg.messages,
        tokens: agg.tokens,
        cost: agg.cost,
        lastMessageAt: session.lastMessageAt,
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((a, b) => b.cost - a.cost || b.tokens - a.tokens)
    .slice(0, 15)

  // Build daily array with running cumulative cost, per-day cache hit rate, and cost-per-message.
  const dailySorted = [...dailyMap.entries()]
    .map(([day, bucket]) => ({ day, ...bucket }))
    .sort((a, b) => a.day.localeCompare(b.day))
  let running = 0
  const daily = dailySorted.map((d) => {
    running += d.cost
    const cacheBase = d.inputTokens + d.cacheReadTokens
    const cacheHitRate = cacheBase > 0 ? d.cacheReadTokens / cacheBase : 0
    const costPerMessage = d.messages > 0 ? d.cost / d.messages : 0
    return {
      day: d.day,
      messages: d.messages,
      tokens: d.tokens,
      cost: d.cost,
      cumulativeCost: running,
      cacheHitRate,
      costPerMessage,
    }
  })

  // Pivot per-(day, model) tokens into a wide row format for stacked area charts.
  const modelKeys = [...new Set([...dailyByModelMap.values()].flatMap((m) => [...m.keys()]))]
    .sort((a, b) => a.localeCompare(b))
  const dailyByModel = [...dailyByModelMap.entries()]
    .map(([day, perModel]) => {
      const row: Record<string, string | number> & { day: string } = { day }
      for (const key of modelKeys) row[key] = perModel.get(key) ?? 0
      return row
    })
    .sort((a, b) => a.day.localeCompare(b.day))

  // Role mix: sum the per-session aggregates from the filtered session list.
  const roleMix = sessions.reduce(
    (acc, s) => {
      acc.user += s.userMessages
      acc.assistant += s.assistantMessages
      acc.system += s.systemMessages
      return acc
    },
    { user: 0, assistant: 0, system: 0 },
  )

  // Session duration buckets (last_message_at - first_message_at).
  const durationBucketDefs: Array<{ bucket: string; max: number }> = [
    { bucket: '<1m', max: 60_000 },
    { bucket: '1-5m', max: 5 * 60_000 },
    { bucket: '5-15m', max: 15 * 60_000 },
    { bucket: '15-60m', max: 60 * 60_000 },
    { bucket: '1-3h', max: 3 * 60 * 60_000 },
    { bucket: '3-12h', max: 12 * 60 * 60_000 },
    { bucket: '>12h', max: Number.POSITIVE_INFINITY },
  ]
  const durationCounts = new Map<string, number>(durationBucketDefs.map((d) => [d.bucket, 0]))
  for (const s of sessions) {
    if (s.firstMessageAt === null || s.lastMessageAt === null) continue
    const duration = Math.max(0, s.lastMessageAt - s.firstMessageAt)
    const def = durationBucketDefs.find((d) => duration < d.max) ?? durationBucketDefs[durationBucketDefs.length - 1]
    durationCounts.set(def.bucket, (durationCounts.get(def.bucket) ?? 0) + 1)
  }
  const durationBuckets = durationBucketDefs.map((d) => ({ bucket: d.bucket, sessions: durationCounts.get(d.bucket) ?? 0 }))

  // Streaks computed over UTC-day strings (matches dailyMap key format).
  const activeDaysSorted = [...dailyMap.keys()].sort()
  let longestStreak = 0
  let currentRun = 0
  let prevDate: Date | null = null
  for (const dayStr of activeDaysSorted) {
    const d = new Date(`${dayStr}T00:00:00Z`)
    if (prevDate && d.getTime() - prevDate.getTime() === 86_400_000) currentRun += 1
    else currentRun = 1
    if (currentRun > longestStreak) longestStreak = currentRun
    prevDate = d
  }
  // Current streak: run ending on today (UTC) or yesterday (still counts).
  let endingStreak = 0
  if (activeDaysSorted.length > 0) {
    const today = new Date()
    const todayStr = today.toISOString().slice(0, 10)
    const yesterdayStr = new Date(today.getTime() - 86_400_000).toISOString().slice(0, 10)
    let cursor = activeDaysSorted[activeDaysSorted.length - 1]
    if (cursor === todayStr || cursor === yesterdayStr) {
      endingStreak = 1
      for (let i = activeDaysSorted.length - 2; i >= 0; i -= 1) {
        const prev = new Date(`${activeDaysSorted[i]}T00:00:00Z`)
        const next = new Date(`${cursor}T00:00:00Z`)
        if (next.getTime() - prev.getTime() === 86_400_000) {
          endingStreak += 1
          cursor = activeDaysSorted[i]
        } else break
      }
    }
  }
  const streak = { current: endingStreak, longest: longestStreak }

  const toolErrors: CrossSessionAnalytics['toolErrors'] = [...toolMap.entries()]
    .filter(([, v]) => v.errors > 0)
    .map(([name, v]) => ({ name, total: v.count, errors: v.errors, rate: v.count > 0 ? v.errors / v.count : 0 }))
    .sort((a, b) => b.errors - a.errors || b.rate - a.rate)
    .slice(0, 25)

  const sessionCount = sessions.length
  const avgMessagesPerSession = sessionCount > 0 ? totalMessages / sessionCount : 0
  const totalTokens = totalInput + totalOutput + totalCacheRead + totalCacheWrite
  const avgTokensPerSession = sessionCount > 0 ? totalTokens / sessionCount : 0
  const avgCostPerSession = sessionCount > 0 ? totalCost / sessionCount : 0

  return {
    range: { from: filters.from ?? null, to: filters.to ?? null },
    totals: {
      sessions: sessionCount,
      messages: totalMessages,
      activeDays: dailyMap.size,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      cacheReadTokens: totalCacheRead,
      cacheWriteTokens: totalCacheWrite,
      totalTokens,
      estCost: totalCost,
      cacheHitRate,
      cacheSavings,
      avgMessagesPerSession,
      avgTokensPerSession,
      avgCostPerSession,
    },
    daily,
    sessionsPerDay: [...sessionsPerDayMap.entries()]
      .map(([day, sessions]) => ({ day, sessions }))
      .sort((a, b) => a.day.localeCompare(b.day)),
    hourHeatmap,
    providers: [...providerMap.values()].sort((a, b) => b.messages - a.messages),
    projects: [...projectMap.values()].sort((a, b) => b.messages - a.messages).slice(0, 25),
    tools: [...toolMap.entries()]
      .map(([name, v]) => ({ name, count: v.count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 25),
    toolErrors,
    models: [...modelMap.values()].sort((a, b) => b.cost - a.cost || b.messages - a.messages),
    modelKeys,
    dailyByModel,
    latency,
    origins: [...originMap.entries()]
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind)),
    roleMix,
    durationBuckets,
    streak,
    topSessions,
  }
}
