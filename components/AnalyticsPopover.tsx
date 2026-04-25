'use client'

import { useEffect, useMemo, useState } from 'react'
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts'
import type { Analytics, AnalyticsInput, FileOps, TimelinePoint } from '@/lib/analytics'
import { computeAnalytics, fmtCost, fmtDuration, fmtNum } from '@/lib/analytics'

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

type Props = {
  open: boolean
  onClose: () => void
  input: AnalyticsInput | null
}

export default function AnalyticsPopover({ open, onClose, input }: Props) {
  const [pane, setPane] = useState<PaneId>(0)
  const analytics = useMemo(() => computeAnalytics(open ? input : null), [open, input])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      else if (e.key >= '0' && e.key <= '6') setPane(parseInt(e.key, 10) as PaneId)
      else if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault()
        setPane((p) => ((p + 1) % PANE_COUNT) as PaneId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(1180px, 100%)',
          maxHeight: 'calc(100vh - 48px)',
          background: 'var(--surface)',
          border: '1px solid var(--border-2)',
          borderRadius: 10,
          boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
          display: 'flex',
          flexDirection: 'column',
          fontFamily: "'IBM Plex Mono', monospace",
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface-2)',
          }}
        >
          <span
            style={{
              fontSize: 11,
              color: 'var(--text-3)',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              marginRight: 10,
            }}
          >
            Session analytics
          </span>
          {([0, 1, 2, 3, 4, 5, 6] as PaneId[]).map((p) => (
            <button
              key={p}
              onClick={() => setPane(p)}
              style={{
                padding: '5px 10px',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 11,
                letterSpacing: '0.08em',
                color: pane === p ? 'var(--surface)' : 'var(--text-2)',
                background: pane === p ? 'var(--cyan, #5eead4)' : 'transparent',
                border: '1px solid ' + (pane === p ? 'transparent' : 'var(--border)'),
                borderRadius: 5,
                cursor: 'pointer',
              }}
            >
              [{p}] {PANE_TITLES[p]}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 10, color: 'var(--text-3)', marginRight: 8 }}>
            tab / 0-6 switch · esc close
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--text-2)',
              cursor: 'pointer',
              padding: '4px 10px',
              borderRadius: 5,
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
            }}
          >
            ✕ CLOSE
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: '16px 18px',
            background: 'var(--surface)',
            color: 'var(--text)',
            fontSize: 12,
          }}
        >
          {pane === 0 && <SummaryPane a={analytics} />}
          {pane === 1 && <TokensPane a={analytics} />}
          {pane === 2 && <ToolsPane a={analytics} />}
          {pane === 3 && <ActivityPane a={analytics} />}
          {pane === 4 && <TimelinePane a={analytics} />}
          {pane === 5 && <InsightsPane a={analytics} />}
          {pane === 6 && <ProfilePane a={analytics} />}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p))
  return sorted[idx]!
}

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--text-3)',
  marginBottom: 8,
}

function Kpi({
  label, value, sub, accent,
}: {
  label: string; value: string; sub?: string; accent: string
}) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        padding: '10px 12px',
        border: `1px solid ${accent}`,
        borderRadius: 8,
        background: 'var(--surface-2)',
        display: 'flex',
        flexDirection: 'row',
        gap: 10,
        alignItems: 'stretch',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.02)',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 4,
          borderRadius: 999,
          background: accent,
          flexShrink: 0,
        }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: accent }}>
          {label}
        </span>
        <span style={{ fontSize: 18, color: 'var(--text)', fontWeight: 500, lineHeight: 1.1 }}>
          {value}
        </span>
        {sub && (
          <span style={{ fontSize: 11, color: 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {sub}
          </span>
        )}
      </div>
    </div>
  )
}

function KpiRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>{children}</div>
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={LABEL_STYLE}>{children}</div>
}

function CompositionBar({
  segments,
}: {
  segments: { label: string; value: number; color: string }[]
}) {
  const total = segments.reduce((a, s) => a + s.value, 0)
  if (total === 0) return <div style={{ color: 'var(--text-3)', fontSize: 11 }}>(no tokens recorded)</div>
  return (
    <div>
      <div style={{ display: 'flex', height: 14, borderRadius: 3, overflow: 'hidden', background: 'var(--surface-2)' }}>
        {segments.map((s) => {
          const pct = (s.value / total) * 100
          if (pct <= 0) return null
          return <div key={s.label} style={{ width: `${pct}%`, background: s.color }} />
        })}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 6, fontSize: 11, color: 'var(--text-3)' }}>
        {segments.map((s) => (
          <span key={s.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ display: 'inline-block', width: 10, height: 10, background: s.color, borderRadius: 2 }} />
            {s.label} {fmtNum(s.value)}
          </span>
        ))}
      </div>
    </div>
  )
}

function HBar({
  label, count, max, color, width,
}: {
  label: string; count: number; max: number; color: string; width?: number
}) {
  const pct = max > 0 ? (count / max) * 100 : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '2px 0', fontSize: 11 }}>
      <span style={{ width: width ?? 140, color: 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {label}
      </span>
      <span style={{ width: 50, color, textAlign: 'right' }}>{count}</span>
      <span style={{ flex: 1, height: 10, background: 'var(--surface-2)', borderRadius: 2, overflow: 'hidden' }}>
        <span style={{ display: 'block', width: `${pct}%`, height: '100%', background: color }} />
      </span>
    </div>
  )
}

function Sparkline({
  values, height, colors,
}: {
  values: number[]
  height: number
  colors: string[]
}) {
  if (values.length === 0) return <div style={{ color: 'var(--text-3)', fontSize: 11 }}>(no data)</div>
  const data = values.map((v, i) => ({ index: i, value: v }))
  const primaryColor = colors[0] ?? 'var(--cyan, #5eead4)'
  const gradientId = `gradient-${Math.random().toString(36).substr(2, 9)}`

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 2, right: 2, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={primaryColor} stopOpacity={0.3}/>
            <stop offset="95%" stopColor={primaryColor} stopOpacity={0}/>
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="value" stroke={primaryColor} fill={`url(#${gradientId})`} strokeWidth={1.5} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

// ---------------------------------------------------------------------------
// Summary pane
// ---------------------------------------------------------------------------

function SummaryPane({ a }: { a: Analytics }) {
  const rateInPerMin = a.durationMs && a.durationMs > 0 ? a.inputTokens / (a.durationMs / 60_000) : null
  const rateOutPerMin = a.durationMs && a.durationMs > 0 ? a.outputTokens / (a.durationMs / 60_000) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6 }}>
        Session totals · {a.provider ?? '—'} · {a.model}
      </div>

      <KpiRow>
        <Kpi label="Messages" value={String(a.messages)} accent="var(--cyan, #5eead4)"
          sub={`${a.userMessages} user · ${a.assistantMessages} asst · ${a.systemMessages} sys`} />
        <Kpi label="Total tokens" value={fmtNum(a.totalTokens)} accent="var(--violet)"
          sub={`${fmtNum(a.inputTokens)} in · ${fmtNum(a.outputTokens)} out`} />
        <Kpi label="Cost (est.)" value={fmtCost(a.cost)} accent="var(--green, #4ade80)"
          sub={a.cost === 0 ? 'no usage reported' : `@ ${a.model}`} />
        <Kpi label="Duration" value={fmtDuration(a.durationMs)} accent="var(--amber, #fbbf24)"
          sub={a.startTs && a.endTs ? new Date(a.startTs).toLocaleString() : '—'} />
      </KpiRow>

      <KpiRow>
        <Kpi label="Tool uses" value={String(a.toolUses)} accent="var(--pink, #f472b6)"
          sub={`${a.toolErrors} errors (${(a.errorRate * 100).toFixed(1)}%) · ${a.tools.length} distinct`} />
        <Kpi label="Cache hit rate" value={`${(a.cacheHitRate * 100).toFixed(1)}%`} accent="var(--cyan, #5eead4)"
          sub={`${fmtNum(a.cacheReadTokens)} read · ${fmtNum(a.cacheWriteTokens)} write`} />
        <Kpi label="Turns" value={String(a.turns)} accent="var(--violet)"
          sub={a.turns > 0 ? `${fmtCost(a.costPerTurn)}/turn · ${fmtNum(a.totalTokens / a.turns)} tok/turn` : '—'} />
        <Kpi label="Response latency"
          value={a.medianFirstResponseMs !== null ? fmtDuration(a.medianFirstResponseMs) : '—'}
          accent="var(--green, #4ade80)"
          sub={a.avgFirstResponseMs !== null ? `avg ${fmtDuration(a.avgFirstResponseMs)}` : 'no paired turns'} />
      </KpiRow>

      <KpiRow>
        <Kpi label="Thinking" value={String(a.thinkingBlocks)} accent="var(--amber, #fbbf24)"
          sub={`${fmtNum(a.thinkingChars)} chars in reasoning`} />
        <Kpi label="Text volume" value={fmtNum(a.assistantTextChars)} accent="var(--pink, #f472b6)"
          sub={`assistant · ${fmtNum(a.userTextChars)} user`} />
        <Kpi label="Active time"
          value={fmtDuration(a.activeMs > 0 ? a.activeMs : null)}
          accent="var(--green, #4ade80)"
          sub={a.idleMs > 0 ? `idle ${fmtDuration(a.idleMs)} · gap ${fmtDuration(a.longestIdleMs)}` : 'no idle > 2m'} />
        <Kpi label="Avg output / reply"
          value={fmtNum(a.avgOutputPerAssistant)}
          accent="var(--violet)"
          sub={a.assistantMessages > 0 ? `${a.assistantMessages} replies · max ${fmtNum(a.maxOutputInReply)}` : '—'} />
      </KpiRow>

      <KpiRow>
        <Kpi label="Cache savings" value={fmtCost(a.cacheSavings)} accent="var(--green, #4ade80)"
          sub={a.cacheReadTokens > 0 ? `${fmtNum(a.cacheReadTokens)} tok read at cache rate` : 'no cache hits'} />
        <Kpi label="Agent depth"
          value={a.toolsPerTurn > 0 ? a.toolsPerTurn.toFixed(1) : '0'}
          accent="var(--pink, #f472b6)"
          sub={`tools/turn · avg chain ${a.avgAssistantChain.toFixed(1)} · max ${a.longestAssistantChain}`} />
        <Kpi label="Throughput"
          value={a.tokensPerSecond > 0 ? `${fmtNum(a.tokensPerSecond)} tok/s` : '—'}
          accent="var(--cyan, #5eead4)"
          sub={a.peakTokensPerMin > 0 ? `peak ${fmtNum(a.peakTokensPerMin)} tok/min` : 'output / active sec'} />
        <Kpi label="Slash / stdout"
          value={`${a.slashCommands} / ${fmtNum(a.shellOutputLines)}`}
          accent="var(--amber, #fbbf24)"
          sub="slash commands · shell stdout" />
      </KpiRow>

      <KpiRow>
        <Kpi label="Tokens / tool use"
          value={a.tokensPerToolUse > 0 ? fmtNum(a.tokensPerToolUse) : '—'}
          accent="var(--violet)"
          sub={`${a.toolUses} tool uses · output only`} />
        <Kpi label="Cost / file touched"
          value={a.costPerFileTouched > 0 ? fmtCost(a.costPerFileTouched) : '—'}
          accent="var(--green, #4ade80)"
          sub={`${a.ops.filesTouched.size} files`} />
        <Kpi label="Cost / line changed"
          value={a.costPerLineChanged > 0 ? fmtCost(a.costPerLineChanged) : '—'}
          accent="var(--amber, #fbbf24)"
          sub={`${(a.ops.linesAdded + a.ops.linesRemoved).toLocaleString()} lines`} />
        <Kpi label="Msg size (median)"
          value={fmtNum(median(a.messageSizes) ?? 0)}
          accent="var(--cyan, #5eead4)"
          sub={`p95 ${fmtNum(percentile(a.messageSizes, 0.95) ?? 0)} tok`} />
      </KpiRow>

      <div style={{ marginTop: 12 }}>
        <SectionLabel>Token composition</SectionLabel>
        <CompositionBar segments={[
          { label: 'input',       value: a.inputTokens,      color: 'var(--cyan, #5eead4)' },
          { label: 'output',      value: a.outputTokens,     color: 'var(--violet)' },
          { label: 'cache read',  value: a.cacheReadTokens,  color: 'var(--green, #4ade80)' },
          { label: 'cache write', value: a.cacheWriteTokens, color: 'var(--amber, #fbbf24)' },
        ]} />
      </div>

      {a.cost > 0 && (
        <div style={{ marginTop: 12 }}>
          <SectionLabel>Cost composition</SectionLabel>
          <CompositionBar segments={[
            { label: `input ${fmtCost(a.costByCategory.input)}`,        value: a.costByCategory.input,      color: 'var(--cyan, #5eead4)' },
            { label: `output ${fmtCost(a.costByCategory.output)}`,      value: a.costByCategory.output,     color: 'var(--violet)' },
            { label: `cache-read ${fmtCost(a.costByCategory.cacheRead)}`,  value: a.costByCategory.cacheRead,  color: 'var(--green, #4ade80)' },
            { label: `cache-write ${fmtCost(a.costByCategory.cacheWrite)}`,value: a.costByCategory.cacheWrite, color: 'var(--amber, #fbbf24)' },
          ]} />
        </div>
      )}

      {rateInPerMin !== null && (
        <div style={{ marginTop: 12 }}>
          <SectionLabel>Throughput</SectionLabel>
          <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>
            <div>input  {fmtNum(rateInPerMin)} tok/min</div>
            <div>output {fmtNum(rateOutPerMin ?? 0)} tok/min</div>
          </div>
        </div>
      )}

      {a.models.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <SectionLabel>By model</SectionLabel>
          <div style={{ fontSize: 12 }}>
            {a.models.slice(0, 6).map((m) => (
              <div key={m.model} style={{ display: 'flex', gap: 12, padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ flex: '0 0 260px', color: 'var(--text)' }}>{m.model}</span>
                <span style={{ flex: '0 0 90px', color: 'var(--green, #4ade80)' }}>{fmtCost(m.cost)}</span>
                <span style={{ flex: '0 0 120px', color: 'var(--violet)' }}>
                  {fmtNum(m.inputTokens + m.outputTokens)} tok
                </span>
                <span style={{ color: 'var(--text-3)' }}>{m.messages} msgs</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tokens pane
// ---------------------------------------------------------------------------

function TokensPane({ a }: { a: Analytics }) {
  const outputSeries = a.timeline.map((p) => p.outputTokens)
  const inputSeries  = a.timeline.map((p) => p.inputTokens)
  const cacheSeries  = a.timeline.map((p) => p.cacheReadTokens)
  let sum = 0
  const cumulative = a.timeline.map((p) => (sum += p.outputTokens))
  const maxOut = Math.max(1, ...outputSeries)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <SectionLabel>Output tokens per message</SectionLabel>
        <Sparkline values={outputSeries} height={100} colors={['var(--cyan, #5eead4)', 'var(--violet)', 'var(--pink, #f472b6)']} />
      </div>
      <div>
        <SectionLabel>Input tokens per message</SectionLabel>
        <Sparkline values={inputSeries} height={100} colors={['var(--green, #4ade80)', 'var(--cyan, #5eead4)']} />
      </div>
      <div>
        <SectionLabel>Cumulative output tokens</SectionLabel>
        <Sparkline values={cumulative} height={60} colors={['var(--amber, #fbbf24)']} />
      </div>
      <div>
        <SectionLabel>Cache read tokens per message</SectionLabel>
        <Sparkline values={cacheSeries} height={60} colors={['var(--green, #4ade80)']} />
      </div>

      {a.cost > 0 && (
        <div>
          <SectionLabel>Cumulative cost ({fmtCost(a.cost)} total)</SectionLabel>
          <Sparkline values={a.cumulativeCost} height={60} colors={['var(--green, #4ade80)', 'var(--amber, #fbbf24)']} />
        </div>
      )}

      <div>
        <SectionLabel>Message size distribution (tokens)</SectionLabel>
        <SizeHistogram values={a.messageSizes} />
      </div>

      <div>
        <SectionLabel>Top token-producing turns</SectionLabel>
        <div>
          {[...a.timeline]
            .sort((x, y) => y.outputTokens - x.outputTokens)
            .slice(0, 10)
            .map((p) => (
              <HBar
                key={p.index}
                label={`#${p.index + 1}${p.ts ? '  ' + new Date(p.ts).toLocaleTimeString() : ''}`}
                count={p.outputTokens}
                max={maxOut}
                color="var(--violet)"
              />
            ))}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tools pane
// ---------------------------------------------------------------------------

function ToolsPane({ a }: { a: Analytics }) {
  if (a.tools.length === 0) {
    return <div style={{ color: 'var(--text-3)' }}>(no tool calls in this session)</div>
  }
  const max = a.tools[0]!.count

  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 10 }}>
        {a.toolUses} total tool calls · {a.toolErrors} errors · {a.tools.length} distinct
      </div>
      {a.tools.map((t) => {
        const color = t.errors > 0 ? 'var(--amber, #fbbf24)' : 'var(--cyan, #5eead4)'
        return (
          <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '3px 0', fontSize: 12 }}>
            <span style={{ width: 180, color: 'var(--text)' }}>{t.name}</span>
            <span style={{ width: 60, color: 'var(--violet)', textAlign: 'right' }}>{t.count}</span>
            <span style={{ flex: 1, height: 10, background: 'var(--surface-2)', borderRadius: 2, overflow: 'hidden' }}>
              <span style={{ display: 'block', width: `${(t.count / max) * 100}%`, height: '100%', background: color }} />
            </span>
            {t.errors > 0 && (
              <span style={{ width: 80, color: 'var(--red, #f87171)', fontSize: 11 }}>{t.errors} err</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Activity pane
// ---------------------------------------------------------------------------

function ActivityPane({ a }: { a: Analytics }) {
  const ops: FileOps = a.ops
  const rows = [
    { label: 'File reads',    count: ops.reads,        color: 'var(--cyan, #5eead4)' },
    { label: 'Edits',         count: ops.edits,        color: 'var(--violet)' },
    { label: 'MultiEdits',    count: ops.multiEdits,   color: 'var(--violet)' },
    { label: 'Writes',        count: ops.writes,       color: 'var(--amber, #fbbf24)' },
    { label: 'Bash commands', count: ops.bashCommands, color: 'var(--green, #4ade80)' },
    { label: 'Searches',      count: ops.searches,     color: 'var(--pink, #f472b6)' },
    { label: 'Web calls',     count: ops.webFetches,   color: 'var(--cyan, #5eead4)' },
  ]
  const max = Math.max(1, ...rows.map((r) => r.count))
  const netLines = ops.linesAdded - ops.linesRemoved

  const latencies = a.timeline
    .map((p) => p.latencyMs)
    .filter((v): v is number => typeof v === 'number' && v >= 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <SectionLabel>Code &amp; file activity</SectionLabel>

      <KpiRow>
        <Kpi label="Lines added"
          value={`+${ops.linesAdded.toLocaleString()}`}
          accent="var(--green, #4ade80)"
          sub={`${ops.edits + ops.multiEdits} edits · ${ops.writes} writes`} />
        <Kpi label="Lines removed"
          value={`-${ops.linesRemoved.toLocaleString()}`}
          accent="var(--red, #f87171)"
          sub={`net ${netLines >= 0 ? '+' : ''}${netLines.toLocaleString()}`} />
        <Kpi label="Files touched"
          value={String(ops.filesTouched.size)}
          accent="var(--pink, #f472b6)"
          sub={`${ops.reads} reads · ${ops.edits + ops.multiEdits + ops.writes} writes`} />
        <Kpi label="Shell commands"
          value={String(ops.bashCommands)}
          accent="var(--amber, #fbbf24)"
          sub={`${ops.searches} searches · ${ops.webFetches} web`} />
      </KpiRow>

      <div>
        <SectionLabel>Operations breakdown</SectionLabel>
        {rows.map((r) => (
          <HBar key={r.label} label={r.label} count={r.count} max={max} color={r.color} />
        ))}
      </div>

      {(ops.linesAdded + ops.linesRemoved) > 0 && (
        <div>
          <SectionLabel>Added vs removed</SectionLabel>
          <CompositionBar segments={[
            { label: 'added',   value: ops.linesAdded,   color: 'var(--green, #4ade80)' },
            { label: 'removed', value: ops.linesRemoved, color: 'var(--red, #f87171)' },
          ]} />
        </div>
      )}

      {ops.editsByFile.size > 0 && (
        <div>
          <SectionLabel>Most-edited files</SectionLabel>
          <RankedBars entries={[...ops.editsByFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)} color="var(--violet)" />
        </div>
      )}

      {ops.readsByFile.size > 0 && (
        <div>
          <SectionLabel>Most-read files</SectionLabel>
          <RankedBars entries={[...ops.readsByFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)} color="var(--cyan, #5eead4)" />
        </div>
      )}

      {ops.bashByVerb.size > 0 && (
        <div>
          <SectionLabel>Top shell commands</SectionLabel>
          <RankedBars entries={[...ops.bashByVerb.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)} color="var(--amber, #fbbf24)" />
        </div>
      )}

      {a.fileExtensions.length > 0 && (
        <div>
          <SectionLabel>File extensions touched</SectionLabel>
          <RankedBars entries={a.fileExtensions.slice(0, 12)} color="var(--pink, #f472b6)" />
        </div>
      )}

      <div>
        <SectionLabel>Block types</SectionLabel>
        <CompositionBar segments={[
          { label: `text (${a.blockTypes.text})`,              value: a.blockTypes.text,       color: 'var(--cyan, #5eead4)' },
          { label: `thinking (${a.blockTypes.thinking})`,      value: a.blockTypes.thinking,   color: 'var(--amber, #fbbf24)' },
          { label: `tool use (${a.blockTypes.toolUse})`,       value: a.blockTypes.toolUse,    color: 'var(--violet)' },
          { label: `tool result (${a.blockTypes.toolResult})`, value: a.blockTypes.toolResult, color: 'var(--green, #4ade80)' },
          { label: `other (${a.blockTypes.other})`,            value: a.blockTypes.other,      color: 'var(--text-3)' },
        ]} />
      </div>

      {latencies.length > 0 && (
        <div>
          <SectionLabel>Response latency distribution ({latencies.length} paired turns)</SectionLabel>
          <LatencyHistogram latencies={latencies} />
        </div>
      )}
    </div>
  )
}

function RankedBars({ entries, color }: { entries: [string, number][]; color: string }) {
  if (entries.length === 0) return null
  const max = Math.max(1, ...entries.map(([, v]) => v))
  return (
    <div>
      {entries.map(([key, count]) => {
        const trimmed = key.length > 50 ? '…' + key.slice(-49) : key
        return <HBar key={key} label={trimmed} count={count} max={max} color={color} width={320} />
      })}
    </div>
  )
}

function SizeHistogram({ values }: { values: number[] }) {
  if (values.length === 0) return <div style={{ color: 'var(--text-3)', fontSize: 11 }}>(no data)</div>
  const buckets = [
    { label: '<100',     max: 100,      count: 0 },
    { label: '100-500',  max: 500,      count: 0 },
    { label: '500-2k',   max: 2_000,    count: 0 },
    { label: '2k-10k',   max: 10_000,   count: 0 },
    { label: '10k-50k',  max: 50_000,   count: 0 },
    { label: '50k-200k', max: 200_000,  count: 0 },
    { label: '>200k',    max: Infinity, count: 0 },
  ]
  for (const v of values) {
    for (const b of buckets) {
      if (v < b.max) { b.count += 1; break }
    }
  }
  const max = Math.max(1, ...buckets.map((b) => b.count))
  return (
    <div>
      {buckets.map((b) => (
        <HBar key={b.label} label={b.label} count={b.count} max={max} color="var(--violet)" width={80} />
      ))}
    </div>
  )
}

function LatencyHistogram({ latencies }: { latencies: number[] }) {
  const buckets = [
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
  return (
    <div>
      {buckets.map((b) => (
        <HBar key={b.label} label={b.label} count={b.count} max={max} color="var(--cyan, #5eead4)" width={80} />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Timeline pane
// ---------------------------------------------------------------------------

function TimelinePane({ a }: { a: Analytics }) {
  if (a.timeline.length === 0 || a.startTs === null || a.endTs === null) {
    return <div style={{ color: 'var(--text-3)' }}>(no timestamped messages)</div>
  }
  const span = Math.max(1, a.endTs - a.startTs)
  const buckets = 60
  const bucketSize = span / buckets
  const msgCounts = new Array(buckets).fill(0)
  const outTokens = new Array(buckets).fill(0)
  for (const p of a.timeline) {
    if (p.ts === null) continue
    const idx = Math.min(buckets - 1, Math.floor((p.ts - a.startTs) / bucketSize))
    msgCounts[idx] += 1
    outTokens[idx] += p.outputTokens
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
        {new Date(a.startTs).toLocaleString()} → {new Date(a.endTs).toLocaleString()}
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-3)' }}>
        {buckets} buckets · ~{fmtDuration(bucketSize)} per bucket
      </div>

      <div>
        <SectionLabel>Messages per bucket</SectionLabel>
        <Sparkline values={msgCounts} height={80} colors={['var(--cyan, #5eead4)', 'var(--violet)']} />
      </div>

      <div>
        <SectionLabel>Output tokens per bucket</SectionLabel>
        <Sparkline values={outTokens} height={80} colors={['var(--green, #4ade80)', 'var(--amber, #fbbf24)', 'var(--pink, #f472b6)']} />
      </div>

      <div>
        <SectionLabel>Role distribution over time</SectionLabel>
        <RoleStrip timeline={a.timeline} />
      </div>

      <div>
        <SectionLabel>Activity by hour of day (local)</SectionLabel>
        <HourHeatmap counts={a.hourActivity} />
      </div>

      <div>
        <SectionLabel>Activity by day of week (local)</SectionLabel>
        <DayOfWeekBar counts={a.dayOfWeekActivity} />
      </div>
    </div>
  )
}

function DayOfWeekBar({ counts }: { counts: number[] }) {
  const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const max = Math.max(1, ...counts)
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
        {counts.map((c, d) => {
          const pct = (c / max) * 100
          return (
            <div key={d} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <div style={{ width: '100%', height: 60, background: 'var(--surface-2)', borderRadius: 3, position: 'relative' }}>
                <div style={{
                  position: 'absolute',
                  bottom: 0,
                  width: '100%',
                  height: `${pct}%`,
                  background: c === 0 ? 'var(--surface-2)' : 'var(--violet)',
                  borderRadius: 3,
                }} />
              </div>
              <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{labels[d]}</span>
              <span style={{ fontSize: 10, color: 'var(--text-2)' }}>{c}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function RoleStrip({ timeline }: { timeline: TimelinePoint[] }) {
  return (
    <div style={{ display: 'flex', height: 18, gap: 1, background: 'var(--surface-2)', borderRadius: 3, padding: 2 }}>
      {timeline.map((p, i) => {
        const color = p.role === 'assistant' ? 'var(--violet)' : p.role === 'user' ? 'var(--cyan, #5eead4)' : 'var(--text-3)'
        return <span key={i} style={{ flex: '1 1 0', minWidth: 1, background: color, borderRadius: 1 }} />
      })}
    </div>
  )
}

function HourHeatmap({ counts }: { counts: number[] }) {
  const max = Math.max(1, ...counts)
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(24, 1fr)', gap: 3 }}>
        {counts.map((c, h) => {
          const intensity = c / max
          const color = intensity === 0
            ? 'var(--surface-2)'
            : intensity > 0.66 ? 'var(--amber, #fbbf24)'
            : intensity > 0.33 ? 'var(--violet)'
            : 'var(--cyan, #5eead4)'
          const alpha = intensity === 0 ? 1 : Math.max(0.35, intensity)
          return (
            <div
              key={h}
              title={`${String(h).padStart(2, '0')}:00  ·  ${c} msgs`}
              style={{ height: 32, background: color, opacity: alpha, borderRadius: 3 }}
            />
          )
        })}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(24, 1fr)', gap: 3, marginTop: 3, fontSize: 9, color: 'var(--text-3)', textAlign: 'center' }}>
        {counts.map((_, h) => (
          <span key={h}>{h % 6 === 0 ? String(h).padStart(2, '0') : ''}</span>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Insights pane
// ---------------------------------------------------------------------------

type InsightSeverity = 'good' | 'warn' | 'info' | 'tip'
type Insight = { severity: InsightSeverity; icon: string; title: string; detail: string }

const SEVERITY_COLORS: Record<InsightSeverity, { fg: string; bg: string; border: string }> = {
  good: { fg: 'var(--green, #4ade80)',  bg: 'rgba(74,222,128,0.08)',  border: 'rgba(74,222,128,0.30)' },
  warn: { fg: 'var(--amber, #fbbf24)',  bg: 'rgba(251,191,36,0.08)',  border: 'rgba(251,191,36,0.30)' },
  info: { fg: 'var(--cyan, #5eead4)',   bg: 'rgba(94,234,212,0.08)',  border: 'rgba(94,234,212,0.28)' },
  tip:  { fg: 'var(--violet)',          bg: 'rgba(139,128,240,0.08)', border: 'rgba(139,128,240,0.30)' },
}

function buildInsights(a: Analytics): Insight[] {
  const out: Insight[] = []

  // Session character
  const ops = a.ops
  const editTotal = ops.edits + ops.multiEdits + ops.writes
  const totalOps = ops.reads + editTotal + ops.bashCommands + ops.searches
  if (totalOps > 0) {
    const readShare = ops.reads / totalOps
    const editShare = editTotal / totalOps
    if (readShare > 0.6 && editTotal < 3) {
      out.push({ severity: 'info', icon: '🔍', title: 'Exploration session',
        detail: `${ops.reads} reads vs only ${editTotal} edits — mostly investigating rather than modifying.` })
    } else if (editShare > 0.5) {
      out.push({ severity: 'info', icon: '✏️', title: 'Code-modification session',
        detail: `${editTotal} edits/writes across ${ops.filesTouched.size} files · +${ops.linesAdded.toLocaleString()}/-${ops.linesRemoved.toLocaleString()} lines.` })
    } else if (ops.bashCommands > Math.max(ops.reads, editTotal)) {
      out.push({ severity: 'info', icon: '⌨', title: 'Shell-heavy session',
        detail: `${ops.bashCommands} shell commands dominate — infrastructure or ops work.` })
    }
  }

  // Cache efficiency
  if (a.inputTokens + a.cacheReadTokens > 10_000) {
    if (a.cacheHitRate > 0.6) {
      out.push({ severity: 'good', icon: '⚡', title: 'Strong cache utilization',
        detail: `${(a.cacheHitRate * 100).toFixed(0)}% of input served from cache — saved approximately ${fmtCost(a.cacheSavings)}.` })
    } else if (a.cacheHitRate < 0.15 && a.inputTokens > 50_000) {
      out.push({ severity: 'warn', icon: '💸', title: 'Low cache hit rate',
        detail: `Only ${(a.cacheHitRate * 100).toFixed(1)}% of ${fmtNum(a.inputTokens)} input tokens hit cache. Reusing context could reduce cost.` })
    }
  }

  // Error rate
  if (a.toolUses > 5) {
    if (a.errorRate > 0.15) {
      out.push({ severity: 'warn', icon: '⚠', title: 'Elevated tool error rate',
        detail: `${a.toolErrors} of ${a.toolUses} tool calls errored (${(a.errorRate * 100).toFixed(1)}%).` })
    } else if (a.errorRate === 0) {
      out.push({ severity: 'good', icon: '✓', title: 'No tool errors',
        detail: `All ${a.toolUses} tool calls succeeded.` })
    }
  }

  // Top tool
  if (a.tools.length > 0) {
    const top = a.tools[0]!
    const share = top.count / Math.max(1, a.toolUses)
    if (share > 0.5) {
      out.push({ severity: 'info', icon: '🔧', title: `${top.name} dominates`,
        detail: `${top.count} of ${a.toolUses} tool calls (${(share * 100).toFixed(0)}%) used ${top.name}.` })
    }
  }

  // Latency
  if (a.medianFirstResponseMs !== null && a.medianFirstResponseMs > 30_000) {
    out.push({ severity: 'warn', icon: '🐢', title: 'Slow response latency',
      detail: `Median time to first reply: ${fmtDuration(a.medianFirstResponseMs)}. The agent is spending a lot of time per turn.` })
  } else if (a.medianFirstResponseMs !== null && a.medianFirstResponseMs < 3_000) {
    out.push({ severity: 'good', icon: '🚀', title: 'Snappy responses',
      detail: `Median first-response latency: ${fmtDuration(a.medianFirstResponseMs)}.` })
  }

  // Idle time
  if (a.longestIdleMs > 30 * 60_000) {
    out.push({ severity: 'info', icon: '⏸', title: 'Session spans a long idle gap',
      detail: `Longest quiet period was ${fmtDuration(a.longestIdleMs)} — session was paused between turns.` })
  }

  // Cost
  if (a.cost > 5) {
    out.push({ severity: 'warn', icon: '💰', title: 'High session cost',
      detail: `Estimated ${fmtCost(a.cost)} · ${fmtCost(a.costPerTurn)}/turn across ${a.turns} turns.` })
  } else if (a.cost > 0 && a.cost < 0.05 && a.messages > 10) {
    out.push({ severity: 'good', icon: '💵', title: 'Very low cost',
      detail: `${a.messages} messages for only ${fmtCost(a.cost)} — cache kept this cheap.` })
  }

  // Thinking share
  if (a.thinkingBlocks > 0 && a.assistantTextChars > 0) {
    const thinkShare = a.thinkingChars / (a.thinkingChars + a.assistantTextChars)
    if (thinkShare > 0.5) {
      out.push({ severity: 'info', icon: '🧠', title: 'Heavy reasoning',
        detail: `${(thinkShare * 100).toFixed(0)}% of assistant output was extended thinking — ${a.thinkingBlocks} blocks, ${fmtNum(a.thinkingChars)} chars.` })
    }
  }

  // Agent depth
  if (a.toolsPerTurn > 8) {
    out.push({ severity: 'info', icon: '🪜', title: 'Deep agent loops',
      detail: `${a.toolsPerTurn.toFixed(1)} tool calls per user turn · longest chain of ${a.longestAssistantChain} assistant messages.` })
  }

  // Largest reply
  if (a.maxOutputInReply > 8_000) {
    out.push({ severity: 'tip', icon: '📏', title: 'Very long assistant reply',
      detail: `One reply generated ${fmtNum(a.maxOutputInReply)} output tokens. Consider breaking such requests into smaller steps.` })
  }

  // Peak throughput
  if (a.peakTokensPerMin > 20_000) {
    out.push({ severity: 'info', icon: '📈', title: 'Bursty output',
      detail: `Peak throughput reached ${fmtNum(a.peakTokensPerMin)} output tokens/minute.` })
  }

  // Most-edited file
  if (ops.editsByFile.size > 0) {
    const topFile = [...ops.editsByFile.entries()].sort((a, b) => b[1] - a[1])[0]!
    if (topFile[1] >= 5) {
      const base = topFile[0].split('/').pop() ?? topFile[0]
      out.push({ severity: 'tip', icon: '📝', title: 'Hot-spot file',
        detail: `${base} was edited ${topFile[1]} times — likely the centerpiece of this session.` })
    }
  }

  // Shell patterns
  if (ops.bashByVerb.size > 0) {
    const topVerb = [...ops.bashByVerb.entries()].sort((a, b) => b[1] - a[1])[0]!
    if (topVerb[1] >= 5) {
      out.push({ severity: 'info', icon: '⌨', title: `${topVerb[0]} used ${topVerb[1]}×`,
        detail: `The most-run shell command verb in this session.` })
    }
  }

  // Hour peak
  if (a.messages > 0) {
    const maxCount = Math.max(...a.hourActivity)
    if (maxCount > 0) {
      const peakHour = a.hourActivity.indexOf(maxCount)
      const share = maxCount / a.messages
      if (share > 0.35) {
        out.push({ severity: 'info', icon: '🕒', title: `Peak activity around ${peakHour}:00`,
          detail: `${maxCount} of ${a.messages} messages (${(share * 100).toFixed(0)}%) landed in that single hour.` })
      }
    }
  }

  // Slash commands
  if (a.slashCommands >= 3) {
    out.push({ severity: 'info', icon: '/', title: `${a.slashCommands} slash commands`,
      detail: `Session made heavy use of slash commands — you may want to review what was invoked.` })
  }

  // Thinking with no tools
  if (a.toolUses === 0 && a.messages > 6) {
    out.push({ severity: 'info', icon: '💬', title: 'Conversation-only session',
      detail: `No tool calls across ${a.messages} messages — pure Q&A or planning.` })
  }

  // Cost per line
  if (a.costPerLineChanged > 0 && (ops.linesAdded + ops.linesRemoved) > 100) {
    out.push({ severity: 'tip', icon: '📊', title: 'Cost per line changed',
      detail: `${fmtCost(a.costPerLineChanged)} per line touched across ${(ops.linesAdded + ops.linesRemoved).toLocaleString()} lines.` })
  }

  // Fallback: no signal
  if (out.length === 0) {
    out.push({ severity: 'info', icon: 'ℹ', title: 'Not much to highlight yet',
      detail: 'This session is short or light on signals. Insights will sharpen as more activity accumulates.' })
  }

  return out
}

function InsightsPane({ a }: { a: Analytics }) {
  const insights = useMemo(() => buildInsights(a), [a])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>
        {insights.length} observation{insights.length === 1 ? '' : 's'} from this session
      </div>
      {insights.map((ins, i) => {
        const c = SEVERITY_COLORS[ins.severity]
        return (
          <div
            key={i}
            style={{
              display: 'flex',
              gap: 12,
              padding: '10px 12px',
              background: c.bg,
              border: `1px solid ${c.border}`,
              borderRadius: 6,
            }}
          >
            <span style={{ fontSize: 18, lineHeight: '22px', flexShrink: 0, width: 24, textAlign: 'center' }}>
              {ins.icon}
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
              <span style={{ fontSize: 12, color: c.fg, fontWeight: 500, letterSpacing: '0.04em' }}>
                {ins.title}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>
                {ins.detail}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Profile pane
// ---------------------------------------------------------------------------

function ProfilePane({ a }: { a: Analytics }) {
  const extEntries = a.fileExtensions.slice(0, 12)
  const totalExts = extEntries.reduce((sum, [, count]) => sum + count, 0)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <KpiRow>
        <Kpi
          label="Tokens / tool"
          value={a.tokensPerToolUse > 0 ? fmtNum(a.tokensPerToolUse) : '—'}
          accent="var(--violet)"
          sub={`${a.toolUses} tool uses · output only`}
        />
        <Kpi
          label="Avg chain"
          value={a.avgAssistantChain > 0 ? a.avgAssistantChain.toFixed(1) : '0'}
          accent="var(--pink, #f472b6)"
          sub={`max ${a.longestAssistantChain} assistant replies`}
        />
        <Kpi
          label="Files touched"
          value={fmtNum(a.ops.filesTouched.size)}
          accent="var(--cyan, #5eead4)"
          sub={a.costPerFileTouched > 0 ? `${fmtCost(a.costPerFileTouched)}/file` : 'no files'}
        />
        <Kpi
          label="Lines changed"
          value={fmtNum(a.ops.linesAdded + a.ops.linesRemoved)}
          accent="var(--amber, #fbbf24)"
          sub={a.costPerLineChanged > 0 ? `${fmtCost(a.costPerLineChanged)}/line` : 'no diff'}
        />
      </KpiRow>

      <div>
        <SectionLabel>Activity by day of week</SectionLabel>
        <DayOfWeekBar counts={a.dayOfWeekActivity} />
      </div>

      <div>
        <SectionLabel>File extensions touched</SectionLabel>
        {extEntries.length > 0 ? (
          <div>
            <RankedBars entries={extEntries} color="var(--pink, #f472b6)" />
            <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>
              {totalExts} file touches across {extEntries.length} extension{extEntries.length === 1 ? '' : 's'}
            </div>
          </div>
        ) : (
          <div style={{ color: 'var(--text-3)', fontSize: 11 }}>(no file extensions recorded)</div>
        )}
      </div>

      <div>
        <SectionLabel>Block types</SectionLabel>
        <CompositionBar segments={[
          { label: `text (${a.blockTypes.text})`,              value: a.blockTypes.text,       color: 'var(--cyan, #5eead4)' },
          { label: `thinking (${a.blockTypes.thinking})`,      value: a.blockTypes.thinking,   color: 'var(--amber, #fbbf24)' },
          { label: `tool use (${a.blockTypes.toolUse})`,       value: a.blockTypes.toolUse,    color: 'var(--violet)' },
          { label: `tool result (${a.blockTypes.toolResult})`, value: a.blockTypes.toolResult, color: 'var(--green, #4ade80)' },
          { label: `other (${a.blockTypes.other})`,            value: a.blockTypes.other,      color: 'var(--text-3)' },
        ]} />
      </div>

      <div>
        <SectionLabel>Message size distribution</SectionLabel>
        <SizeHistogram values={a.messageSizes} />
      </div>
    </div>
  )
}
