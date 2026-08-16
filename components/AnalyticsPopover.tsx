'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { AreaChart, Area, Line, ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, ReferenceLine, Cell, LabelList, Legend, Brush } from 'recharts'
import type { Analytics, AnalyticsInput, FileOps, TimelinePoint } from '@/lib/analytics'
import { computeAnalytics, fmtCost, fmtDuration, fmtNum } from '@/lib/analytics'
import { type Insight, type InsightSeverity, buildInsights, median, percentile, sortInsights, summarizeActivity, summarizeCache, summarizePace, summarizeRisk } from '@/lib/analyticsInsights'
import { type HealthGrade, type HealthReport, archetypeLabel, computeHealthReport, penaltyLabel } from '@/lib/healthScore'
import type { CoachInsight } from '@/lib/coachInsights'
import { readJsonResponse } from '@/lib/httpResponse'

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
const DATE_TIME_FORMAT = new Intl.DateTimeFormat('en-AU', {
  dateStyle: 'medium',
  timeStyle: 'medium',
  timeZone: 'UTC',
})
const TIME_FORMAT = new Intl.DateTimeFormat('en-AU', {
  timeStyle: 'medium',
  timeZone: 'UTC',
})
const SIZE_HISTOGRAM_BUCKETS = [
  { label: '<100', max: 100 },
  { label: '100-500', max: 500 },
  { label: '500-2k', max: 2_000 },
  { label: '2k-10k', max: 10_000 },
  { label: '10k-50k', max: 50_000 },
  { label: '50k-200k', max: 200_000 },
  { label: '>200k', max: Infinity },
]
const LATENCY_HISTOGRAM_BUCKETS = [
  { label: '<1s', max: 1_000 },
  { label: '1-3s', max: 3_000 },
  { label: '3-10s', max: 10_000 },
  { label: '10-30s', max: 30_000 },
  { label: '30s-1m', max: 60_000 },
  { label: '1-5m', max: 300_000 },
  { label: '>5m', max: Infinity },
]

type Props = {
  open: boolean
  onClose: () => void
  input: AnalyticsInput | null
}

export default function AnalyticsPopover({ open, onClose, input }: Props) {
  const [pane, setPane] = useState<PaneId>(0)
  const [hoveredPane, setHoveredPane] = useState<PaneId | null>(null)
  const analytics = useMemo(() => computeAnalytics(open ? input : null), [open, input])
  const health = useMemo(() => computeHealthReport(open ? input : null), [open, input])

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
              type="button"
              className="av-hover-control"
              onClick={() => setPane(p)}
              onMouseEnter={() => setHoveredPane(p)}
              onMouseLeave={() => setHoveredPane(null)}
              style={{
                padding: '5px 10px',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 11,
                letterSpacing: '0.08em',
                color: pane === p ? 'var(--surface)' : (hoveredPane === p ? 'var(--text)' : 'var(--text-2)'),
                background: pane === p ? 'var(--cyan, #5eead4)' : (hoveredPane === p ? 'var(--surface-3)' : 'transparent'),
                border: '1px solid ' + (pane === p ? 'transparent' : (hoveredPane === p ? 'var(--border-2)' : 'var(--border)')),
                borderRadius: 5,
                cursor: 'pointer',
                transition: 'background 0.1s, color 0.1s, border-color 0.1s',
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
            type="button"
            className="av-hover-control"
            onClick={onClose}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--surface-3)'
              e.currentTarget.style.color = 'var(--text)'
              e.currentTarget.style.borderColor = 'var(--border-2)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--text-2)'
              e.currentTarget.style.borderColor = 'var(--border)'
            }}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--text-2)',
              cursor: 'pointer',
              padding: '4px 10px',
              borderRadius: 5,
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              transition: 'background 0.1s, color 0.1s, border-color 0.1s',
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
          {pane === 0 && <SummaryPane a={analytics} health={health} />}
          {pane === 1 && <TokensPane a={analytics} />}
          {pane === 2 && <ToolsPane a={analytics} />}
          {pane === 3 && <ActivityPane a={analytics} />}
          {pane === 4 && <TimelinePane a={analytics} />}
          {pane === 5 && <InsightsPane a={analytics} input={input} />}
          {pane === 6 && <ProfilePane a={analytics} />}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------


const LABEL_STYLE: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--text-3)',
  marginBottom: 8,
}

function ChartTooltip({ active, payload, label, formatter }: {
  active?: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any[]
  label?: unknown
  formatter?: (v: number) => string
}) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border-2)', padding: '4px 8px', fontSize: 10, borderRadius: 3, color: 'var(--text-2)', fontFamily: "'IBM Plex Mono', monospace" }}>
      {label != null && String(label) !== '' && (
        <div style={{ color: 'var(--text-3)', marginBottom: 2, fontSize: 9 }}>{String(label)}</div>
      )}
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ color: p.color ?? p.fill ?? 'var(--text)' }}>
          {payload.length > 1 && <span style={{ color: 'var(--text-3)' }}>{p.name}: </span>}
          {formatter ? formatter(Number(p.value)) : Number(p.value).toLocaleString()}
        </div>
      ))}
    </div>
  )
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


function Sparkline({
  values, height, colors,
}: {
  values: number[]
  height: number
  colors: string[]
}) {
  const reactId = useId()
  if (values.length === 0) return <div style={{ color: 'var(--text-3)', fontSize: 11 }}>(no data)</div>
  const data = values.map((v, i) => ({ index: i, value: v }))
  const primaryColor = colors[0] ?? 'var(--cyan, #5eead4)'
  const gradientId = `gradient-${reactId.replace(/:/g, '_')}`
  const med = median(values)

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 2, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={primaryColor} stopOpacity={0.3}/>
            <stop offset="95%" stopColor={primaryColor} stopOpacity={0}/>
          </linearGradient>
        </defs>
        {med !== null && (
          <ReferenceLine y={med} stroke="var(--text-3)" strokeDasharray="3 3" strokeWidth={1} />
        )}
        <Area type="monotone" dataKey="value" stroke={primaryColor} fill={`url(#${gradientId})`} strokeWidth={1.5} dot={false} />
        <Tooltip content={(props) => <ChartTooltip {...(props as any)} />} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

// ---------------------------------------------------------------------------
// Summary pane
// ---------------------------------------------------------------------------

function gradeColor(grade: HealthGrade): string {
  switch (grade) {
    case 'A': return 'var(--green, #4ade80)'
    case 'B': return 'var(--cyan, #5eead4)'
    case 'C': return 'var(--amber, #fbbf24)'
    case 'D': return 'var(--orange, #fb923c)'
    case 'F': return 'var(--red, #f87171)'
    default:  return 'var(--text-3)'
  }
}

function HealthCard({ health }: { health: HealthReport }) {
  const color = gradeColor(health.grade)
  const penalties = Object.entries(health.penalties).sort((a, b) => b[1] - a[1])
  const scored = health.score !== null
  return (
    <div style={{
      display: 'flex', gap: 14, alignItems: 'stretch',
      padding: 12, marginBottom: 8,
      border: '1px solid var(--border-2)', borderRadius: 8, background: 'var(--surface-2)',
    }}>
      <div style={{
        flex: '0 0 96px', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 2,
        borderRight: '1px solid var(--border)', paddingRight: 12,
      }}>
        <div style={{ fontSize: 44, lineHeight: 1, fontWeight: 700, color, fontFamily: "'Oxanium', monospace" }}>
          {scored ? health.grade : '–'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
          {scored ? `${health.score}/100` : 'not scored'}
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Session health
          </span>
          <Chip label={archetypeLabel(health.archetype)} />
          <Chip label={`outcome: ${health.outcome.outcome}`} />
        </div>
        {!scored && (
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
            {health.outcome.isRecent ? 'Session still active — scored once it settles.' : 'Too little signal to grade this session.'}
          </div>
        )}
        {scored && penalties.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--green, #4ade80)' }}>No penalties — clean session.</div>
        )}
        {scored && penalties.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {penalties.map(([key, pts]) => (
              <div key={key} style={{ display: 'flex', gap: 8, fontSize: 12, color: 'var(--text-2)' }}>
                <span style={{ flex: '0 0 38px', color: 'var(--red, #f87171)', textAlign: 'right' }}>−{pts}</span>
                <span style={{ minWidth: 0 }}>{penaltyLabel(key)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Chip({ label }: { label: string }) {
  return (
    <span style={{
      fontSize: 10, padding: '2px 7px', borderRadius: 999,
      border: '1px solid var(--border-2)', background: 'var(--surface-3)',
      color: 'var(--text-2)', letterSpacing: '0.04em', whiteSpace: 'nowrap',
    }}>{label}</span>
  )
}

function SummaryPane({ a, health }: { a: Analytics; health: HealthReport }) {
  const rateInPerMin = a.durationMs && a.durationMs > 0 ? a.inputTokens / (a.durationMs / 60_000) : null
  const rateOutPerMin = a.durationMs && a.durationMs > 0 ? a.outputTokens / (a.durationMs / 60_000) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6 }}>
        Session totals · {a.provider ?? '—'} · {a.model}
      </div>

      <HealthCard health={health} />

      <KpiRow>
        <Kpi label="Messages" value={String(a.messages)} accent="var(--cyan, #5eead4)"
          sub={`${a.userMessages} user · ${a.assistantMessages} asst · ${a.systemMessages} sys`} />
        <Kpi label="Total tokens" value={fmtNum(a.totalTokens)} accent="var(--violet)"
          sub={`${fmtNum(a.inputTokens)} in · ${fmtNum(a.outputTokens)} out`} />
        <Kpi label="Cost (est.)" value={fmtCost(a.cost)} accent="var(--green, #4ade80)"
          sub={a.cost === 0 ? 'no usage reported' : `@ ${a.model}`} />
        <Kpi label="Duration" value={fmtDuration(a.durationMs)} accent="var(--amber, #fbbf24)"
          sub={a.startTs && a.endTs ? DATE_TIME_FORMAT.format(new Date(a.startTs)) : '—'} />
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
  const topTurnsData = a.timeline
    .toSorted((x, y) => y.outputTokens - x.outputTokens)
    .slice(0, 10)
    .map((p) => ({ label: p.ts ? TIME_FORMAT.format(new Date(p.ts)) : `#${p.index + 1}`, tokens: p.outputTokens }))

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
        <ResponsiveContainer width="100%" height={topTurnsData.length * 26 + 24}>
          <BarChart data={topTurnsData} layout="vertical" margin={{ top: 0, right: 56, left: 0, bottom: 0 }}>
            <XAxis type="number" tick={{ fontSize: 9, fill: 'var(--text-3)', fontFamily: "'IBM Plex Mono', monospace" }} axisLine={false} tickLine={false} tickFormatter={(v: number) => fmtNum(v)} />
            <YAxis type="category" dataKey="label" tick={{ fontSize: 10, fill: 'var(--text-2)', fontFamily: "'IBM Plex Mono', monospace" }} axisLine={false} tickLine={false} width={90} />
            <Tooltip content={(props) => <ChartTooltip {...(props as any)} formatter={fmtNum} />} />
            <Bar dataKey="tokens" name="tokens" fill="var(--violet)" radius={[0, 2, 2, 0]}>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <LabelList dataKey="tokens" position="right" style={{ fontSize: 10, fill: 'var(--text-2)', fontFamily: "'IBM Plex Mono', monospace" }} formatter={(v: any) => fmtNum(Number(v ?? 0))} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
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
  const data = a.tools.map((t) => ({ name: t.name, success: t.count - t.errors, errors: t.errors }))
  const height = data.length * 28 + 24

  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 10 }}>
        {a.toolUses} total tool calls · {a.toolErrors} errors · {a.tools.length} distinct
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 44, left: 0, bottom: 0 }}>
          <XAxis type="number" tick={{ fontSize: 9, fill: 'var(--text-3)', fontFamily: "'IBM Plex Mono', monospace" }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: 'var(--text-2)', fontFamily: "'IBM Plex Mono', monospace" }} axisLine={false} tickLine={false} width={160} />
          <Tooltip content={(props) => <ChartTooltip {...(props as any)} />} />
          <Bar dataKey="success" name="calls" stackId="a" fill="var(--cyan, #5eead4)" radius={[0, 0, 0, 0]}>
            <LabelList dataKey="success" position="right" style={{ fontSize: 10, fill: 'var(--text-2)', fontFamily: "'IBM Plex Mono', monospace" }} />
          </Bar>
          <Bar dataKey="errors" name="errors" stackId="a" fill="var(--amber, #fbbf24)" radius={[0, 2, 2, 0]} />
        </BarChart>
      </ResponsiveContainer>
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
        <ResponsiveContainer width="100%" height={120}>
          <BarChart data={rows} margin={{ top: 4, right: 4, left: -24, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'var(--text-3)', fontFamily: "'IBM Plex Mono', monospace" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 9, fill: 'var(--text-3)', fontFamily: "'IBM Plex Mono', monospace" }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip content={(props) => <ChartTooltip {...(props as any)} />} />
            <Bar dataKey="count" radius={[2, 2, 0, 0]}>
              {rows.map((r, i) => <Cell key={i} fill={r.color} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
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
  const data = entries.map(([key, count]) => ({
    label: key.length > 36 ? '…' + key.slice(-35) : key,
    count,
  }))
  const height = data.length * 26 + 24
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 44, left: 0, bottom: 0 }}>
        <XAxis type="number" tick={{ fontSize: 9, fill: 'var(--text-3)', fontFamily: "'IBM Plex Mono', monospace" }} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="label" tick={{ fontSize: 10, fill: 'var(--text-2)', fontFamily: "'IBM Plex Mono', monospace" }} axisLine={false} tickLine={false} width={220} />
        <Tooltip content={(props) => <ChartTooltip {...(props as any)} />} />
        <Bar dataKey="count" fill={color} radius={[0, 2, 2, 0]}>
          <LabelList dataKey="count" position="right" style={{ fontSize: 10, fill: 'var(--text-2)', fontFamily: "'IBM Plex Mono', monospace" }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

function SizeHistogram({ values }: { values: number[] }) {
  if (values.length === 0) return <div style={{ color: 'var(--text-3)', fontSize: 11 }}>(no data)</div>
  const buckets = SIZE_HISTOGRAM_BUCKETS.map((bucket) => ({ ...bucket, count: 0 }))
  for (const v of values) {
    for (const b of buckets) {
      if (v < b.max) { b.count += 1; break }
    }
  }
  return (
    <ResponsiveContainer width="100%" height={120}>
      <BarChart data={buckets} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'var(--text-3)', fontFamily: "'IBM Plex Mono', monospace" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 9, fill: 'var(--text-3)', fontFamily: "'IBM Plex Mono', monospace" }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip content={(props) => <ChartTooltip {...(props as any)} />} />
        <Bar dataKey="count" fill="var(--violet)" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function LatencyHistogram({ latencies }: { latencies: number[] }) {
  const buckets = LATENCY_HISTOGRAM_BUCKETS.map((bucket) => ({ ...bucket, count: 0 }))
  for (const l of latencies) {
    for (const b of buckets) {
      if (l < b.max) { b.count += 1; break }
    }
  }
  return (
    <ResponsiveContainer width="100%" height={120}>
      <BarChart data={buckets} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'var(--text-3)', fontFamily: "'IBM Plex Mono', monospace" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 9, fill: 'var(--text-3)', fontFamily: "'IBM Plex Mono', monospace" }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip content={(props) => <ChartTooltip {...(props as any)} />} />
        <Bar dataKey="count" fill="var(--cyan, #5eead4)" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
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
        {DATE_TIME_FORMAT.format(new Date(a.startTs))} → {DATE_TIME_FORMAT.format(new Date(a.endTs))}
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-3)' }}>
        {buckets} buckets · ~{fmtDuration(bucketSize)} per bucket
      </div>

      <div>
        <SectionLabel>Activity per time bucket</SectionLabel>
        <ResponsiveContainer width="100%" height={180}>
          <ComposedChart data={msgCounts.map((m, i) => ({ i, messages: m, tokens: outTokens[i] }))} margin={{ top: 4, right: 36, left: -24, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="i" tick={false} axisLine={false} tickLine={false} />
            <YAxis yAxisId="msg" orientation="left" tick={{ fontSize: 9, fill: 'var(--text-3)', fontFamily: "'IBM Plex Mono', monospace" }} axisLine={false} tickLine={false} allowDecimals={false} />
            <YAxis yAxisId="tok" orientation="right" tick={{ fontSize: 9, fill: 'var(--text-3)', fontFamily: "'IBM Plex Mono', monospace" }} axisLine={false} tickLine={false} tickFormatter={(v: number) => fmtNum(v)} />
            <Tooltip content={(props) => <ChartTooltip {...(props as any)} />} />
            <Legend wrapperStyle={{ fontSize: 10, fontFamily: "'IBM Plex Mono', monospace", paddingTop: 4 }} formatter={(value) => <span style={{ color: 'var(--text-2)' }}>{value}</span>} />
            <Brush dataKey="i" height={22} stroke="var(--border-2)" fill="var(--surface-2)" travellerWidth={6} />
            <Bar yAxisId="msg" dataKey="messages" name="msgs" fill="var(--cyan, #5eead4)" opacity={0.8} />
            <Line yAxisId="tok" dataKey="tokens" name="tokens" type="monotone" stroke="var(--amber, #fbbf24)" strokeWidth={1.5} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
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
  const data = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label, i) => ({ label, value: counts[i] ?? 0 }))
  return (
    <ResponsiveContainer width="100%" height={110}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--text-3)', fontFamily: "'IBM Plex Mono', monospace" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 9, fill: 'var(--text-3)', fontFamily: "'IBM Plex Mono', monospace" }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip content={(props) => <ChartTooltip {...(props as any)} />} />
        <Bar dataKey="value" fill="var(--violet)" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
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

const SEVERITY_COLORS: Record<InsightSeverity, { fg: string; bg: string; border: string }> = {
  good: { fg: 'var(--green, #4ade80)',  bg: 'rgba(74,222,128,0.08)',  border: 'rgba(74,222,128,0.30)' },
  warn: { fg: 'var(--amber, #fbbf24)',  bg: 'rgba(251,191,36,0.08)',  border: 'rgba(251,191,36,0.30)' },
  info: { fg: 'var(--cyan, #5eead4)',   bg: 'rgba(94,234,212,0.08)',  border: 'rgba(94,234,212,0.28)' },
  tip:  { fg: 'var(--violet)',          bg: 'rgba(139,128,240,0.08)', border: 'rgba(139,128,240,0.30)' },
}

function InsightsPane({ a, input }: { a: Analytics; input: AnalyticsInput | null }) {
  const insights = useMemo(() => buildInsights(a), [a])
  const topTakeaways = useMemo(() => sortInsights(insights).slice(0, 3), [insights])
  const risk     = useMemo(() => summarizeRisk(a),     [a])
  const pace     = useMemo(() => summarizePace(a),     [a])
  const activity = useMemo(() => summarizeActivity(a), [a])
  const cache    = useMemo(() => summarizeCache(a),    [a])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Digest KPI row */}
      <KpiRow>
        <Kpi label="Cost"     value={fmtCost(a.cost)}    accent={risk.accent}     sub={a.turns > 0 ? `${fmtCost(a.costPerTurn)}/turn` : 'no turns'} />
        <Kpi label="Risk"     value={risk.label}         accent={risk.accent}     sub={risk.detail} />
        <Kpi label="Pace"     value={pace.label}         accent={pace.accent}     sub={pace.detail} />
      </KpiRow>
      <KpiRow>
        <Kpi label="Activity" value={activity.label}     accent={activity.accent} sub={activity.detail} />
        <Kpi label="Cache"    value={cache.label}        accent={cache.accent}    sub={cache.detail} />
        <Kpi label="Turns"    value={String(a.turns)}    accent="var(--violet)"   sub={a.turns > 0 ? `${a.assistantMessages} assistant replies` : 'no turns'} />
      </KpiRow>

      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
        {insights.length} observation{insights.length === 1 ? '' : 's'} from this session
      </div>

      {/* Top takeaways */}
      {topTakeaways.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 11, color: 'var(--text-2)', letterSpacing: '0.06em' }}>Top takeaways</div>
          {topTakeaways.map((ins, i) => {
            const c = SEVERITY_COLORS[ins.severity]
            return (
              <div key={ins.title} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 11, color: c.fg, flexShrink: 0, width: 18 }}>{i + 1}.</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 12, color: c.fg, fontWeight: 500 }}>{ins.icon} {ins.title}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>{ins.detail}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

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

      <AICoachSection input={input} />
    </div>
  )
}

function AICoachSection({ input }: { input: AnalyticsInput | null }) {
  const sessionId = input?.info?.sessionId
  const provider = input?.info?.provider
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [insights, setInsights] = useState<CoachInsight[]>([])
  const [error, setError] = useState<string>('')
  const generatingRef = useRef(false)

  async function generate() {
    if (!sessionId || generatingRef.current) return
    generatingRef.current = true
    setState('loading')
    setError('')
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/insights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      })
      const data = await readJsonResponse(res)
      setInsights(Array.isArray(data?.insights) ? data.insights : [])
      setState('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
      setState('error')
    } finally {
      generatingRef.current = false
    }
  }

  return (
    <div style={{ marginTop: 8, paddingTop: 12, borderTop: '1px solid var(--border-2)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: 'var(--text-2)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          AI coaching
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-3)' }}>opt-in · sends only aggregate metrics, never transcript</span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="av-hover-control"
          onClick={generate}
          disabled={!sessionId || state === 'loading'}
          style={{
            padding: '5px 12px',
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11,
            color: state === 'loading' ? 'var(--text-3)' : 'var(--surface)',
            background: state === 'loading' ? 'var(--surface-3)' : 'var(--violet)',
            border: '1px solid var(--border-2)',
            borderRadius: 5,
            cursor: !sessionId || state === 'loading' ? 'default' : 'pointer',
          }}
        >
          {state === 'loading' ? 'Generating…' : state === 'done' ? 'Regenerate' : 'Generate coaching'}
        </button>
      </div>

      {state === 'error' && (
        <div style={{ fontSize: 12, color: 'var(--red, #f87171)' }}>{error}</div>
      )}
      {state === 'idle' && (
        <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5 }}>
          Generate model-written suggestions across prompt maturity, context setup, workflow hygiene, tool reliability, and cost — derived entirely from the deterministic metrics above.
        </div>
      )}
      {state === 'done' && insights.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {insights.map((ins) => (
            <div key={ins.kind} style={{ padding: '10px 12px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6 }}>
              <div style={{ fontSize: 12, color: 'var(--violet)', fontWeight: 500, marginBottom: 4 }}>{ins.title}</div>
              <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>{ins.summary}</div>
              {ins.recommendations.length > 0 && (
                <ul style={{ margin: '6px 0 0', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {ins.recommendations.map((rec, i) => (
                    <li key={i} style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5 }}>{rec}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
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
