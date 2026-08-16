'use client'

import Link from 'next/link'
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { fmtCost, fmtNum } from '@/lib/analytics'
import { isProviderSelection } from '@/lib/provider'
import type { CrossSessionAnalytics } from '@/lib/sessionPersistence'
import type { ProviderSelection } from '@/lib/types'

const PROVIDER_OPTIONS: Array<{ value: ProviderSelection; label: string }> = [
  { value: 'all', label: 'All providers' },
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
  { value: 'opencode', label: 'OpenCode' },
  { value: 'copilot', label: 'Copilot' },
  { value: 'pi', label: 'Pi' },
]

type Preset = '7d' | '30d' | '90d' | 'all' | 'custom'

const PRESETS: Array<{ id: Preset; label: string }> = [
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
  { id: '90d', label: '90d' },
  { id: 'all', label: 'All' },
]

const FONT_MONO = "'IBM Plex Mono', monospace"
const ANALYTICS_BACKFILL_KEY = 'analytics:backfilled:v3'
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const CONTRIBUTION_DAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', '']
const ROLE_MIX_SEGMENTS: Array<{
  key: keyof CrossSessionAnalytics['roleMix']
  label: string
  color: string
}> = [
  { key: 'user', label: 'user', color: 'var(--cyan, #5eead4)' },
  { key: 'assistant', label: 'assistant', color: 'var(--violet, #a78bfa)' },
  { key: 'system', label: 'system', color: 'var(--text-3)' },
]

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--text-3)',
  marginBottom: 8,
}

const SECTION_BOX: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: 14,
  background: 'var(--surface)',
}

function presetRange(preset: Preset): { from?: number; to?: number } {
  if (preset === 'all') return {}
  const now = Date.now()
  const days = preset === '7d' ? 7 : preset === '30d' ? 30 : preset === '90d' ? 90 : 0
  if (!days) return {}
  return { from: now - days * 24 * 60 * 60 * 1000, to: now }
}

function isoDateInput(ms: number | undefined): string {
  if (!ms) return ''
  const d = new Date(ms)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function dateInputToMs(value: string, endOfDay: boolean): number | undefined {
  if (!value) return undefined
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return undefined
  if (endOfDay) d.setHours(23, 59, 59, 999)
  else d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function ChartTooltip({
  active,
  payload,
  label,
  formatter,
}: {
  active?: boolean
  payload?: Array<{ name?: string; value?: unknown; color?: string; fill?: string }>
  label?: unknown
  formatter?: (v: number) => string
}) {
  if (!active || !payload?.length) return null
  return (
    <div
      style={{
        background: 'var(--surface-2)',
        border: '1px solid var(--border-2)',
        padding: '4px 8px',
        fontSize: 10,
        borderRadius: 3,
        color: 'var(--text-2)',
        fontFamily: FONT_MONO,
      }}
    >
      {label != null && String(label) !== '' && (
        <div style={{ color: 'var(--text-3)', marginBottom: 2, fontSize: 9 }}>{String(label)}</div>
      )}
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color ?? p.fill ?? 'var(--text)' }}>
          {payload.length > 1 && <span style={{ color: 'var(--text-3)' }}>{p.name}: </span>}
          {formatter ? formatter(Number(p.value)) : Number(p.value).toLocaleString()}
        </div>
      ))}
    </div>
  )
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent: string }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        padding: '12px 14px',
        border: `1px solid ${accent}`,
        borderRadius: 8,
        background: 'var(--surface-2)',
        display: 'flex',
        gap: 10,
      }}
    >
      <span aria-hidden="true" style={{ width: 4, borderRadius: 999, background: accent, flexShrink: 0 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: accent }}>
          {label}
        </span>
        <span style={{ fontSize: 22, color: 'var(--text)', fontWeight: 500, lineHeight: 1.1 }}>{value}</span>
        {sub && (
          <span
            style={{
              fontSize: 11,
              color: 'var(--text-3)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {sub}
          </span>
        )}
      </div>
    </div>
  )
}

function RankedBars({
  entries,
  color,
  formatter = fmtNum,
}: {
  entries: Array<{ label: string; value: number }>
  color: string
  formatter?: (v: number) => string
}) {
  if (entries.length === 0) return <div style={{ color: 'var(--text-3)', fontSize: 11 }}>(no data)</div>
  const data = entries.map((e) => ({ label: e.label.length > 36 ? '…' + e.label.slice(-35) : e.label, value: e.value }))
  const height = data.length * 26 + 24
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 64, left: 0, bottom: 0 }}>
        <XAxis
          type="number"
          tick={{ fontSize: 9, fill: 'var(--text-3)', fontFamily: FONT_MONO }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="label"
          tick={{ fontSize: 10, fill: 'var(--text-2)', fontFamily: FONT_MONO }}
          axisLine={false}
          tickLine={false}
          width={220}
        />
        <Tooltip content={(props) => <ChartTooltip {...(props as unknown as Parameters<typeof ChartTooltip>[0])} formatter={formatter} />} />
        <Bar dataKey="value" fill={color} radius={[0, 2, 2, 0]}>
          <LabelList
            dataKey="value"
            position="right"
            formatter={(v: unknown) => formatter(Number(v))}
            style={{ fontSize: 10, fill: 'var(--text-2)', fontFamily: FONT_MONO }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

function HourHeatmap({ cells }: { cells: CrossSessionAnalytics['hourHeatmap'] }) {
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0))
  let max = 0
  for (const c of cells) {
    if (c.dow >= 0 && c.dow < 7 && c.hour >= 0 && c.hour < 24) {
      grid[c.dow][c.hour] = c.messages
      if (c.messages > max) max = c.messages
    }
  }
  if (max === 0) return <div style={{ color: 'var(--text-3)', fontSize: 11 }}>(no data)</div>
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '40px repeat(24, 1fr)', gap: 2, fontFamily: FONT_MONO, fontSize: 9 }}>
      <div />
      {Array.from({ length: 24 }, (_, h) => (
        <div key={h} style={{ color: 'var(--text-3)', textAlign: 'center' }}>
          {h % 3 === 0 ? h : ''}
        </div>
      ))}
      {WEEKDAY_LABELS.map((day, dow) => (
        <Row key={day} day={day} cells={grid[dow]} max={max} />
      ))}
    </div>
  )
}

function Row({ day, cells, max }: { day: string; cells: number[]; max: number }) {
  return (
    <>
      <div style={{ color: 'var(--text-3)', alignSelf: 'center', textAlign: 'right', paddingRight: 6 }}>{day}</div>
      {cells.map((value, hour) => {
        const opacity = value === 0 ? 0.06 : Math.max(0.15, value / max)
        return (
          <div
            key={hour}
            title={`${day} ${hour}:00 — ${value} messages`}
            style={{
              aspectRatio: '1',
              minHeight: 14,
              borderRadius: 2,
              background: 'var(--cyan, #5eead4)',
              opacity,
            }}
          />
        )
      })}
    </>
  )
}

const MODEL_COLORS = [
  'var(--cyan, #5eead4)',
  'var(--violet, #a78bfa)',
  'var(--green, #4ade80)',
  'var(--orange, #fb923c)',
  'var(--yellow, #facc15)',
  'var(--pink, #f472b6)',
  '#60a5fa',
  '#f87171',
  '#34d399',
  '#c084fc',
]

function fmtLatency(ms: number): string {
  if (ms <= 0) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  return `${(ms / 60_000).toFixed(1)} m`
}

type InsightTone = 'good' | 'warn' | 'neutral'
type Insight = { icon: string; tone: InsightTone; label: string; detail?: string }

function toneColor(tone: InsightTone): string {
  if (tone === 'good') return 'var(--green, #4ade80)'
  if (tone === 'warn') return 'var(--orange, #fb923c)'
  return 'var(--cyan, #5eead4)'
}

function computeInsights(data: CrossSessionAnalytics): Insight[] {
  const out: Insight[] = []

  // 1. Activity headline.
  if (data.totals.messages > 0) {
    out.push({
      icon: '◆',
      tone: 'neutral',
      label: `${fmtNum(data.totals.messages)} messages across ${fmtNum(data.totals.sessions)} sessions on ${fmtNum(data.totals.activeDays)} active days`,
      detail: data.totals.estCost > 0 ? `${fmtCost(data.totals.estCost)} estimated spend` : undefined,
    })
  }

  // 2. Most active day.
  if (data.daily.length > 0) {
    const peak = data.daily.reduce((acc, d) => (d.messages > acc.messages ? d : acc), data.daily[0])
    if (peak.messages > 0) {
      out.push({
        icon: '▲',
        tone: 'neutral',
        label: `Most active day: ${peak.day}`,
        detail: `${fmtNum(peak.messages)} messages${peak.cost > 0 ? ` · ${fmtCost(peak.cost)}` : ''}`,
      })
    }
  }

  // 3. Streak.
  if (data.streak.current > 1) {
    out.push({
      icon: '✦',
      tone: 'good',
      label: `On a ${fmtNum(data.streak.current)}-day streak`,
      detail: data.streak.longest > data.streak.current ? `longest in range was ${fmtNum(data.streak.longest)} days` : 'longest in range',
    })
  } else if (data.streak.longest >= 3) {
    out.push({
      icon: '✦',
      tone: 'neutral',
      label: `Longest stretch: ${fmtNum(data.streak.longest)} consecutive active days`,
    })
  }

  // 4. Latency trend — split the daily series into early/late halves and compare median p50.
  // Only include days with at least 10 paired samples so single-message outliers don't dominate.
  const meaningfulLatency = data.latency.filter((d) => d.samples >= 10)
  if (meaningfulLatency.length >= 4) {
    const half = Math.floor(meaningfulLatency.length / 2)
    const early = meaningfulLatency.slice(0, half)
    const late = meaningfulLatency.slice(-half)
    const median = (rows: typeof meaningfulLatency) => {
      const sorted = rows.map((r) => r.p50).sort((a, b) => a - b)
      return sorted[Math.floor(sorted.length / 2)] ?? 0
    }
    const earlyMed = median(early)
    const lateMed = median(late)
    if (earlyMed > 0 && lateMed > 0) {
      const ratio = lateMed / earlyMed
      if (ratio >= 1.5) {
        out.push({
          icon: '↑',
          tone: 'warn',
          label: `Response latency up ${ratio.toFixed(1)}× recently`,
          detail: `median p50: ${fmtLatency(earlyMed)} → ${fmtLatency(lateMed)}`,
        })
      } else if (ratio <= 0.7) {
        out.push({
          icon: '↓',
          tone: 'good',
          label: `Response latency down ${(1 / ratio).toFixed(1)}× recently`,
          detail: `median p50: ${fmtLatency(earlyMed)} → ${fmtLatency(lateMed)}`,
        })
      }
    }
  }

  // 5. Cost-per-message trend over the same halves.
  if (data.daily.length >= 4) {
    const half = Math.floor(data.daily.length / 2)
    const sumCost = (rows: typeof data.daily) => rows.reduce((a, d) => a + d.cost, 0)
    const sumMsgs = (rows: typeof data.daily) => rows.reduce((a, d) => a + d.messages, 0)
    const early = data.daily.slice(0, half)
    const late = data.daily.slice(-half)
    const earlyCpm = sumMsgs(early) > 0 ? sumCost(early) / sumMsgs(early) : 0
    const lateCpm = sumMsgs(late) > 0 ? sumCost(late) / sumMsgs(late) : 0
    if (earlyCpm > 0 && lateCpm > 0) {
      const ratio = lateCpm / earlyCpm
      if (ratio >= 1.4) {
        out.push({
          icon: '↑',
          tone: 'warn',
          label: `Cost per message up ${ratio.toFixed(1)}× recently`,
          detail: `${fmtCost(earlyCpm)} → ${fmtCost(lateCpm)} per message`,
        })
      } else if (ratio <= 0.7) {
        out.push({
          icon: '↓',
          tone: 'good',
          label: `Cost per message down ${(1 / ratio).toFixed(1)}× recently`,
          detail: `${fmtCost(earlyCpm)} → ${fmtCost(lateCpm)} per message`,
        })
      }
    }
  }

  // 6. Tool reliability.
  if (data.toolErrors.length > 0) {
    const worstByCount = data.toolErrors[0]
    const worstByRate = data.toolErrors.toSorted((a, b) => b.rate - a.rate)[0]
    if (worstByCount.errors > 0) {
      out.push({
        icon: '!',
        tone: 'warn',
        label: `${worstByCount.name} errored ${fmtNum(worstByCount.errors)} times`,
        detail: `${(worstByCount.rate * 100).toFixed(1)}% of ${fmtNum(worstByCount.total)} calls${worstByRate.name !== worstByCount.name ? ` · highest rate: ${worstByRate.name} (${(worstByRate.rate * 100).toFixed(1)}%)` : ''}`,
      })
    }
  } else if (data.tools.length > 0) {
    out.push({
      icon: '✓',
      tone: 'good',
      label: 'No tool errors recorded',
      detail: `${fmtNum(data.tools.reduce((a, t) => a + t.count, 0))} tool calls clean`,
    })
  }

  // 7. Most-used tool.
  if (data.tools.length > 0) {
    const t = data.tools[0]
    const totalCalls = data.tools.reduce((a, x) => a + x.count, 0)
    const share = totalCalls > 0 ? (t.count / totalCalls) * 100 : 0
    out.push({
      icon: '◇',
      tone: 'neutral',
      label: `Most-used tool: ${t.name} (${fmtNum(t.count)} calls)`,
      detail: share >= 10 ? `${share.toFixed(0)}% of all tool use` : undefined,
    })
  }

  // 8. Cache savings.
  if (data.totals.cacheSavings >= 1) {
    out.push({
      icon: '$',
      tone: 'good',
      label: `Cache saved ${fmtCost(data.totals.cacheSavings)}`,
      detail: `${(data.totals.cacheHitRate * 100).toFixed(1)}% hit rate · ${fmtNum(data.totals.cacheReadTokens)} cached tokens`,
    })
  }

  // 9. Cost concentration in top session.
  if (data.topSessions.length > 0 && data.totals.estCost > 0) {
    const top = data.topSessions[0]
    const share = (top.cost / data.totals.estCost) * 100
    if (share >= 25) {
      out.push({
        icon: '●',
        tone: share >= 50 ? 'warn' : 'neutral',
        label: `Top session is ${share.toFixed(0)}% of total spend`,
        detail: `${fmtCost(top.cost)} on "${top.title.length > 50 ? `${top.title.slice(0, 50)}…` : top.title}"`,
      })
    }
  }

  // 10. Provider mix.
  if (data.providers.length > 1) {
    const totalMsgs = data.providers.reduce((a, p) => a + p.messages, 0)
    const lead = data.providers[0]
    const leadShare = totalMsgs > 0 ? (lead.messages / totalMsgs) * 100 : 0
    if (leadShare < 95 && data.providers.length >= 2) {
      const second = data.providers[1]
      const secondShare = totalMsgs > 0 ? (second.messages / totalMsgs) * 100 : 0
      out.push({
        icon: '◑',
        tone: 'neutral',
        label: `${data.providers.length}-provider mix`,
        detail: `${lead.provider} ${leadShare.toFixed(0)}% · ${second.provider} ${secondShare.toFixed(0)}%`,
      })
    }
  }

  // 11. Slash-command share (origin breakdown — sum non-empty + non-'(none)' kinds).
  if (data.origins.length > 0 && data.totals.messages > 0) {
    const slash = data.origins.find((o) => o.kind === 'slash_command')
    if (slash && slash.count > 0) {
      const pct = (slash.count / data.totals.messages) * 100
      if (pct >= 5) {
        out.push({
          icon: '/',
          tone: 'neutral',
          label: `${pct.toFixed(0)}% of messages came from slash commands`,
          detail: `${fmtNum(slash.count)} slash invocations`,
        })
      }
    }
  }

  // 12. Peak hour from heatmap (local time).
  if (data.hourHeatmap.length > 0) {
    const byHour = new Map<number, number>()
    for (const c of data.hourHeatmap) byHour.set(c.hour, (byHour.get(c.hour) ?? 0) + c.messages)
    const peak = [...byHour.entries()].sort((a, b) => b[1] - a[1])[0]
    if (peak && peak[1] > 0) {
      const totalMsgs = [...byHour.values()].reduce((a, v) => a + v, 0)
      const pct = totalMsgs > 0 ? (peak[1] / totalMsgs) * 100 : 0
      if (pct >= 15) {
        const hh = String(peak[0]).padStart(2, '0')
        out.push({
          icon: '◴',
          tone: 'neutral',
          label: `Peak hour: ${hh}:00 (${pct.toFixed(0)}% of activity)`,
          detail: `${fmtNum(peak[1])} messages`,
        })
      }
    }
  }

  // 13. Session-duration profile.
  if (data.durationBuckets.some((b) => b.sessions > 0)) {
    const totalSessions = data.durationBuckets.reduce((a, b) => a + b.sessions, 0)
    const shortBuckets = ['<1m', '1-5m']
    const longBuckets = ['1-3h', '3-12h', '>12h']
    const shortCount = data.durationBuckets.filter((b) => shortBuckets.includes(b.bucket)).reduce((a, b) => a + b.sessions, 0)
    const longCount = data.durationBuckets.filter((b) => longBuckets.includes(b.bucket)).reduce((a, b) => a + b.sessions, 0)
    if (totalSessions > 0) {
      const shortPct = (shortCount / totalSessions) * 100
      const longPct = (longCount / totalSessions) * 100
      if (shortPct >= 50) {
        out.push({
          icon: '⌁',
          tone: 'neutral',
          label: `${shortPct.toFixed(0)}% of sessions wrap in under 5 min`,
          detail: 'short, focused interactions dominate',
        })
      } else if (longPct >= 25) {
        out.push({
          icon: '⌁',
          tone: 'neutral',
          label: `${longPct.toFixed(0)}% of sessions run over 1 hour`,
          detail: 'long-form work patterns',
        })
      }
    }
  }

  return out
}

function InsightsPanel({ data }: { data: CrossSessionAnalytics }) {
  const insights = useMemo(() => computeInsights(data), [data])
  if (insights.length === 0) {
    return (
      <div style={{ ...SECTION_BOX }}>
        <div style={LABEL_STYLE}>Insights</div>
        <div style={{ color: 'var(--text-3)', fontSize: 11 }}>
          (not enough data in range to surface anything noteworthy)
        </div>
      </div>
    )
  }
  return (
    <div style={SECTION_BOX}>
      <div style={LABEL_STYLE}>Insights</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 8 }}>
        {insights.map((ins, i) => {
          const color = toneColor(ins.tone)
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'flex-start',
                padding: '8px 10px',
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                borderLeft: `3px solid ${color}`,
                borderRadius: 4,
                minWidth: 0,
              }}
            >
              <span style={{ color, fontSize: 14, lineHeight: 1.2, flexShrink: 0 }} aria-hidden="true">
                {ins.icon}
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                <span style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.35 }}>{ins.label}</span>
                {ins.detail && (
                  <span style={{ fontSize: 10, color: 'var(--text-3)', lineHeight: 1.3 }}>{ins.detail}</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SubHeader({ label }: { label: string }) {
  return (
    <div
      style={{
        gridColumn: '1 / -1',
        fontSize: 11,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: 'var(--text-2)',
        marginTop: 8,
        paddingBottom: 4,
        borderBottom: '1px solid var(--border)',
      }}
    >
      {label}
    </div>
  )
}

function RoleMixBar({ mix }: { mix: CrossSessionAnalytics['roleMix'] }) {
  const total = mix.user + mix.assistant + mix.system
  if (total === 0) return <div style={{ color: 'var(--text-3)', fontSize: 11 }}>(no data)</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', height: 18, borderRadius: 4, overflow: 'hidden', border: '1px solid var(--border)' }}>
        {ROLE_MIX_SEGMENTS.map((s) => {
          const pct = (mix[s.key] / total) * 100
          if (pct <= 0) return null
          return (
            <div
              key={s.key}
              title={`${s.label}: ${fmtNum(mix[s.key])} (${pct.toFixed(1)}%)`}
              style={{ width: `${pct}%`, background: s.color }}
            />
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 12, fontSize: 10, color: 'var(--text-3)', flexWrap: 'wrap' }}>
        {ROLE_MIX_SEGMENTS.map((s) => (
          <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, background: s.color, borderRadius: 2 }} />
            {s.label} · {fmtNum(mix[s.key])} ({total > 0 ? ((mix[s.key] / total) * 100).toFixed(1) : '0'}%)
          </span>
        ))}
      </div>
    </div>
  )
}

function ContributionCalendar({
  daily,
  range,
}: {
  daily: CrossSessionAnalytics['daily']
  range: { from: number | null; to: number | null }
}) {
  const counts = new Map(daily.map((d) => [d.day, d.messages]))
  const max = daily.reduce((acc, d) => Math.max(acc, d.messages), 0)
  if (max === 0) return <div style={{ color: 'var(--text-3)', fontSize: 11 }}>(no data)</div>

  const now = Date.now()
  const start = range.from ?? now - 365 * 86_400_000
  const end = range.to ?? now
  // Round start to a Sunday for a tidy grid.
  const startDate = new Date(start)
  startDate.setHours(0, 0, 0, 0)
  startDate.setDate(startDate.getDate() - startDate.getDay())
  const endDate = new Date(end)
  endDate.setHours(23, 59, 59, 999)
  const totalDays = Math.max(7, Math.ceil((endDate.getTime() - startDate.getTime()) / 86_400_000))
  const totalCols = Math.ceil(totalDays / 7)

  type Cell = { dayKey: string; date: Date; value: number; inRange: boolean }
  const cols: Cell[][] = Array.from({ length: totalCols }, () => [])
  for (let i = 0; i < totalCols * 7; i += 1) {
    const date = new Date(startDate.getTime() + i * 86_400_000)
    const yyyy = date.getUTCFullYear()
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(date.getUTCDate()).padStart(2, '0')
    const dayKey = `${yyyy}-${mm}-${dd}`
    const value = counts.get(dayKey) ?? 0
    const ms = date.getTime()
    const inRange = ms >= start && ms <= end
    cols[Math.floor(i / 7)].push({ dayKey, date, value, inRange })
  }

  const monthLabels: Array<{ col: number; label: string }> = []
  let lastMonth = -1
  cols.forEach((col, ci) => {
    const first = col[0]
    if (!first) return
    const m = first.date.getUTCMonth()
    if (m !== lastMonth) {
      monthLabels.push({ col: ci, label: first.date.toLocaleString('default', { month: 'short' }) })
      lastMonth = m
    }
  })

  const cellSize = 11
  const gap = 2

  return (
    <div style={{ overflowX: 'auto' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `28px repeat(${totalCols}, ${cellSize}px)`,
          gap,
          fontFamily: FONT_MONO,
          fontSize: 9,
        }}
      >
        <div />
        {cols.map((_, ci) => {
          const label = monthLabels.find((m) => m.col === ci)
          return (
            <div key={`mh-${ci}`} style={{ color: 'var(--text-3)', height: 12, lineHeight: '12px' }}>
              {label ? label.label : ''}
            </div>
          )
        })}
        {CONTRIBUTION_DAY_LABELS.map((label, dow) => (
          <Fragment key={`row-${dow}`}>
            <div style={{ color: 'var(--text-3)', alignSelf: 'center', textAlign: 'right', paddingRight: 4, height: cellSize }}>{label}</div>
            {cols.map((col, ci) => {
              const cell = col[dow]
              if (!cell) return <div key={`c-${ci}-${dow}`} style={{ width: cellSize, height: cellSize }} />
              const opacity = !cell.inRange ? 0.04 : cell.value === 0 ? 0.08 : Math.max(0.18, cell.value / max)
              return (
                <div
                  key={`c-${ci}-${dow}`}
                  title={`${cell.dayKey} — ${fmtNum(cell.value)} messages`}
                  style={{
                    width: cellSize,
                    height: cellSize,
                    borderRadius: 2,
                    background: 'var(--green, #4ade80)',
                    opacity,
                  }}
                />
              )
            })}
          </Fragment>
        ))}
      </div>
    </div>
  )
}

export default function AnalyticsPage() {
  const [provider, setProvider] = useState<ProviderSelection>('all')
  const [dir, setDir] = useState<string>('all')
  const [preset, setPreset] = useState<Preset>('30d')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [data, setData] = useState<CrossSessionAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [backfillState, setBackfillState] = useState<'idle' | 'running' | 'done'>('idle')

  const range = useMemo(() => {
    if (preset === 'custom') {
      return {
        from: dateInputToMs(customFrom, false),
        to: dateInputToMs(customTo, true),
      }
    }
    return presetRange(preset)
  }, [preset, customFrom, customTo])

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (provider !== 'all') params.set('provider', provider)
      if (dir !== 'all') params.set('dir', dir)
      if (range.from) params.set('from', String(range.from))
      if (range.to) params.set('to', String(range.to))
      const response = await fetch(`/api/session-index/analytics?${params.toString()}`)
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.error || `Request failed (${response.status})`)
      }
      const json = (await response.json()) as CrossSessionAnalytics
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }, [provider, dir, range.from, range.to])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  // One-time backfill so existing message rows pick up new derived columns
  // (model on schema v2, is_error on schema v3). The key is versioned so each
  // schema bump retriggers a single rebuild per browser.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.localStorage.getItem(ANALYTICS_BACKFILL_KEY) === '1') return
    if (backfillState !== 'idle') return
    setBackfillState('running')
    fetch('/api/session-index/rebuild', { method: 'POST' })
      .then(() => {
        window.localStorage.setItem(ANALYTICS_BACKFILL_KEY, '1')
        setBackfillState('done')
        void fetchData()
      })
      .catch(() => setBackfillState('done'))
  }, [backfillState, fetchData])

  const projectOptions = useMemo(() => {
    const list = data?.projects ?? []
    return [
      { value: 'all', label: 'All projects' },
      ...list.map((p) => ({ value: p.cwd, label: `${p.name} (${fmtNum(p.messages)})` })),
    ]
  }, [data?.projects])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--bg)',
        color: 'var(--text)',
        fontFamily: FONT_MONO,
        padding: 24,
        overflowY: 'auto',
        overflowX: 'hidden',
      }}
    >
      <div style={{ maxWidth: 1280, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h1 style={{ fontSize: 22, fontWeight: 500, letterSpacing: '0.02em', margin: 0 }}>
              Cross-session analytics
            </h1>
            <span style={{ color: 'var(--text-3)', fontSize: 12 }}>
              Aggregated across the persistent session index.
            </span>
          </div>
          <Link
            href="/"
            transitionTypes={['route']}
            style={{
              fontSize: 11,
              padding: '6px 10px',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text-2)',
              textDecoration: 'none',
              background: 'var(--surface)',
            }}
          >
            ← Back to sessions
          </Link>
        </header>

        {/* Filter bar */}
        <div style={{ ...SECTION_BOX, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-3)' }}>
            Provider
            <select
              value={provider}
              onChange={(e) => {
                const v = e.target.value
                if (isProviderSelection(v)) setProvider(v)
              }}
              style={selectStyle}
            >
              {PROVIDER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-3)' }}>
            Project
            <select value={dir} onChange={(e) => setDir(e.target.value)} style={{ ...selectStyle, maxWidth: 280 }}>
              {projectOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginLeft: 'auto' }}>
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className="av-hover-control"
                onClick={() => setPreset(p.id)}
                style={presetButtonStyle(preset === p.id)}
              >
                {p.label}
              </button>
            ))}
            <button
              type="button"
              className="av-hover-control"
              onClick={() => setPreset('custom')}
              style={presetButtonStyle(preset === 'custom')}
            >
              Custom
            </button>
            {preset === 'custom' && (
              <>
                <input
                  type="date"
                  value={customFrom || isoDateInput(range.from)}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  style={dateInputStyle}
                />
                <span style={{ color: 'var(--text-3)', fontSize: 11 }}>→</span>
                <input
                  type="date"
                  value={customTo || isoDateInput(range.to)}
                  onChange={(e) => setCustomTo(e.target.value)}
                  style={dateInputStyle}
                />
              </>
            )}
          </div>
        </div>

        {error && (
          <div style={{ ...SECTION_BOX, color: 'var(--red, #f87171)', borderColor: 'var(--red, #f87171)' }}>
            {error}
          </div>
        )}

        {backfillState === 'running' && (
          <div style={{ ...SECTION_BOX, fontSize: 11, color: 'var(--text-3)' }}>
            One-time index rebuild in progress to populate model data — analytics will refresh when it finishes.
          </div>
        )}

        {/* KPI grid */}
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
              <Kpi label="Sessions" value={fmtNum(data.totals.sessions)} accent="var(--cyan, #5eead4)" />
              <Kpi label="Messages" value={fmtNum(data.totals.messages)} accent="var(--violet, #a78bfa)" />
              <Kpi
                label="Tokens"
                value={fmtNum(data.totals.totalTokens)}
                sub={`${fmtNum(data.totals.inputTokens)} in / ${fmtNum(data.totals.outputTokens)} out`}
                accent="var(--green, #4ade80)"
              />
              <Kpi
                label="Est. cost"
                value={fmtCost(data.totals.estCost)}
                sub="model-based estimate"
                accent="var(--orange, #fb923c)"
              />
              <Kpi
                label="Cache hit"
                value={`${(data.totals.cacheHitRate * 100).toFixed(1)}%`}
                sub={`${fmtNum(data.totals.cacheReadTokens)} cached`}
                accent="var(--yellow, #facc15)"
              />
              <Kpi label="Active days" value={fmtNum(data.totals.activeDays)} accent="var(--pink, #f472b6)" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              <Kpi
                label="Cache savings"
                value={fmtCost(data.totals.cacheSavings)}
                sub="vs. paying full input price"
                accent="var(--green, #4ade80)"
              />
              <Kpi
                label="Avg msgs / session"
                value={data.totals.avgMessagesPerSession.toFixed(1)}
                accent="var(--cyan, #5eead4)"
              />
              <Kpi
                label="Avg tokens / session"
                value={fmtNum(Math.round(data.totals.avgTokensPerSession))}
                accent="var(--violet, #a78bfa)"
              />
              <Kpi
                label="Avg cost / session"
                value={fmtCost(data.totals.avgCostPerSession)}
                accent="var(--orange, #fb923c)"
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              <Kpi
                label="Current streak"
                value={`${fmtNum(data.streak.current)} ${data.streak.current === 1 ? 'day' : 'days'}`}
                sub={data.streak.current > 0 ? 'consecutive active days' : 'no recent activity'}
                accent="var(--green, #4ade80)"
              />
              <Kpi
                label="Longest streak"
                value={`${fmtNum(data.streak.longest)} ${data.streak.longest === 1 ? 'day' : 'days'}`}
                sub="in the selected range"
                accent="var(--pink, #f472b6)"
              />
              <Kpi
                label="User → assistant"
                value={`${fmtNum(data.roleMix.user)} / ${fmtNum(data.roleMix.assistant)}`}
                sub={data.roleMix.user > 0 ? `${(data.roleMix.assistant / data.roleMix.user).toFixed(1)} assistant per user msg` : 'no user messages'}
                accent="var(--cyan, #5eead4)"
              />
              <Kpi
                label="Tool errors"
                value={fmtNum(data.toolErrors.reduce((acc, t) => acc + t.errors, 0))}
                sub={data.toolErrors.length > 0 ? `across ${data.toolErrors.length} tool${data.toolErrors.length === 1 ? '' : 's'}` : 'no errors recorded'}
                accent="var(--orange, #fb923c)"
              />
            </div>
          </>
        )}

        {/* Insights — auto-derived takeaways. Sits above the charts so the headline reads first. */}
        {data && <InsightsPanel data={data} />}

        {/* Daily activity */}
        {data && (
          <div style={SECTION_BOX}>
            <div style={LABEL_STYLE}>Daily activity</div>
            {data.daily.length === 0 ? (
              <div style={{ color: 'var(--text-3)', fontSize: 11 }}>(no data in range)</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={data.daily} margin={{ top: 8, right: 16, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="day"
                    tick={{ fontSize: 9, fill: 'var(--text-3)', fontFamily: FONT_MONO }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 9, fill: 'var(--text-3)', fontFamily: FONT_MONO }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 9, fill: 'var(--text-3)', fontFamily: FONT_MONO }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => fmtNum(v)}
                  />
                  <Tooltip content={(props) => <ChartTooltip {...(props as unknown as Parameters<typeof ChartTooltip>[0])} />} />
                  <Bar yAxisId="left" dataKey="messages" fill="var(--cyan, #5eead4)" radius={[2, 2, 0, 0]} name="messages" />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="tokens"
                    stroke="var(--violet, #a78bfa)"
                    strokeWidth={2}
                    dot={false}
                    name="tokens"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        )}

        {/* Cumulative cost + sessions per day */}
        {data && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={SECTION_BOX}>
              <div style={LABEL_STYLE}>Cumulative cost</div>
              {data.daily.length === 0 ? (
                <div style={{ color: 'var(--text-3)', fontSize: 11 }}>(no data in range)</div>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <AreaChart data={data.daily} margin={{ top: 8, right: 16, left: -12, bottom: 0 }}>
                    <defs>
                      <linearGradient id="cumCost" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--orange, #fb923c)" stopOpacity={0.45} />
                        <stop offset="100%" stopColor="var(--orange, #fb923c)" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="day" tick={{ fontSize: 9, fill: 'var(--text-3)', fontFamily: FONT_MONO }} axisLine={false} tickLine={false} />
                    <YAxis
                      tick={{ fontSize: 9, fill: 'var(--text-3)', fontFamily: FONT_MONO }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v: number) => fmtCost(v)}
                    />
                    <Tooltip content={(props) => <ChartTooltip {...(props as unknown as Parameters<typeof ChartTooltip>[0])} formatter={fmtCost} />} />
                    <Area type="monotone" dataKey="cumulativeCost" stroke="var(--orange, #fb923c)" strokeWidth={2} fill="url(#cumCost)" name="cumulative" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
            <div style={SECTION_BOX}>
              <div style={LABEL_STYLE}>Sessions started per day</div>
              {data.sessionsPerDay.length === 0 ? (
                <div style={{ color: 'var(--text-3)', fontSize: 11 }}>(no data in range)</div>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={data.sessionsPerDay} margin={{ top: 8, right: 16, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="day" tick={{ fontSize: 9, fill: 'var(--text-3)', fontFamily: FONT_MONO }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 9, fill: 'var(--text-3)', fontFamily: FONT_MONO }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip content={(props) => <ChartTooltip {...(props as unknown as Parameters<typeof ChartTooltip>[0])} />} />
                    <Bar dataKey="sessions" fill="var(--pink, #f472b6)" radius={[2, 2, 0, 0]} name="sessions" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {data && (
            <div style={SECTION_BOX}>
              <div style={LABEL_STYLE}>Providers</div>
              <RankedBars
                color="var(--violet, #a78bfa)"
                entries={data.providers.map((p) => ({
                  label: `${p.provider} · ${fmtNum(p.sessions)} sessions`,
                  value: p.messages,
                }))}
              />
            </div>
          )}
          {data && (
            <div style={SECTION_BOX}>
              <div style={LABEL_STYLE}>Top projects</div>
              <RankedBars
                color="var(--cyan, #5eead4)"
                entries={data.projects.slice(0, 15).map((p) => ({
                  label: `${p.name} (${fmtNum(p.sessions)} sess)`,
                  value: p.messages,
                }))}
              />
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {data && (
            <div style={SECTION_BOX}>
              <div style={LABEL_STYLE}>Top tools</div>
              <RankedBars
                color="var(--green, #4ade80)"
                entries={data.tools.slice(0, 20).map((t) => ({ label: t.name, value: t.count }))}
              />
            </div>
          )}
          {data && (
            <div style={SECTION_BOX}>
              <div style={LABEL_STYLE}>Cost by model</div>
              {data.models.length === 0 ? (
                <div style={{ color: 'var(--text-3)', fontSize: 11 }}>(no model data — backfill may still be running)</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead>
                    <tr style={{ color: 'var(--text-3)', textAlign: 'left' }}>
                      <th style={modelTh}>Model</th>
                      <th style={{ ...modelTh, textAlign: 'right' }}>Msgs</th>
                      <th style={{ ...modelTh, textAlign: 'right' }}>Tokens</th>
                      <th style={{ ...modelTh, textAlign: 'right' }}>Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.models.map((m) => {
                      const total = m.inputTokens + m.outputTokens + m.cacheReadTokens + m.cacheWriteTokens
                      return (
                        <tr key={m.model} style={{ borderTop: '1px solid var(--border)' }}>
                          <td style={modelTd}>{m.model}</td>
                          <td style={{ ...modelTd, textAlign: 'right' }}>{fmtNum(m.messages)}</td>
                          <td style={{ ...modelTd, textAlign: 'right' }}>{fmtNum(total)}</td>
                          <td style={{ ...modelTd, textAlign: 'right', color: 'var(--orange, #fb923c)' }}>
                            {fmtCost(m.cost)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>

        {data && data.topSessions.length > 0 && (
          <div style={SECTION_BOX}>
            <div style={LABEL_STYLE}>Top sessions by cost</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ color: 'var(--text-3)', textAlign: 'left' }}>
                  <th style={modelTh}>Title</th>
                  <th style={modelTh}>Provider</th>
                  <th style={modelTh}>Project</th>
                  <th style={{ ...modelTh, textAlign: 'right' }}>Msgs</th>
                  <th style={{ ...modelTh, textAlign: 'right' }}>Tokens</th>
                  <th style={{ ...modelTh, textAlign: 'right' }}>Cost</th>
                  <th style={modelTh}>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {data.topSessions.map((s) => (
                  <tr key={s.key} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ ...modelTd, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.title}>
                      {s.title}
                    </td>
                    <td style={modelTd}>{s.provider}</td>
                    <td style={{ ...modelTd, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.cwd ?? ''}>
                      {s.cwd ? s.cwd.split('/').slice(-2).join('/') : '—'}
                    </td>
                    <td style={{ ...modelTd, textAlign: 'right' }}>{fmtNum(s.messages)}</td>
                    <td style={{ ...modelTd, textAlign: 'right' }}>{fmtNum(s.tokens)}</td>
                    <td style={{ ...modelTd, textAlign: 'right', color: 'var(--orange, #fb923c)' }}>{fmtCost(s.cost)}</td>
                    <td style={{ ...modelTd, color: 'var(--text-3)' }}>
                      {s.lastMessageAt ? new Date(s.lastMessageAt).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && (
          <div style={SECTION_BOX}>
            <div style={LABEL_STYLE}>Activity heatmap (day × hour, local time)</div>
            <HourHeatmap cells={data.hourHeatmap} />
          </div>
        )}

        {/* === RELIABILITY & EFFICIENCY === */}
        {data && <SubHeader label="Reliability & efficiency" />}

        {data && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={SECTION_BOX}>
              <div style={LABEL_STYLE}>Tools with errors</div>
              {data.toolErrors.length === 0 ? (
                <div style={{ color: 'var(--text-3)', fontSize: 11 }}>(no tool errors recorded in range)</div>
              ) : (
                <RankedBars
                  color="var(--orange, #fb923c)"
                  entries={data.toolErrors.map((t) => ({
                    label: `${t.name} · ${t.errors}/${t.total} (${(t.rate * 100).toFixed(1)}%)`,
                    value: t.errors,
                  }))}
                />
              )}
            </div>
            <div style={SECTION_BOX}>
              <div style={LABEL_STYLE}>Cache hit rate trend</div>
              {data.daily.length === 0 ? (
                <div style={{ color: 'var(--text-3)', fontSize: 11 }}>(no data in range)</div>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <ComposedChart data={data.daily} margin={{ top: 8, right: 16, left: -12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="day" tick={{ fontSize: 9, fill: 'var(--text-3)', fontFamily: FONT_MONO }} axisLine={false} tickLine={false} />
                    <YAxis
                      tick={{ fontSize: 9, fill: 'var(--text-3)', fontFamily: FONT_MONO }}
                      axisLine={false}
                      tickLine={false}
                      domain={[0, 1]}
                      tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
                    />
                    <Tooltip content={(props) => <ChartTooltip {...(props as unknown as Parameters<typeof ChartTooltip>[0])} formatter={(v) => `${(v * 100).toFixed(1)}%`} />} />
                    <Line type="monotone" dataKey="cacheHitRate" stroke="var(--yellow, #facc15)" strokeWidth={2} dot={false} name="cache hit" />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        )}

        {data && (
          <div style={SECTION_BOX}>
            <div style={LABEL_STYLE}>Assistant response latency (median + p95)</div>
            {data.latency.length === 0 ? (
              <div style={{ color: 'var(--text-3)', fontSize: 11 }}>(not enough paired messages in range)</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <ComposedChart data={data.latency} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 9, fill: 'var(--text-3)', fontFamily: FONT_MONO }} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fontSize: 9, fill: 'var(--text-3)', fontFamily: FONT_MONO }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => fmtLatency(v)}
                  />
                  <Tooltip content={(props) => <ChartTooltip {...(props as unknown as Parameters<typeof ChartTooltip>[0])} formatter={fmtLatency} />} />
                  <Line type="monotone" dataKey="p50" stroke="var(--cyan, #5eead4)" strokeWidth={2} dot={false} name="p50" />
                  <Line type="monotone" dataKey="p95" stroke="var(--violet, #a78bfa)" strokeWidth={2} dot={false} name="p95" />
                </ComposedChart>
              </ResponsiveContainer>
            )}
            <div style={{ display: 'flex', gap: 12, fontSize: 10, color: 'var(--text-3)', marginTop: 6 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, background: 'var(--cyan, #5eead4)', borderRadius: 2 }} /> p50
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, background: 'var(--violet, #a78bfa)', borderRadius: 2 }} /> p95
              </span>
              <span>capped at 10 min · paired user→assistant gaps only</span>
            </div>
          </div>
        )}

        {/* === WORKFLOW SHAPE === */}
        {data && <SubHeader label="Workflow shape" />}

        {data && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={SECTION_BOX}>
              <div style={LABEL_STYLE}>Session duration</div>
              {data.durationBuckets.every((b) => b.sessions === 0) ? (
                <div style={{ color: 'var(--text-3)', fontSize: 11 }}>(no completed sessions in range)</div>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={data.durationBuckets} margin={{ top: 8, right: 16, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="bucket" tick={{ fontSize: 9, fill: 'var(--text-3)', fontFamily: FONT_MONO }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 9, fill: 'var(--text-3)', fontFamily: FONT_MONO }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip content={(props) => <ChartTooltip {...(props as unknown as Parameters<typeof ChartTooltip>[0])} />} />
                    <Bar dataKey="sessions" fill="var(--violet, #a78bfa)" radius={[2, 2, 0, 0]} name="sessions" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
            <div style={SECTION_BOX}>
              <div style={LABEL_STYLE}>Origin breakdown</div>
              {data.origins.length === 0 ? (
                <div style={{ color: 'var(--text-3)', fontSize: 11 }}>(no origin data)</div>
              ) : (
                <RankedBars
                  color="var(--cyan, #5eead4)"
                  entries={data.origins.slice(0, 12).map((o) => ({ label: o.kind, value: o.count }))}
                />
              )}
            </div>
          </div>
        )}

        {data && (
          <div style={SECTION_BOX}>
            <div style={LABEL_STYLE}>Message role mix</div>
            <RoleMixBar mix={data.roleMix} />
          </div>
        )}

        {/* === MODEL & COST DYNAMICS === */}
        {data && <SubHeader label="Model & cost dynamics" />}

        {data && (
          <div style={SECTION_BOX}>
            <div style={LABEL_STYLE}>Tokens by model over time</div>
            {data.dailyByModel.length === 0 || data.modelKeys.length === 0 ? (
              <div style={{ color: 'var(--text-3)', fontSize: 11 }}>(no model data in range)</div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={data.dailyByModel} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="day" tick={{ fontSize: 9, fill: 'var(--text-3)', fontFamily: FONT_MONO }} axisLine={false} tickLine={false} />
                    <YAxis
                      tick={{ fontSize: 9, fill: 'var(--text-3)', fontFamily: FONT_MONO }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v: number) => fmtNum(v)}
                    />
                    <Tooltip content={(props) => <ChartTooltip {...(props as unknown as Parameters<typeof ChartTooltip>[0])} formatter={fmtNum} />} />
                    {data.modelKeys.map((m, i) => (
                      <Area
                        key={m}
                        type="monotone"
                        dataKey={m}
                        stackId="m"
                        stroke={MODEL_COLORS[i % MODEL_COLORS.length]}
                        fill={MODEL_COLORS[i % MODEL_COLORS.length]}
                        fillOpacity={0.35}
                        name={m}
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 10, color: 'var(--text-3)', marginTop: 6 }}>
                  {data.modelKeys.map((m, i) => (
                    <span key={m} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 8, height: 8, background: MODEL_COLORS[i % MODEL_COLORS.length], borderRadius: 2 }} />
                      {m}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {data && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={SECTION_BOX}>
              <div style={LABEL_STYLE}>Cost by provider</div>
              {data.providers.every((p) => p.cost === 0) ? (
                <div style={{ color: 'var(--text-3)', fontSize: 11 }}>(no cost in range)</div>
              ) : (
                <RankedBars
                  color="var(--orange, #fb923c)"
                  formatter={fmtCost}
                  entries={data.providers.map((p) => ({ label: `${p.provider} · ${fmtNum(p.messages)} msgs`, value: p.cost }))}
                />
              )}
            </div>
            <div style={SECTION_BOX}>
              <div style={LABEL_STYLE}>Cost per message</div>
              {data.daily.length === 0 ? (
                <div style={{ color: 'var(--text-3)', fontSize: 11 }}>(no data in range)</div>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <ComposedChart data={data.daily} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="day" tick={{ fontSize: 9, fill: 'var(--text-3)', fontFamily: FONT_MONO }} axisLine={false} tickLine={false} />
                    <YAxis
                      tick={{ fontSize: 9, fill: 'var(--text-3)', fontFamily: FONT_MONO }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v: number) => fmtCost(v)}
                    />
                    <Tooltip content={(props) => <ChartTooltip {...(props as unknown as Parameters<typeof ChartTooltip>[0])} formatter={fmtCost} />} />
                    <Line type="monotone" dataKey="costPerMessage" stroke="var(--orange, #fb923c)" strokeWidth={2} dot={false} name="cost / msg" />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        )}

        {data && (
          <div style={SECTION_BOX}>
            <div style={LABEL_STYLE}>Contribution calendar</div>
            <ContributionCalendar daily={data.daily} range={data.range} />
          </div>
        )}

        {loading && !data && (
          <div style={{ ...SECTION_BOX, color: 'var(--text-3)', fontSize: 12 }}>Loading analytics…</div>
        )}
      </div>
    </div>
  )
}

const selectStyle: React.CSSProperties = {
  background: 'var(--surface-2)',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  padding: '4px 8px',
  fontSize: 11,
  fontFamily: FONT_MONO,
}

const dateInputStyle: React.CSSProperties = {
  background: 'var(--surface-2)',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  padding: '4px 6px',
  fontSize: 11,
  fontFamily: FONT_MONO,
}

function presetButtonStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? 'var(--accent, var(--cyan, #5eead4))' : 'var(--surface-2)',
    color: active ? 'var(--bg)' : 'var(--text-2)',
    border: '1px solid var(--border)',
    borderRadius: 4,
    padding: '4px 10px',
    fontSize: 11,
    fontFamily: FONT_MONO,
    cursor: 'pointer',
  }
}

const modelTh: React.CSSProperties = { padding: '4px 8px', fontWeight: 400, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase' }
const modelTd: React.CSSProperties = { padding: '6px 8px', color: 'var(--text-2)', fontFamily: FONT_MONO }
