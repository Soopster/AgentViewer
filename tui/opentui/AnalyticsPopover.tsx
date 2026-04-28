/** @jsxImportSource @opentui/react */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ScrollBoxRenderable } from '@opentui/core'
import type { TuiThemePalette } from '../theme'
import type { TuiSessionDetail } from '../../lib/tui/service'
import { computeAnalyticsAsync } from './analyticsWorkerClient'
import type { Analytics, TimelinePoint } from '../../lib/analytics'
import { fmtCost, fmtDuration, fmtNum } from '../../lib/analytics'
import {
  type Insight,
  type InsightSeverity,
  INSIGHT_SEVERITY_WEIGHT,
  buildInsights,
  sortInsights,
  summarizeActivity,
  summarizeCache,
  summarizePace,
  summarizeRisk,
} from '../../lib/analyticsInsights'

function bar(value: number, max: number, width: number): string {
  if (max <= 0 || width <= 0) return ''
  const filled = Math.max(0, Math.min(width, Math.round((value / max) * width)))
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled))
}

// ---------------------------------------------------------------------------
// Pane definitions
// ---------------------------------------------------------------------------

type PaneId = 0 | 1 | 2 | 3 | 4 | 5 | 6
const PANE_TITLES: Record<PaneId, string> = {
  0: 'Summary',
  1: 'Tokens',
  2: 'Tools',
  3: 'Activity',
  4: 'Timeline',
  5: 'Insights',
  6: 'Profile',
}
const PANE_COUNT = 7

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
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const requestRef = useRef(0)
  const [pane, setPane] = React.useState<PaneId>(0)
  const scrollRef = useRef<ScrollBoxRenderable>(null)

  useEffect(() => {
    const requestId = ++requestRef.current
    let cancelled = false

    if (!detail) {
      setAnalytics(null)
      return () => {
        cancelled = true
      }
    }

    setAnalytics(null)
    void computeAnalyticsAsync(detail)
      .then((next) => {
        if (cancelled || requestId !== requestRef.current) return
        setAnalytics(next)
      })
      .catch(() => {
        if (cancelled || requestId !== requestRef.current) return
        setAnalytics(null)
      })

    return () => {
      cancelled = true
    }
  }, [detail])

  const handleKey = useCallback((key: AnalyticsKeyEvent) => {
    if (key.name === 'escape') { onClose(); return }
    if (key.sequence >= '0' && key.sequence <= '6') {
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
        {([0, 1, 2, 3, 4, 5, 6] as PaneId[]).map((p) => (
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
        <text fg={theme.dim}>{'tab/0-6 switch · j/k scroll · esc close'}</text>
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
        {analytics ? (
          <>
            {pane === 0 ? <SummaryPane a={analytics} theme={theme} width={popW - 4} /> : null}
            {pane === 1 ? <TokensPane a={analytics} theme={theme} width={popW - 4} /> : null}
            {pane === 2 ? <ToolsPane a={analytics} theme={theme} width={popW - 4} /> : null}
            {pane === 3 ? <ActivityPane a={analytics} theme={theme} width={popW - 4} /> : null}
            {pane === 4 ? <TimelinePane a={analytics} theme={theme} width={popW - 4} /> : null}
            {pane === 5 ? <InsightsPane a={analytics} theme={theme} width={popW - 4} /> : null}
            {pane === 6 ? <ProfilePane a={analytics} theme={theme} width={popW - 4} /> : null}
          </>
        ) : (
          <box paddingX={1} paddingY={1}>
            <text fg={theme.dim}>Computing analytics...</text>
          </box>
        )}
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
      borderColor={accent}
      flexDirection="row"
    >
      <box width={1} marginRight={1} backgroundColor={accent} />
      <box flexDirection="column" flexGrow={1}>
        <text fg={accent} wrapMode="none">{label}</text>
        <text fg={theme.text} wrapMode="none">{value}</text>
        {sub ? <text fg={theme.muted} wrapMode="none">{sub}</text> : null}
      </box>
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

// ---------------------------------------------------------------------------

function InsightsPane({ a, theme, width }: { a: Analytics; theme: TuiThemePalette; width: number }) {
  const insights = useMemo(() => buildInsights(a), [a])
  const topTakeaways = useMemo(() => sortInsights(insights).slice(0, 3), [insights])
  const activitySummary = useMemo(() => summarizeActivity(a), [a])
  const cacheSummary = useMemo(() => summarizeCache(a), [a])
  const riskSummary = useMemo(() => summarizeRisk(a), [a])
  const paceSummary = useMemo(() => summarizePace(a), [a])
  const accentForSeverity = (severity: InsightSeverity): string => {
    switch (severity) {
      case 'good':
        return theme.green
      case 'warn':
        return theme.amber
      case 'info':
        return theme.cyan
      case 'tip':
        return theme.violet
    }
  }
  return (
    <box flexDirection="column" paddingX={1} width={width}>
      <box flexDirection="row" width={width - 2}>
        <Kpi
          theme={theme}
          width={Math.floor((width - 2) / 3)}
          label="Cost"
          value={fmtCost(a.cost)}
          accent={theme.green}
          sub={a.turns > 0 ? `${fmtCost(a.costPerTurn)}/turn` : 'no turns'}
        />
        <Kpi
          theme={theme}
          width={Math.floor((width - 2) / 3)}
          label="Risk"
          value={riskSummary.label}
          accent={riskSummary.accent}
          sub={riskSummary.detail}
        />
        <Kpi
          theme={theme}
          width={Math.floor((width - 2) / 3)}
          label="Pace"
          value={paceSummary.label}
          accent={paceSummary.accent}
          sub={paceSummary.detail}
        />
      </box>
      <box flexDirection="row" width={width - 2}>
        <Kpi
          theme={theme}
          width={Math.floor((width - 2) / 3)}
          label="Activity"
          value={activitySummary.label}
          accent={activitySummary.accent}
          sub={activitySummary.detail}
        />
        <Kpi
          theme={theme}
          width={Math.floor((width - 2) / 3)}
          label="Cache"
          value={cacheSummary.label}
          accent={cacheSummary.accent}
          sub={cacheSummary.detail}
        />
        <Kpi
          theme={theme}
          width={Math.floor((width - 2) / 3)}
          label="Turns"
          value={String(a.turns)}
          accent={theme.violet}
          sub={a.turns > 0 ? `${a.assistantMessages} assistant replies` : 'no turns'}
        />
      </box>
      <box marginBottom={1}>
        <text fg={theme.dim}>{`${insights.length} observation${insights.length === 1 ? '' : 's'} from this session`}</text>
      </box>
      {topTakeaways.length > 0 ? (
        <box flexDirection="column" marginBottom={1}>
          <box marginBottom={0}>
            <text fg={theme.muted}>Top takeaways</text>
          </box>
          {topTakeaways.map((ins, i) => {
            const c = accentForSeverity(ins.severity)
            return (
              <box key={`${ins.title}-${i}`} flexDirection="row" width={width - 2} marginBottom={0}>
                <box width={3}>
                  <text fg={c} wrapMode="none">{`${i + 1}.`}</text>
                </box>
                <box flexDirection="column" flexGrow={1}>
                  <text fg={c} wrapMode="none">{`${ins.icon} ${ins.title}`}</text>
                  <text fg={theme.muted} wrapMode="word">{ins.detail}</text>
                </box>
              </box>
            )
          })}
        </box>
      ) : null}
      {insights.map((ins, i) => {
        const c = accentForSeverity(ins.severity)
        return (
          <box
            key={i}
            flexDirection="row"
            width={width - 2}
            marginBottom={1}
            paddingX={1}
            paddingY={0}
            backgroundColor={theme.surface2}
            border
            borderStyle="single"
            borderColor={theme.border}
          >
            <box width={3}>
              <text fg={c} wrapMode="none">{ins.icon}</text>
            </box>
            <box flexDirection="column" flexGrow={1}>
              <text fg={c} wrapMode="none">{ins.title}</text>
              <text fg={theme.muted} wrapMode="word">{ins.detail}</text>
            </box>
          </box>
        )
      })}
    </box>
  )
}

function DayOfWeekBar({
  counts, theme, width,
}: {
  counts: number[]; theme: TuiThemePalette; width: number
}) {
  const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const max = Math.max(1, ...counts)
  const cellW = Math.max(1, Math.floor((width - 6) / 7))
  const rows: React.ReactNode[] = []
  for (let r = 4; r >= 0; r -= 1) {
    const cells: React.ReactNode[] = []
    for (let d = 0; d < 7; d += 1) {
      const pct = (counts[d] ?? 0) / max
      const filled = Math.round(pct * 4)
      const on = filled >= r
      const color = !on
        ? theme.surface2
        : pct > 0.66 ? theme.violet
        : pct > 0.33 ? theme.cyan
        : theme.amber
      cells.push(
        <text key={d} fg={color} wrapMode="none">{(on ? '█' : '░').repeat(cellW)}</text>
      )
    }
    rows.push(<box key={r} flexDirection="row">{cells}</box>)
  }
  const axis: React.ReactNode[] = labels.map((label, i) => (
    <box key={label} width={cellW} marginRight={i < 6 ? 0 : 0}>
      <text fg={theme.dim} wrapMode="none">{label.slice(0, cellW)}</text>
    </box>
  ))
  return (
    <box flexDirection="column" width={width}>
      {rows}
      <box flexDirection="row">{axis}</box>
    </box>
  )
}

function SizeHistogram({
  values, theme, width,
}: {
  values: number[]; theme: TuiThemePalette; width: number
}) {
  if (values.length === 0) {
    return <box width={width}><text fg={theme.dim}>(no data)</text></box>
  }
  const buckets: { label: string; max: number; count: number }[] = [
    { label: '<100', max: 100, count: 0 },
    { label: '100-500', max: 500, count: 0 },
    { label: '500-2k', max: 2_000, count: 0 },
    { label: '2k-10k', max: 10_000, count: 0 },
    { label: '10k-50k', max: 50_000, count: 0 },
    { label: '50k-200k', max: 200_000, count: 0 },
    { label: '>200k', max: Infinity, count: 0 },
  ]
  for (const v of values) {
    for (const b of buckets) {
      if (v < b.max) { b.count += 1; break }
    }
  }
  const max = Math.max(1, ...buckets.map((b) => b.count))
  const labelW = 10
  const countW = 6
  const barW = Math.max(8, width - labelW - countW - 2)
  return (
    <box flexDirection="column" width={width}>
      {buckets.map((b) => (
        <box key={b.label} flexDirection="row" width={width}>
          <box width={labelW}><text fg={theme.dim} wrapMode="none">{b.label}</text></box>
          <box width={countW}><text fg={theme.violet} wrapMode="none">{String(b.count)}</text></box>
          <box width={barW}>
            <text fg={theme.cyan} wrapMode="none">{bar(b.count, max, barW)}</text>
          </box>
        </box>
      ))}
    </box>
  )
}

function ProfilePane({ a, theme, width }: { a: Analytics; theme: TuiThemePalette; width: number }) {
  const extEntries = a.fileExtensions.slice(0, 12)
  const totalExts = extEntries.reduce((sum, [, count]) => sum + count, 0)
  const colWidth = Math.floor((width - 2) / 2)
  return (
    <box flexDirection="column" paddingX={1} width={width}>
      <box flexDirection="row" width={width}>
        <Kpi theme={theme} width={colWidth} label="Tokens / tool"
             value={a.tokensPerToolUse > 0 ? fmtNum(a.tokensPerToolUse) : '—'}
             accent={theme.violet}
             sub={`${a.toolUses} tool uses · output only`} />
        <Kpi theme={theme} width={colWidth} label="Avg chain"
             value={a.avgAssistantChain > 0 ? a.avgAssistantChain.toFixed(1) : '0'}
             accent={theme.pink}
             sub={`max ${a.longestAssistantChain} assistant replies`} />
      </box>
      <box flexDirection="row" width={width}>
        <Kpi theme={theme} width={colWidth} label="Files touched"
             value={fmtNum(a.ops.filesTouched.size)}
             accent={theme.cyan}
             sub={a.costPerFileTouched > 0 ? `${fmtCost(a.costPerFileTouched)}/file` : 'no files'} />
        <Kpi theme={theme} width={colWidth} label="Lines changed"
             value={fmtNum(a.ops.linesAdded + a.ops.linesRemoved)}
             accent={theme.amber}
             sub={a.costPerLineChanged > 0 ? `${fmtCost(a.costPerLineChanged)}/line` : 'no diff'} />
      </box>

      <box marginTop={1} marginBottom={1}>
        <text fg={theme.muted}>Activity by day of week</text>
      </box>
      <DayOfWeekBar counts={a.dayOfWeekActivity} theme={theme} width={width - 2} />

      <box marginTop={1} marginBottom={1}>
        <text fg={theme.muted}>File extensions touched</text>
      </box>
      {extEntries.length > 0 ? (
        <box flexDirection="column">
          <RankedBars theme={theme} width={width - 2} entries={extEntries} color={theme.pink} />
          <box marginTop={0}>
            <text fg={theme.dim} wrapMode="none">
              {`${totalExts} file touches across ${extEntries.length} extension${extEntries.length === 1 ? '' : 's'}`}
            </text>
          </box>
        </box>
      ) : (
        <box><text fg={theme.dim}>(no file extensions recorded)</text></box>
      )}

      <box marginTop={1} marginBottom={1}>
        <text fg={theme.muted}>Block types</text>
      </box>
      <CompositionBar theme={theme} width={width - 2} segments={[
        { label: `text (${a.blockTypes.text})`, value: a.blockTypes.text, color: theme.cyan },
        { label: `thinking (${a.blockTypes.thinking})`, value: a.blockTypes.thinking, color: theme.amber },
        { label: `tool use (${a.blockTypes.toolUse})`, value: a.blockTypes.toolUse, color: theme.violet },
        { label: `tool result (${a.blockTypes.toolResult})`, value: a.blockTypes.toolResult, color: theme.green },
        { label: `other (${a.blockTypes.other})`, value: a.blockTypes.other, color: theme.dim },
      ]} />

      <box marginTop={1} marginBottom={1}>
        <text fg={theme.muted}>Message size distribution</text>
      </box>
      <SizeHistogram values={a.messageSizes} theme={theme} width={width - 2} />
    </box>
  )
}
