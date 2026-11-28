/** @jsxImportSource @opentui/react */
// TUI entry for the Run dashboard: every session in scope as a run — what it
// is doing, whether it needs you, its project and how long since it moved —
// over the same `session-fleet` service the Web dashboard reads. Keys: j/k or
// ↑↓ move, ⏎ opens the run, f cycles the filter, Esc closes. Rows are clickable.
import { useEffect, useMemo, useState } from 'react'
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import type { Session } from '../../../lib/types'
import { fitText, getProviderAccent, MODAL_CONTENT_Z_INDEX, popoverFrameCells, popoverRootProps, sessionIdentityKey, type TuiPluginView, type TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'

type RunStatus = 'needs-you' | 'active' | 'waiting' | 'recent' | 'paused'
const FILTERS = ['all', 'live', 'needs-you'] as const
type Filter = (typeof FILTERS)[number]

const DAY_MS = 86_400_000
const age = (ms: number) => {
  if (!ms) return ''
  const minutes = Math.round((Date.now() - ms) / 60_000)
  return minutes < 1 ? 'now' : minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.round(minutes / 60)}h` : `${Math.round(minutes / 1440)}d`
}
const title = (session: Session) => (session.customTitle || session.summary || session.firstPrompt || session.sessionId).replace(/\s+/g, ' ').trim()
const project = (cwd: unknown) => typeof cwd === 'string' ? cwd.split('/').filter(Boolean).pop() ?? cwd : ''

/** The run's state: what the activity registry says, else how recently it moved — the Web dashboard's buckets. */
export function runStatus(state: 'needs-input' | 'running' | 'waiting' | undefined, lastModified: number, now = Date.now()): RunStatus {
  if (state === 'needs-input') return 'needs-you'
  if (state === 'running') return 'active'
  if (state === 'waiting') return 'waiting'
  return now - lastModified < DAY_MS ? 'recent' : 'paused'
}

function RunDashboard({ services, theme, accent, width, height, placement, registerKeys, close }: TuiPluginViewProps) {
  const fleet = services['session-fleet']!
  const docked = placement !== 'overlay'
  const [filter, setFilter] = useState<Filter>('all')
  const [cursor, setCursor] = useState(0)
  const rows = useMemo(() => {
    const alerts = new Map<string, number>()
    for (const alert of fleet.alerts) alerts.set(alert.sessionKey, (alerts.get(alert.sessionKey) ?? 0) + 1)
    return fleet.sessions
      .map(session => {
        const key = sessionIdentityKey(session)
        const lastModified = typeof session.lastModified === 'number' ? session.lastModified : 0
        return { key, session, status: runStatus(fleet.activity.get(key), lastModified), lastModified, alerts: alerts.get(key) ?? 0 }
      })
      .filter(row => filter === 'all' || (filter === 'live' ? row.status === 'active' || row.status === 'waiting' || row.status === 'needs-you' : row.status === 'needs-you' || row.alerts > 0))
      // Runs that need you first, then live ones, then by last movement.
      .sort((a, b) => Number(b.status === 'needs-you') - Number(a.status === 'needs-you') || Number(b.status === 'active') - Number(a.status === 'active') || b.lastModified - a.lastModified)
  }, [fleet.sessions, fleet.activity, fleet.alerts, filter])
  const counts = useMemo(() => {
    const all = fleet.sessions.map(session => runStatus(fleet.activity.get(sessionIdentityKey(session)), typeof session.lastModified === 'number' ? session.lastModified : 0))
    return { active: all.filter(status => status === 'active').length, needs: all.filter(status => status === 'needs-you').length, day: all.filter(status => status !== 'paused').length }
  }, [fleet.sessions, fleet.activity])
  const selected = Math.min(cursor, Math.max(rows.length - 1, 0))
  const open = (index: number) => { const row = rows[index]; if (!row) return; if (!docked) close(); fleet.open(row.session) }

  useEffect(() => {
    registerKeys((key) => {
      if (key.name === 'escape' || key.sequence === 'q') { close(); return true }
      if (key.name === 'down' || key.sequence === 'j') { setCursor(value => Math.min(value + 1, Math.max(rows.length - 1, 0))); return true }
      if (key.name === 'up' || key.sequence === 'k') { setCursor(value => Math.max(value - 1, 0)); return true }
      if (key.sequence === 'f') { setFilter(value => FILTERS[(FILTERS.indexOf(value) + 1) % FILTERS.length]!); setCursor(0); return true }
      if (key.name === 'return') { open(selected); return true }
      return !docked
    })
    return () => registerKeys(null)
  })

  const frame = popoverFrameCells(docked)
  const popW = docked ? width : Math.min(width - 4, 120)
  const popH = docked ? height : Math.min(height - 2, 34)
  const innerW = popW - frame - 2
  const bodyRows = Math.max(popH - frame - 3, 3)
  const start = Math.max(0, Math.min(selected - Math.floor(bodyRows / 2), rows.length - bodyRows))
  const statusStyle: Record<RunStatus, { glyph: string; color: string; label: string }> = {
    'needs-you': { glyph: '▲', color: theme.amber, label: 'needs you' },
    active: { glyph: '●', color: theme.green, label: 'active' },
    waiting: { glyph: '◐', color: theme.cyan, label: 'waiting' },
    recent: { glyph: '○', color: theme.muted, label: 'recent' },
    paused: { glyph: '·', color: theme.dim, label: 'paused' },
  }
  // Fixed columns: cursor 1, status 12, provider 9, project 15, age 5, alerts 4.
  const titleW = Math.max(innerW - 46, 12)
  return (
    <box id="run-dashboard" {...popoverRootProps(docked, { top: Math.max(Math.floor((height - popH) / 2), 0), left: Math.max(Math.floor((width - popW) / 2), 0), width: popW, height: popH }, MODAL_CONTENT_Z_INDEX)}
      {...(docked ? {} : { border: true, borderStyle: 'single' as const, borderColor: theme.border2 })}
      backgroundColor={theme.surface} flexDirection="column" title={docked ? undefined : ' Run dashboard '} titleColor={accent}>
      <box paddingX={1} backgroundColor={theme.surface2}>
        <text wrapMode="none">
          <span fg={theme.text}>{`${fleet.sessions.length} runs`}</span>
          <span fg={theme.dim}>{'  ·  '}</span>
          <span fg={counts.active ? theme.green : theme.dim}>{`${counts.active} active`}</span>
          <span fg={theme.dim}>{'  ·  '}</span>
          <span fg={counts.needs ? theme.amber : theme.dim}>{`${counts.needs} need you`}</span>
          <span fg={theme.dim}>{`  ·  ${counts.day} in 24h  ·  filter `}</span>
          <span fg={theme.cyan}>{filter}</span>
        </text>
      </box>
      <box height={bodyRows} flexDirection="column" paddingX={1}>
        {rows.length === 0 ? <text fg={theme.dim}>{filter === 'all' ? 'No sessions in scope.' : 'No run matches this filter · f cycles it'}</text>
          : rows.slice(start, start + bodyRows).map((row, offset) => {
            const index = start + offset
            const style = statusStyle[row.status]
            const isSelected = index === selected
            return (
              <box key={row.key} id={`run-row:${row.key}`} flexDirection="row" backgroundColor={isSelected ? theme.surface3 : theme.surface} onMouseDown={() => { setCursor(index); open(index) }}>
                <text wrapMode="none" selectable={false}>
                  <span fg={accent}>{isSelected ? '▎' : ' '}</span>
                  <span fg={style.color}>{`${style.glyph} ${style.label.padEnd(9)} `}</span>
                  <span fg={isSelected ? theme.text : theme.muted}>{fitText(title(row.session), titleW).padEnd(titleW)}</span>
                  <span fg={getProviderAccent(row.session.provider ?? 'claude')}>{` ${fitText(row.session.provider ?? '', 8).padEnd(8)}`}</span>
                  <span fg={theme.dim}>{` ${fitText(project(row.session.cwd), 14).padEnd(14)}`}</span>
                  <span fg={theme.dim}>{` ${age(row.lastModified).padStart(4)}`}</span>
                  <span fg={theme.amber}>{row.alerts ? ` !${String(row.alerts).padEnd(2)}` : ''}</span>
                </text>
              </box>
            )
          })}
      </box>
      <box paddingX={1} backgroundColor={theme.surface2}>
        <text fg={theme.dim} wrapMode="none">{fitText('j/k move · ⏎ open · f filter · esc close', innerW)}</text>
      </box>
    </box>
  )
}

export const module: PluginViewModule<TuiPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'run-dashboard',
  views: { 'run-dashboard': RunDashboard },
}
