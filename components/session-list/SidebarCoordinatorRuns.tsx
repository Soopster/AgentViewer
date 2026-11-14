'use client'
// The rail's Coordinator tab, the TUI's: each run a `TITLE / n` heading in its
// status colour, each agent one row (name in its provider's colour, then its
// state). A run's agents load when it is opened; the list polls like the
// session list.
import { useEffect, useState } from 'react'

type RunSummary = { id: string; prompt: string; status: string; provider?: string; updatedAt?: string | number }
type RunAgent = { id: string; name: string; status: string; provider?: string; role?: string; sessionId?: string | null }

const POLL_MS = 5000
const STATUS_COLOR: Record<string, string> = {
  running: 'var(--cyan)', planning: 'var(--violet)', completed: 'var(--green)', failed: 'var(--red)', stopped: 'var(--text-3)', cancelled: 'var(--text-3)',
}
const AGENT_GLYPH: Record<string, string> = { working: '●', idle: '○', blocked: '▲', failed: '×', done: '✓', completed: '✓' }

function runTitle(prompt: string): string {
  return (prompt.split('\n')[0] ?? '').trim() || 'Untitled run'
}

export function SidebarCoordinatorRuns({ onOpenRun }: { onOpenRun: (runId: string) => void }) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [agents, setAgents] = useState<Record<string, RunAgent[]>>({})

  useEffect(() => {
    let cancelled = false
    const poll = () => void fetch('/api/agent-protocol/runs?limit=30').then(async (response) => {
      const body = await response.json() as { runs?: RunSummary[]; error?: string }
      if (cancelled) return
      if (!response.ok) { setError(body.error ?? `HTTP ${response.status}`); return }
      setRuns(body.runs ?? [])
      setError(null)
    }).catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)) })
    poll()
    const id = window.setInterval(poll, POLL_MS)
    return () => { cancelled = true; window.clearInterval(id) }
  }, [])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void fetch(`/api/agent-protocol/runs/${encodeURIComponent(open)}`).then(async (response) => {
      const body = await response.json() as { agents?: RunAgent[] }
      if (!cancelled && response.ok) setAgents((current) => ({ ...current, [open]: body.agents ?? [] }))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [open])

  if (error) return <div style={{ padding: 16, fontSize: 12, color: 'var(--red)' }}>{error}</div>
  if (!runs) return <div style={{ padding: 16, fontSize: 12, color: 'var(--text-3)' }}>Loading runs…</div>
  if (runs.length === 0) return <div style={{ padding: 16, fontSize: 12, color: 'var(--text-3)' }}>No Coordinator runs yet.</div>
  return (
    <div data-testid="sidebar-coordinator-runs">
      {runs.map((run) => {
        const color = STATUS_COLOR[run.status] ?? 'var(--text-2)'
        const runAgents = agents[run.id]
        const expanded = open === run.id
        return (
          <div key={run.id} style={{ borderBottom: '1px solid var(--border)' }}>
            <div className="av-hover-control" onClick={() => setOpen(expanded ? null : run.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', cursor: 'pointer', userSelect: 'none' }}>
              <span style={{ fontSize: 9, color: 'var(--text-3)' }}>{expanded ? '▼' : '▶'}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, color, textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={run.prompt}>
                {runTitle(run.prompt)}
              </span>
              {runAgents ? <span style={{ fontSize: 11, color: 'var(--text-3)' }}>/ {runAgents.length}</span> : null}
              <button type="button" onClick={(event) => { event.stopPropagation(); onOpenRun(run.id) }} title="Open in the Coordinator"
                style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-2)', cursor: 'pointer' }}>open</button>
            </div>
            {expanded ? (
              runAgents ? runAgents.map((agent) => (
                <div key={agent.id} style={{ display: 'flex', gap: 6, padding: '3px 14px 3px 30px', fontSize: 12 }}>
                  <span style={{ color: 'var(--text-3)' }}>{AGENT_GLYPH[agent.status] ?? '·'}</span>
                  <span style={{ color: 'var(--text-1)' }}>{agent.name}</span>
                  <span style={{ marginLeft: 'auto', color: 'var(--text-3)', fontSize: 11 }}>{agent.provider ?? ''} · {agent.status}</span>
                </div>
              )) : <div style={{ padding: '3px 30px', fontSize: 11, color: 'var(--text-3)' }}>Loading agents…</div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
