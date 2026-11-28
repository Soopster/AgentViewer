'use client'

// Web entry for the Desk: the TUI's Bloomberg-style workspace, drawn from the
// same model (plugins/desk/tui/deskModel.ts). Mnemonics on the command line
// run with Enter (<GO>): MON TOP DES GP WEI MOST ALRT CN HELP; `LAY 1|2|3|4|6`
// picks the launchpad; a number loads that row of the active panel; anything
// else searches. Its colours are fixed, as on the terminal.
import { useEffect, useMemo, useRef, useState } from 'react'
import { PLUGIN_API_VERSION, type PluginViewModule } from '@/lib/plugins/types'
import type { WebPluginView, WebPluginViewProps } from '@/components/shell/pluginTypes'
import type { Session } from '@/lib/types'
import { liveStatesFromRegistry } from '@/lib/sessionSidebarModel'
import {
  buildDeskChart, buildDeskTable, DEFAULT_PANEL_FUNCTIONS, deskCardsFromMessages, deskFunction, DESK_FUNCTIONS, deskPanelCount, deskSessionKey, deskSessionTime,
  parseDeskCommand, type DeskActivity, type DeskFunctionId, type DeskLayoutId, type DeskTable, type DeskTone,
} from '../tui/deskModel'

const C = { bg: '#000000', chrome: '#1a1a1a', header: '#141414', stripe: '#0b0b0b', border: '#3a3a3a', amber: '#fb8b1e', text: '#f2f2f2', flat: '#bdbdbd', dim: '#6b6b6b', up: '#4af6c3', down: '#ff433d', yellow: '#ffd100', blue: '#4aa8ff', key: '#d9822b', focus: '#ffd100' }
const TONE: Record<DeskTone, string> = { text: C.text, label: C.amber, up: C.up, down: C.down, flat: C.flat, alert: C.yellow, link: C.blue, dim: C.dim, key: C.key }
const GRID: Record<DeskLayoutId, string> = { '1': '1fr / 1fr', '2': '1fr / 1fr 1fr', '3': '1fr / 1fr 1fr 1fr', '4': '1fr 1fr / 1fr 1fr', '6': '1fr 1fr / 1fr 1fr 1fr' }
const mono = "'IBM Plex Mono', ui-monospace, monospace"

function Table({ table, onRow }: { table: DeskTable; onRow: (index: number) => void }) {
  return (
    <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
      {table.summary ? <div style={{ padding: '2px 6px', background: C.header, whiteSpace: 'nowrap' }}>{table.summary.map((cell, i) => <span key={i} style={{ color: TONE[cell.tone ?? 'text'], fontWeight: cell.bold ? 700 : 400 }}>{cell.text}</span>)}</div> : null}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead><tr>{table.columns.map((column, i) => <th key={i} style={{ color: C.amber, textAlign: column.align ?? 'left', fontWeight: 600, padding: '2px 6px', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>{column.title}</th>)}</tr></thead>
        <tbody>
          {table.rows.length === 0 ? <tr><td colSpan={table.columns.length} style={{ color: C.dim, padding: 6 }}>{table.empty ?? 'NO DATA'}</td></tr>
            : table.rows.map((row, index) => (
              <tr key={row.key} data-desk-row={row.sessionKey ?? row.functionId ?? row.key} onClick={() => onRow(index)} style={{ background: index % 2 ? C.stripe : 'transparent', cursor: row.sessionKey || row.functionId ? 'pointer' : 'default' }}>
                {row.cells.map((cell, i) => <td key={i} style={{ color: TONE[cell.tone ?? 'text'], fontWeight: cell.bold ? 700 : 400, padding: '1px 6px', textAlign: table.columns[i]?.align ?? 'left', whiteSpace: 'nowrap', maxWidth: table.columns[i]?.width === 'flex' ? 360 : undefined, overflow: 'hidden', textOverflow: 'ellipsis' }}>{cell.text}</td>)}
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  )
}

function Desk({ services, placement, close, useState: useScopedState }: WebPluginViewProps) {
  const fleet = services['session-fleet']!
  const docked = placement !== 'overlay'
  const [layout, setLayout] = useScopedState<DeskLayoutId>('layout', '4')
  const [functions, setFunctions] = useScopedState<DeskFunctionId[]>('functions', DEFAULT_PANEL_FUNCTIONS)
  const [active, setActive] = useState(0)
  const [command, setCommand] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [activity, setActivity] = useState<ReadonlyMap<string, DeskActivity>>(new Map())
  const [now, setNow] = useState(() => Date.now())
  const input = useRef<HTMLInputElement>(null)
  // The same registry the sidebar polls: running, waiting, needs you.
  useEffect(() => {
    let live = true
    const poll = () => void fetch('/api/sessions/running').then(async response => {
      if (!response.ok || !live) return
      setActivity(liveStatesFromRegistry(await response.json()) as ReadonlyMap<string, DeskActivity>)
      setNow(Date.now())
    }).catch(() => {})
    poll()
    const timer = window.setInterval(poll, 3000)
    return () => { live = false; window.clearInterval(timer) }
  }, [])
  useEffect(() => {
    if (docked) return undefined
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [docked, close])

  const loaded = fleet.selected
  // The loaded session's transcript as the desk's stories (CN) and counts (DES).
  const loadedCards = useMemo(() => (loaded ? deskCardsFromMessages(fleet.selectedMessages) : null), [loaded, fleet.selectedMessages])
  const tableInput = useMemo(() => ({
    sessions: fleet.sessions, activity, upticks: new Set<string>(), now, alerts: [],
    loaded, loadedCards, loadedContext: null, loadedModel: null, loadedMessageCount: loaded ? fleet.selectedMessages.length : null,
    chartWidth: 60, chartHeight: 8,
  }), [fleet.sessions, activity, now, loaded, loadedCards, fleet.selectedMessages.length])
  const panels = functions.slice(0, deskPanelCount(layout))
  const tables = panels.map(fn => buildDeskTable(fn, tableInput))
  const times = useMemo(() => fleet.selectedMessages.map(message => message.timestamp ? Date.parse(message.timestamp) : 0).filter(time => time > 0), [fleet.selectedMessages])

  const loadRow = (panel: number, index: number) => {
    const row = tables[panel]?.rows[index]
    if (!row) return
    if (row.functionId) { setFunctions(current => current.map((fn, i) => i === panel ? row.functionId! : fn)); return }
    const session = fleet.sessions.find(entry => deskSessionKey(entry) === row.sessionKey)
    if (session) fleet.select(session)
  }
  const go = () => {
    const parsed = parseDeskCommand(command)
    setCommand(''); setNotice(null)
    if (parsed.kind === 'function') setFunctions(current => current.map((fn, i) => i === active ? parsed.id : fn))
    else if (parsed.kind === 'layout') { setLayout(parsed.layout); setActive(0) }
    else if (parsed.kind === 'row') loadRow(active, parsed.row - 1)
    else if (parsed.kind === 'exit') close()
    else if (parsed.kind === 'search') {
      const query = parsed.query.toLowerCase()
      const hit = fleet.sessions.find((session: Session) => [session.customTitle, session.summary, session.firstPrompt, session.cwd].some(value => value?.toLowerCase().includes(query)))
      if (hit) fleet.select(hit); else setNotice(`NO SECURITY MATCHES ${parsed.query.toUpperCase()}`)
    } else if (parsed.kind === 'open' || parsed.kind === 'theme') setNotice('Not on the Web desk: open the session from the sidebar, or switch theme from the palette')
  }

  const body = (
    <div data-plugin-view="desk" onClick={() => input.current?.focus()} style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: C.bg, color: C.text, fontFamily: mono, fontSize: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', background: C.chrome }}>
        <span style={{ color: C.amber, fontWeight: 700 }}>DESK</span>
        <input ref={input} autoFocus aria-label="Desk command" value={command} placeholder="MON TOP DES GP WEI MOST ALRT CN HELP · LAY 4 · <GO>"
          onChange={event => setCommand(event.target.value.toUpperCase())} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); go() } }}
          style={{ flex: 1, background: '#000', color: C.yellow, border: `1px solid ${C.border}`, fontFamily: mono, fontSize: 12, padding: '3px 6px', textTransform: 'uppercase' }} />
        <span style={{ color: C.dim }}>{fleet.sessions.length} SECURITIES · {[...activity.values()].filter(state => state === 'running').length} LIVE</span>
        {!docked ? <button type="button" aria-label="Close" onClick={close} style={{ background: '#d7191f', color: '#fff', border: 'none', fontFamily: mono, fontSize: 11, padding: '2px 8px' }}>CANCEL</button> : null}
      </div>
      {notice ? <div role="status" style={{ padding: '2px 8px', background: '#a3161c', color: '#fff' }}>{notice}</div> : null}
      <div style={{ flex: 1, minHeight: 0, display: 'grid', grid: GRID[layout], gap: 2, padding: 2 }}>
        {panels.map((fn, panel) => {
          const table = tables[panel]
          const chart = fn === 'GP' && loaded ? buildDeskChart(times, 60, 8, 'msgs') : null
          return (
            <section key={panel} data-desk-panel={fn} onClick={() => setActive(panel)}
              style={{ display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, border: `1px solid ${panel === active ? C.focus : C.border}` }}>
              <div style={{ display: 'flex', gap: 8, padding: '2px 6px', background: C.header }}>
                <span style={{ color: C.amber, fontWeight: 700 }}>{fn}</span>
                <span style={{ color: C.flat, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{deskFunction(fn).title}</span>
                <span style={{ color: C.dim }}>{panel + 1}</span>
              </div>
              {table ? <Table table={table} onRow={index => loadRow(panel, index)} />
                : fn === 'GP' ? (chart
                  ? <pre style={{ margin: 0, padding: 6, color: C.up, lineHeight: 1.1, overflow: 'auto' }}>{chart.plot.join('\n')}{'\n'}<span style={{ color: C.dim }}>{chart.timeAxis}</span>{'\n'}<span style={{ color: C.amber }}>HIGH {chart.high} · LAST {chart.last} · TOTAL {chart.total} {chart.unit}</span></pre>
                  : <div style={{ padding: 6, color: C.dim }}>{loaded ? 'NO PRINTS TO CHART' : 'LOAD A SECURITY TO CHART IT'}</div>)
                : null}
            </section>
          )
        })}
      </div>
      <div style={{ padding: '2px 8px', background: C.chrome, color: C.dim, whiteSpace: 'nowrap', overflow: 'hidden' }}>
        {DESK_FUNCTIONS.map(fn => <span key={fn.id} style={{ marginRight: 12 }}><span style={{ color: C.key }}>{fn.id}</span> {fn.title}</span>)}
        {loaded ? <span style={{ color: C.amber }}> · LOADED {deskSessionKey(loaded)} · {new Date(deskSessionTime(loaded) || now).toLocaleTimeString()}</span> : null}
      </div>
    </div>
  )
  if (docked) return body
  return (
    <div role="dialog" aria-label="Desk" onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.55)' }}>
      <div onClick={event => event.stopPropagation()} style={{ width: 'min(1400px, calc(100vw - 24px))', height: 'min(880px, calc(100vh - 24px))', border: `1px solid ${C.border}`, overflow: 'hidden' }}>{body}</div>
    </div>
  )
}

export const module: PluginViewModule<WebPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'desk',
  views: { desk: Desk },
}
