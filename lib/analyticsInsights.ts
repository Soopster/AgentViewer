import type { Analytics } from './analytics'
import { fmtCost, fmtDuration, fmtNum } from './analytics'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InsightSeverity = 'good' | 'warn' | 'info' | 'tip'
export type Insight = { severity: InsightSeverity; icon: string; title: string; detail: string }
export type SessionDigest = { label: string; detail: string; accent: string }

export const INSIGHT_SEVERITY_WEIGHT: Record<InsightSeverity, number> = {
  warn: 3, good: 2, info: 1, tip: 0,
}

// ---------------------------------------------------------------------------
// Numeric helpers
// ---------------------------------------------------------------------------

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p))
  return sorted[idx]!
}

// ---------------------------------------------------------------------------
// Session digest summaries (used in TUI InsightsPane header KPIs)
// ---------------------------------------------------------------------------

export function summarizeRisk(a: Analytics): SessionDigest {
  const high = a.errorRate > 0.15 || a.cost > 5 || (a.toolUses > 0 && a.toolErrors > 0)
  const medium = a.errorRate > 0.05 || a.longestIdleMs > 30 * 60_000 || a.cacheHitRate < 0.2
  if (high) return { label: 'high',   detail: `${a.toolErrors} tool errors · ${fmtCost(a.cost)} spend`,                                accent: '#f87171' }
  if (medium) return { label: 'medium', detail: `${(a.errorRate * 100).toFixed(1)}% error rate · ${fmtDuration(a.longestIdleMs)}`,  accent: '#fbbf24' }
  return { label: 'low', detail: 'No major reliability signals', accent: '#34d399' }
}

export function summarizePace(a: Analytics): SessionDigest {
  if (a.medianFirstResponseMs !== null) {
    if (a.medianFirstResponseMs < 3_000)
      return { label: 'snappy', detail: `median ${fmtDuration(a.medianFirstResponseMs)} first reply`, accent: '#34d399' }
    if (a.medianFirstResponseMs > 30_000)
      return { label: 'slow',   detail: `median ${fmtDuration(a.medianFirstResponseMs)} first reply`, accent: '#fbbf24' }
  }
  return {
    label: a.tokensPerSecond > 0 ? `${fmtNum(a.tokensPerSecond)} tok/s` : 'steady',
    detail: a.tokensPerSecond > 0 ? `peak output ${fmtNum(a.peakTokensPerMin)} tok/min` : 'not enough activity to measure',
    accent: '#38bdf8',
  }
}

export function summarizeActivity(a: Analytics): SessionDigest {
  const activeRatio = a.durationMs && a.durationMs > 0 ? a.activeMs / a.durationMs : 0
  if (activeRatio > 0.8)
    return { label: 'focused',     detail: `${(activeRatio * 100).toFixed(0)}% active time`,           accent: '#34d399' }
  if (activeRatio < 0.25 && a.durationMs !== null)
    return { label: 'interrupted', detail: `${fmtDuration(a.longestIdleMs)} longest gap`,              accent: '#fbbf24' }
  return { label: 'mixed',       detail: `${fmtDuration(a.activeMs)} active time`,                     accent: '#38bdf8' }
}

export function summarizeCache(a: Analytics): SessionDigest {
  if (a.cacheHitRate > 0.6)
    return { label: `${(a.cacheHitRate * 100).toFixed(0)}% hit`, detail: `${fmtCost(a.cacheSavings)} saved`,           accent: '#34d399' }
  if (a.cacheHitRate < 0.15 && a.inputTokens > 50_000)
    return { label: 'weak',                                       detail: `${fmtNum(a.inputTokens)} input tokens`,      accent: '#fbbf24' }
  return { label: `${(a.cacheHitRate * 100).toFixed(0)}% hit`,   detail: `${fmtNum(a.cacheReadTokens)} cache reads`,   accent: '#38bdf8' }
}

// ---------------------------------------------------------------------------
// Insight sorting
// ---------------------------------------------------------------------------

export function sortInsights(insights: Insight[]): Insight[] {
  return [...insights]
    .map((ins, index) => ({ ins, index }))
    .sort((a, b) => {
      const wa = INSIGHT_SEVERITY_WEIGHT[a.ins.severity]
      const wb = INSIGHT_SEVERITY_WEIGHT[b.ins.severity]
      return wa !== wb ? wb - wa : a.index - b.index
    })
    .map(({ ins }) => ins)
}

// ---------------------------------------------------------------------------
// Canonical insight engine — single source of truth for web + TUI
// ---------------------------------------------------------------------------

export function buildInsights(a: Analytics): Insight[] {
  const out: Insight[] = []
  const ops = a.ops
  const editTotal = ops.edits + ops.multiEdits + ops.writes
  const totalOps = ops.reads + editTotal + ops.bashCommands + ops.searches

  // Session character
  if (totalOps > 0) {
    const readShare = ops.reads / totalOps
    const editShare = editTotal / totalOps
    if (readShare > 0.6 && editTotal < 3)
      out.push({ severity: 'info', icon: '🔍', title: 'Exploration session',
        detail: `${ops.reads} reads vs only ${editTotal} edits — mostly investigating rather than modifying.` })
    else if (editShare > 0.5)
      out.push({ severity: 'info', icon: '✏️', title: 'Code-modification session',
        detail: `${editTotal} edits/writes across ${ops.filesTouched.size} files · +${ops.linesAdded.toLocaleString()}/-${ops.linesRemoved.toLocaleString()} lines.` })
    else if (ops.bashCommands > Math.max(ops.reads, editTotal))
      out.push({ severity: 'info', icon: '⌨', title: 'Shell-heavy session',
        detail: `${ops.bashCommands} shell commands dominate — infrastructure or ops work.` })
  }

  // Cache efficiency
  if (a.inputTokens + a.cacheReadTokens > 10_000) {
    if (a.cacheHitRate > 0.6)
      out.push({ severity: 'good', icon: '⚡', title: 'Strong cache utilization',
        detail: `${(a.cacheHitRate * 100).toFixed(0)}% of input served from cache — saved approximately ${fmtCost(a.cacheSavings)}.` })
    else if (a.cacheHitRate < 0.15 && a.inputTokens > 50_000)
      out.push({ severity: 'warn', icon: '💸', title: 'Low cache hit rate',
        detail: `Only ${(a.cacheHitRate * 100).toFixed(1)}% of ${fmtNum(a.inputTokens)} input tokens hit cache. Reusing context could reduce cost.` })
  }

  // Active time ratio
  if (a.durationMs !== null && a.durationMs > 0) {
    const activeRatio = a.activeMs / a.durationMs
    if (activeRatio > 0.8 && a.durationMs > 10 * 60_000)
      out.push({ severity: 'good', icon: '🎯', title: 'Sustained focus',
        detail: `${(activeRatio * 100).toFixed(0)}% of the session was active time — consistently engaged throughout.` })
    else if (activeRatio < 0.25 && a.durationMs > 30 * 60_000)
      out.push({ severity: 'info', icon: '⏳', title: 'Interrupted session',
        detail: `Only ${(activeRatio * 100).toFixed(0)}% active time across ${fmtDuration(a.durationMs)} — session was frequently paused.` })
  }

  // Tool error rate
  if (a.toolUses > 5) {
    if (a.errorRate > 0.15)
      out.push({ severity: 'warn', icon: '⚠', title: 'Elevated tool error rate',
        detail: `${a.toolErrors} of ${a.toolUses} tool calls errored (${(a.errorRate * 100).toFixed(1)}%).` })
    else if (a.errorRate === 0)
      out.push({ severity: 'good', icon: '✓', title: 'No tool errors',
        detail: `All ${a.toolUses} tool calls succeeded.` })
  }

  // Top tool
  if (a.tools.length > 0) {
    const top = a.tools[0]!
    const share = top.count / Math.max(1, a.toolUses)
    if (share > 0.5)
      out.push({ severity: 'info', icon: '🔧', title: `${top.name} dominates`,
        detail: `${top.count} of ${a.toolUses} tool calls (${(share * 100).toFixed(0)}%) used ${top.name}.` })
  }

  // Response latency
  if (a.medianFirstResponseMs !== null && a.medianFirstResponseMs > 30_000)
    out.push({ severity: 'warn', icon: '🐢', title: 'Slow response latency',
      detail: `Median time to first reply: ${fmtDuration(a.medianFirstResponseMs)}. The agent is spending a lot of time per turn.` })
  else if (a.medianFirstResponseMs !== null && a.medianFirstResponseMs < 3_000)
    out.push({ severity: 'good', icon: '🚀', title: 'Snappy responses',
      detail: `Median first-response latency: ${fmtDuration(a.medianFirstResponseMs)}.` })

  // Long idle gap
  if (a.longestIdleMs > 30 * 60_000)
    out.push({ severity: 'info', icon: '⏸', title: 'Session spans a long idle gap',
      detail: `Longest quiet period was ${fmtDuration(a.longestIdleMs)} — session was paused between turns.` })

  // Cost
  if (a.cost > 5)
    out.push({ severity: 'warn', icon: '💰', title: 'High session cost',
      detail: `Estimated ${fmtCost(a.cost)} · ${fmtCost(a.costPerTurn)}/turn across ${a.turns} turns.` })
  else if (a.cost > 0 && a.cost < 0.05 && a.messages > 10)
    out.push({ severity: 'good', icon: '💵', title: 'Very low cost',
      detail: `${a.messages} messages for only ${fmtCost(a.cost)} — cache kept this cheap.` })

  // Cost category breakdown
  if (a.cost > 0) {
    const outputShare = a.costByCategory.output / a.cost
    const cacheShare = (a.costByCategory.cacheRead + a.costByCategory.cacheWrite) / a.cost
    if (outputShare > 0.6)
      out.push({ severity: 'info', icon: '🧾', title: 'Output-driven spend',
        detail: `${(outputShare * 100).toFixed(0)}% of cost came from model output tokens.` })
    else if (cacheShare > 0.35 && a.cacheHitRate > 0.4)
      out.push({ severity: 'good', icon: '♻', title: 'Cache-heavy workload',
        detail: `${(cacheShare * 100).toFixed(0)}% of spend was cache-related, with ${(a.cacheHitRate * 100).toFixed(0)}% cache hit rate.` })
  }

  // Thinking share
  if (a.thinkingBlocks > 0 && a.assistantTextChars > 0) {
    const thinkShare = a.thinkingChars / (a.thinkingChars + a.assistantTextChars)
    if (thinkShare > 0.5)
      out.push({ severity: 'info', icon: '🧠', title: 'Heavy reasoning',
        detail: `${(thinkShare * 100).toFixed(0)}% of assistant output was extended thinking — ${a.thinkingBlocks} blocks, ${fmtNum(a.thinkingChars)} chars.` })
  }

  // Multi-reply chains
  if (a.turns > 0 && a.avgAssistantChain > 1.5)
    out.push({ severity: 'info', icon: '🪃', title: 'Multi-reply assistant chains',
      detail: `${a.avgAssistantChain.toFixed(1)} assistant messages per turn on average.` })

  // Deep agent loops
  if (a.toolsPerTurn > 8)
    out.push({ severity: 'info', icon: '🪜', title: 'Deep agent loops',
      detail: `${a.toolsPerTurn.toFixed(1)} tool calls per user turn · longest chain of ${a.longestAssistantChain} assistant messages.` })

  // Very long reply
  if (a.maxOutputInReply > 8_000)
    out.push({ severity: 'tip', icon: '📏', title: 'Very long assistant reply',
      detail: `One reply generated ${fmtNum(a.maxOutputInReply)} output tokens. Consider breaking such requests into smaller steps.` })

  // Bursty output — relative check (peak ≥ 3× session average)
  if (a.durationMs !== null && a.durationMs > 0 && a.outputTokens > 0) {
    const avgPerMin = (a.outputTokens / a.durationMs) * 60_000
    if (avgPerMin > 0 && a.peakTokensPerMin / avgPerMin >= 3)
      out.push({ severity: 'tip', icon: '⚡', title: 'Bursty output',
        detail: `Peak output rate was ${(a.peakTokensPerMin / avgPerMin).toFixed(1)}× the session average.` })
  }

  // Fast output peak — absolute threshold
  if (a.peakTokensPerMin > 20_000)
    out.push({ severity: 'info', icon: '📈', title: 'Fast output peak',
      detail: `Peak throughput reached ${fmtNum(a.peakTokensPerMin)} output tokens/minute.` })

  // Hot-spot file
  if (ops.editsByFile.size > 0) {
    const topFile = [...ops.editsByFile.entries()].sort((a, b) => b[1] - a[1])[0]!
    if (topFile[1] >= 5) {
      const base = topFile[0].split('/').pop() ?? topFile[0]
      out.push({ severity: 'tip', icon: '📝', title: 'Hot-spot file',
        detail: `${base} was edited ${topFile[1]} times — likely the centerpiece of this session.` })
    }
  }

  // Top file extension
  if (a.fileExtensions.length > 0) {
    const topExt = a.fileExtensions[0]!
    const totalExtTouches = a.fileExtensions.reduce((sum, [, c]) => sum + c, 0)
    const share = totalExtTouches > 0 ? topExt[1] / totalExtTouches : 0
    if (share > 0.55 && topExt[0] !== '(no ext)')
      out.push({ severity: 'tip', icon: '📁', title: `Mostly ${topExt[0]} work`,
        detail: `${topExt[0]} accounted for ${(share * 100).toFixed(0)}% of touched file types.` })
  }

  // Shell verb
  if (ops.bashByVerb.size > 0) {
    const topVerb = [...ops.bashByVerb.entries()].sort((a, b) => b[1] - a[1])[0]!
    if (topVerb[1] >= 5)
      out.push({ severity: 'info', icon: '⌨', title: `${topVerb[0]} used ${topVerb[1]}×`,
        detail: `The most-run shell command verb in this session.` })
  }

  // Peak hour
  if (a.messages > 0) {
    const maxCount = Math.max(...a.hourActivity)
    if (maxCount > 0) {
      const peakHour = a.hourActivity.indexOf(maxCount)
      if (maxCount / a.messages > 0.35)
        out.push({ severity: 'info', icon: '🕒', title: `Peak activity around ${peakHour}:00`,
          detail: `${maxCount} of ${a.messages} messages (${((maxCount / a.messages) * 100).toFixed(0)}%) landed in that single hour.` })
    }
  }

  // Peak day of week
  if (a.messages > 0) {
    const maxDay = Math.max(...a.dayOfWeekActivity)
    if (maxDay > 0) {
      const peakDay = a.dayOfWeekActivity.indexOf(maxDay)
      const dayShare = maxDay / a.messages
      const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      if (dayShare > 0.35)
        out.push({ severity: 'tip', icon: '📅', title: `Most activity on ${DAY_LABELS[peakDay]}`,
          detail: `${maxDay} of ${a.messages} messages (${(dayShare * 100).toFixed(0)}%) landed on that day.` })
    }
  }

  // Slash commands
  if (a.slashCommands >= 3)
    out.push({ severity: 'info', icon: '/', title: `${a.slashCommands} slash commands`,
      detail: `Session made heavy use of slash commands — you may want to review what was invoked.` })

  // Conversation-only session
  if (a.toolUses === 0 && a.messages > 6)
    out.push({ severity: 'info', icon: '💬', title: 'Conversation-only session',
      detail: `No tool calls across ${a.messages} messages — pure Q&A or planning.` })

  // Cost per line changed
  if (a.costPerLineChanged > 0 && (ops.linesAdded + ops.linesRemoved) > 100)
    out.push({ severity: 'tip', icon: '📊', title: 'Cost per line changed',
      detail: `${fmtCost(a.costPerLineChanged)} per line touched across ${(ops.linesAdded + ops.linesRemoved).toLocaleString()} lines.` })

  // Multiple models
  if (a.models.length > 1) {
    const names = a.models.slice(0, 3).map((m) => m.model.split('-').slice(-2).join('-')).join(', ')
    out.push({ severity: 'info', icon: '🔀', title: `${a.models.length} models used`,
      detail: `Session switched between models: ${names}${a.models.length > 3 ? ` + ${a.models.length - 3} more` : ''}.` })
  }

  // Cost acceleration
  if (a.cumulativeCost.length >= 6 && a.cost > 0) {
    const mid = Math.floor(a.cumulativeCost.length / 2)
    const firstHalf = a.cumulativeCost[mid - 1]!
    const secondHalf = a.cost - firstHalf
    if (firstHalf > 0 && secondHalf > firstHalf * 1.8)
      out.push({ severity: 'warn', icon: '📉', title: 'Cost accelerating',
        detail: `Second half of the session cost ${(secondHalf / firstHalf).toFixed(1)}× more than the first — context growing rapidly.` })
  }

  // Context inflation
  if (a.messageSizes.length >= 9) {
    const third = Math.floor(a.messageSizes.length / 3)
    const early = [...a.messageSizes.slice(0, third)].sort((a, b) => a - b)
    const late  = [...a.messageSizes.slice(-third)].sort((a, b) => a - b)
    const medEarly = early[Math.floor(early.length / 2)]!
    const medLate  = late[Math.floor(late.length / 2)]!
    if (medEarly > 0 && medLate > medEarly * 2)
      out.push({ severity: 'warn', icon: '📦', title: 'Context inflation',
        detail: `Median message size grew ${(medLate / medEarly).toFixed(1)}× from early to late (${fmtNum(medEarly)} → ${fmtNum(medLate)} tokens).` })
  }

  // Research-heavy session
  if (a.ops.webFetches >= 5) {
    const share = a.ops.webFetches / Math.max(1, a.ops.webFetches + a.ops.searches + a.ops.reads)
    out.push({ severity: 'info', icon: '🌐', title: 'Research-heavy session',
      detail: `${a.ops.webFetches} web fetches — ${(share * 100).toFixed(0)}% of all lookup operations were external.` })
  }

  // Tool error concentration
  if (a.toolErrors >= 3) {
    const mostErrored = [...a.tools].sort((x, y) => y.errors - x.errors)[0]
    if (mostErrored && mostErrored.errors >= 2 && mostErrored.errors / a.toolErrors >= 0.5)
      out.push({ severity: 'warn', icon: '🎯', title: `${mostErrored.name} error-prone`,
        detail: `${mostErrored.name} caused ${mostErrored.errors} of ${a.toolErrors} tool errors (${((mostErrored.errors / a.toolErrors) * 100).toFixed(0)}%).` })
  }

  // Recovery pattern
  if (ops.bashByVerb.size > 0) {
    const repairVerbs = ['git', 'npm', 'pip', 'pip3', 'bundle', 'yarn', 'pnpm', 'cargo', 'brew', 'apt', 'apt-get']
    const repairCount = repairVerbs.reduce((sum, v) => sum + (ops.bashByVerb.get(v) ?? 0), 0)
    if (repairCount >= 4 && repairCount > ops.bashCommands * 0.3)
      out.push({ severity: 'tip', icon: '🔧', title: 'Dependency/recovery work',
        detail: `${repairCount} of ${ops.bashCommands} shell commands used package or version-control tools — may indicate environment repair.` })
  }

  // Editing without reading
  if ((ops.edits + ops.writes) >= 5 && ops.reads < (ops.edits + ops.writes) / 3)
    out.push({ severity: 'tip', icon: '✍️', title: 'Editing without reading',
      detail: `${ops.edits + ops.writes} edits/writes but only ${ops.reads} reads — agent may be modifying files it hasn't fully inspected.` })

  // User verbosity
  if (a.userMessages >= 4 && a.userTextChars > 0) {
    const avgCharsPerMsg = a.userTextChars / a.userMessages
    if (avgCharsPerMsg < 25)
      out.push({ severity: 'info', icon: '⚡', title: 'Terse user prompts',
        detail: `Average ${Math.round(avgCharsPerMsg)} chars per user message — short commands driving the session.` })
    else if (avgCharsPerMsg > 600)
      out.push({ severity: 'info', icon: '📝', title: 'Detailed user prompts',
        detail: `Average ${Math.round(avgCharsPerMsg)} chars per user message — rich context being provided each turn.` })
  }

  // Responses slowing down
  if (a.timeline.length >= 8) {
    const latencies = a.timeline.map((p) => p.latencyMs).filter((v): v is number => v !== null && v >= 0)
    if (latencies.length >= 6) {
      const third = Math.floor(latencies.length / 3)
      const earlyMed = [...latencies.slice(0, third)].sort((a, b) => a - b)[Math.floor(third / 2)]!
      const lateMed  = [...latencies.slice(-third)].sort((a, b) => a - b)[Math.floor(third / 2)]!
      if (earlyMed > 0 && lateMed > earlyMed * 2 && lateMed > 10_000)
        out.push({ severity: 'warn', icon: '🐌', title: 'Responses slowing down',
          detail: `Later turns took ${(lateMed / earlyMed).toFixed(1)}× longer than early turns (${fmtDuration(earlyMed)} → ${fmtDuration(lateMed)} median).` })
    }
  }

  // Interrupted turns (zero-output assistant messages)
  if (a.assistantMessages > 0) {
    const zeroOutputTurns = a.timeline.filter((p) => p.role === 'assistant' && p.outputTokens === 0).length
    if (zeroOutputTurns >= 2 && zeroOutputTurns / a.assistantMessages > 0.15)
      out.push({ severity: 'info', icon: '⏹', title: `${zeroOutputTurns} interrupted turns`,
        detail: `${zeroOutputTurns} assistant turns had zero output tokens — likely cancelled or interrupted mid-response.` })
  }

  // Context window pressure
  if (a.messageSizes.length > 0) {
    const lastSize = a.messageSizes[a.messageSizes.length - 1]!
    if (lastSize > 180_000)
      out.push({ severity: 'warn', icon: '🔴', title: 'Context window near limit',
        detail: `Latest message is ${fmtNum(lastSize)} tokens — approaching the 200k limit. Consider compressing context or starting a new session.` })
    else if (lastSize > 130_000)
      out.push({ severity: 'warn', icon: '📶', title: 'Context window filling up',
        detail: `Latest message is ${fmtNum(lastSize)} tokens. Over half the context window is consumed — latency and cost will keep rising.` })
  }

  // Cache primed but not reused
  if (a.cacheWriteTokens > 10_000 && a.cacheReadTokens < 1_000 && a.turns > 1)
    out.push({ severity: 'tip', icon: '💾', title: 'Cache primed but not reused',
      detail: `${fmtNum(a.cacheWriteTokens)} tokens written to cache but only ${fmtNum(a.cacheReadTokens)} read back across ${a.turns} turns. Cache expires after 5 min — shorter gaps between turns leverage it best.` })

  // Code changed without running it
  if (editTotal >= 8 && ops.bashCommands === 0 && ops.linesAdded + ops.linesRemoved > 50)
    out.push({ severity: 'tip', icon: '🧪', title: 'Code changed without running it',
      detail: `${editTotal} edits across ${ops.filesTouched.size} file${ops.filesTouched.size === 1 ? '' : 's'} but no shell commands — changes weren't verified by running or testing during this session.` })

  // Fully autonomous single-prompt run
  if (a.userMessages <= 1 && a.assistantMessages >= 5 && a.toolUses >= 3)
    out.push({ severity: 'info', icon: '🤖', title: 'Fully autonomous run',
      detail: `${a.assistantMessages} assistant turns and ${a.toolUses} tool calls driven by a single prompt — largely uninterrupted agentic execution.` })

  // Context-heavy session (skewed I/O ratio)
  if (a.outputTokens > 0 && a.inputTokens / a.outputTokens > 20 && a.inputTokens > 100_000)
    out.push({ severity: 'tip', icon: '📥', title: 'Context-heavy session',
      detail: `${fmtNum(a.inputTokens)} input vs ${fmtNum(a.outputTokens)} output tokens (${(a.inputTokens / a.outputTokens).toFixed(0)}:1 ratio) — a large prompt is re-sent every turn, driving most of the cost.` })

  // Night owl
  if (a.messages > 5) {
    const nightMsgs = [0, 1, 2, 3, 4].reduce((s, h) => s + (a.hourActivity[h] ?? 0), 0)
    if (nightMsgs / a.messages > 0.5)
      out.push({ severity: 'info', icon: '🌙', title: 'Night owl session',
        detail: `${Math.round((nightMsgs / a.messages) * 100)}% of messages sent between midnight and 5am local time.` })
  }

  // Fallback
  if (out.length === 0)
    out.push({ severity: 'info', icon: 'ℹ', title: 'Not much to highlight yet',
      detail: 'This session is short or light on signals. Insights will sharpen as more activity accumulates.' })

  return out
}
