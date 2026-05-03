'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
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
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  if (max === 0) return <div style={{ color: 'var(--text-3)', fontSize: 11 }}>(no data)</div>
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '40px repeat(24, 1fr)', gap: 2, fontFamily: FONT_MONO, fontSize: 9 }}>
      <div />
      {Array.from({ length: 24 }, (_, h) => (
        <div key={h} style={{ color: 'var(--text-3)', textAlign: 'center' }}>
          {h % 3 === 0 ? h : ''}
        </div>
      ))}
      {days.map((day, dow) => (
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

export default function AnalyticsPage() {
  const [provider, setProvider] = useState<ProviderSelection>('all')
  const [dir, setDir] = useState<string>('all')
  const [preset, setPreset] = useState<Preset>('30d')
  const [customFrom, setCustomFrom] = useState<string>('')
  const [customTo, setCustomTo] = useState<string>('')
  const [data, setData] = useState<CrossSessionAnalytics | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
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

  // One-time backfill so existing message rows pick up the model column.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.localStorage.getItem('analytics:backfilled') === '1') return
    if (backfillState !== 'idle') return
    setBackfillState('running')
    fetch('/api/session-index/rebuild', { method: 'POST' })
      .then(() => {
        window.localStorage.setItem('analytics:backfilled', '1')
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
                onClick={() => setPreset(p.id)}
                style={presetButtonStyle(preset === p.id)}
              >
                {p.label}
              </button>
            ))}
            <button
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
          </>
        )}

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
