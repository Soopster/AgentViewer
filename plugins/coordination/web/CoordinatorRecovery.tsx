'use client'
import { useState } from 'react'
import type { CoordinatorInteractiveState } from '@/lib/coordinatorInteractiveState'
import { recoveryOverview, type RecoveryInspection } from '@/lib/coordinatorRecovery'
import { Button } from '@/components/ui/button'

export default function CoordinatorRecovery({ state, endpoint, provider, disabled, pendingRequest, onInspect, onResume, onReconcile }: {
  state: CoordinatorInteractiveState | null; endpoint: string; provider: string; disabled: boolean; pendingRequest: string | null
  onInspect: (id: string) => void; onResume: (id: string) => void; onReconcile: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [inspection, setInspection] = useState<RecoveryInspection | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState<string | null>(null)
  async function check() {
    setBusy(true); setError(''); setConfirm(null)
    try {
      const response = await fetch(`${endpoint}?${new URLSearchParams({ provider, inspect: 'recovery' })}`, { cache: 'no-store', signal: AbortSignal.timeout(6000) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Recovery inspection failed')
      setInspection(data.inspection)
    } catch (error) { setInspection(null); setError(String(error)) }
    finally { setBusy(false) }
  }
  const rows = recoveryOverview(state, inspection, pendingRequest)
  return <div className="rounded border p-2"><Button variant="ghost" disabled={busy} onClick={() => { setOpen(!open); if (!open) void check() }}>Team recovery overview{state?.recoveries.length || state?.settledExecutions?.length ? ` · ${state.recoveries.length + (state.settledExecutions?.length ?? 0)} need inspection` : ''}</Button>
    {open ? <div className="space-y-2">
      <p className="text-sm text-muted-foreground">Refreshing reconnects observation. It never resends a task. Inaccessible teammates remain here with their saved identities and paths.</p>
      <Button variant="outline" disabled={busy} onClick={() => void check()}>{busy ? 'Checking availability…' : 'Refresh availability'}</Button>
      {error ? <p role="alert">{error}</p> : null}
      {rows.map(row => <div key={row.id} className="rounded border p-2"><p className="font-medium">{row.title}</p>{row.detail.map((line, index) => <p key={index} className="break-words text-sm">{line}</p>)}
        {row.agentId ? <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => onInspect(row.agentId!)}>Inspect transcript</Button>
          {row.canReconcile ? <Button disabled={disabled || busy} onClick={() => { if (confirm === row.id) { onReconcile(row.agentId!); setConfirm(null) } else setConfirm(row.id) }}>{confirm === row.id ? 'Confirm acknowledgement; no new turn' : 'Acknowledge inspected result'}</Button> : null}
          {row.canResume ? confirm === row.id ? <><p>Resume this saved conversation and its owned task after inspecting the transcript?</p><Button disabled={disabled || busy} onClick={() => { onResume(row.agentId!); setConfirm(null) }}>Confirm resume</Button><Button variant="ghost" onClick={() => setConfirm(null)}>Keep paused</Button></> : <Button disabled={disabled || busy} onClick={() => setConfirm(row.id)}>Resume after inspection</Button> : null}</div> : null}
      </div>)}
    </div> : null}
  </div>
}
