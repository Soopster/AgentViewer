'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Analytics, AnalyticsInput, FileOps, TimelinePoint } from '@/lib/analytics'
import { computeAnalytics, fmtCost, fmtDuration, fmtNum } from '@/lib/analytics'

type PaneId = 0 | 1 | 2 | 3 | 4

const PANE_TITLES: Record<PaneId, string> = {
  0: 'Summary',
  1: 'Tokens',
  2: 'Tools',
  3: 'Activity',
  4: 'Timeline',
}

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
      else if (e.key >= '0' && e.key <= '4') setPane(parseInt(e.key, 10) as PaneId)
      else if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault()
        setPane((p) => ((p + 1) % 5) as PaneId)
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
          {([0, 1, 2, 3, 4] as PaneId[]).map((p) => (
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
            tab / 0-4 switch · esc close
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
        border: '1px solid var(--border)',
        borderRadius: 6,
        background: 'var(--surface-2)',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
      }}
    >
      <span style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
        {label}
      </span>
      <span style={{ fontSize: 18, color: accent, fontWeight: 500 }}>{value}</span>
      {sub && (
        <span style={{ fontSize: 11, color: 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {sub}
        </span>
      )}
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
  const max = Math.max(1, ...values)
  const cols = values.length
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', height, gap: 1, background: 'var(--surface-2)', padding: 2, borderRadius: 3 }}>
      {values.map((v, i) => {
        const pct = (v / max) * 100
        const color = colors[Math.floor((v / max) * (colors.length - 1)) || 0] ?? colors[0]!
        return (
          <span
            key={i}
            title={`#${i + 1}: ${fmtNum(v)}`}
            style={{
              flex: '1 1 0',
              minWidth: cols > 200 ? 1 : 2,
              height: `${Math.max(2, pct)}%`,
              background: color,
              borderRadius: 1,
            }}
          />
        )
      })}
    </div>
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
          sub={`tools/turn · longest chain ${a.longestAssistantChain}`} />
        <Kpi label="Throughput"
          value={a.tokensPerSecond > 0 ? `${fmtNum(a.tokensPerSecond)} tok/s` : '—'}
          accent="var(--cyan, #5eead4)"
          sub="output tokens / active second" />
        <Kpi label="Slash / stdout"
          value={`${a.slashCommands} / ${fmtNum(a.shellOutputLines)}`}
          accent="var(--amber, #fbbf24)"
          sub="slash commands · shell stdout" />
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
