'use client'

import { coordinatorAttentionCount } from '@/lib/coordinatorAttentionCount'
import { coordinatorAgentActivity, coordinatorStalledAgentIds, type CoordinatorInteractiveState } from '@/lib/coordinatorInteractiveState'
import { useEffect, useId, useRef, useState } from 'react'
import type { Session } from '@/lib/types'
import type { ProtocolAgent, ProtocolRunSnapshot } from '@/lib/agentProtocol'
import { coordinatorAttention, type CoordinatorAttentionItem } from '@/lib/coordinatorAttention'
import { COORDINATOR_NOTIFICATION_DELAY_MS, coordinatorResultIdsForAgent, coordinatorRosterOrder, coordinatorSignals, coordinatorSignalSuppressed, newCoordinatorSignals } from '@/lib/coordinatorSignals'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'

type RequestBody = {
  action: 'disable' | 'enable' | 'settings' | 'reconcile' | 'resume-agent' | 'delegate' | 'message' | 'review-plan' | 'decision'
  provider: Session['provider']; requestId: string; detail: string; to?: string; paths?: string[]
  cwd?: string; autoContinue?: boolean; useWorktrees?: boolean; batchId?: string; received?: boolean
  taskId?: string; decisionId?: string; approved?: boolean; inReplyTo?: string
}

export default function CoordinatorConversation({ session, onInspect, onReturnToChat, onAttentionChange }: {
  session: Session; onInspect: (agent: ProtocolAgent) => void; onReturnToChat: () => void; onAttentionChange: (count: number) => void
}) {
  const id = useId()
  const [state, setState] = useState<CoordinatorInteractiveState | null>(null)
  const snapshot = state?.snapshot ?? null
  const [detail, setDetail] = useState('')
  const [to, setTo] = useState('auto')
  const [paths, setPaths] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [seen, setSeen] = useState<string[]>([])
  const revision = useRef(0)
  const pending = useRef<RequestBody | null>(null)
  const requestKey = `coordinator:request:v1:${session.provider}:${session.sessionId}`
  const seenKey = `coordinator:seen:v1:${session.provider}:${session.sessionId}`
  const endpoint = `/api/sessions/${encodeURIComponent(session.sessionId)}/coordination`
  useEffect(() => {
    try {
      setSeen(JSON.parse(localStorage.getItem(seenKey) || '[]'))
      const stored = sessionStorage.getItem(requestKey)
      if (stored) {
        pending.current = JSON.parse(stored)
        setError('A previous submission is unconfirmed. Retry the same request to reconcile it.')
      }
    } catch { /* Storage may be disabled. In-memory retry remains available. */ }
    let disposed = false
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    let refreshing = false
    let changes: EventSource | null = null
    // Transitions only, per lib/coordinatorSignals.ts: the first read is a
    // baseline, and a visible, focused page is already looking at this team.
    let signalBaseline: Set<string> | null = null
    const notificationTimers = new Set<ReturnType<typeof setTimeout>>()
    function notifyTransitions(data: CoordinatorInteractiveState) {
      const signals = coordinatorSignals(data)
      const fresh = newCoordinatorSignals(signalBaseline, signals)
      signalBaseline = new Set(signals.map(signal => signal.id))
      if (!fresh.length || typeof Notification === 'undefined' || Notification.permission !== 'granted') return
      // Held briefly and dropped if resolved meanwhile; focus is judged at delivery.
      const timer = setTimeout(() => {
        notificationTimers.delete(timer)
        const current = fresh.filter(signal => signalBaseline?.has(signal.id))
        if (disposed || !current.length || coordinatorSignalSuppressed(!document.hidden, document.hasFocus())) return
        for (const signal of current.slice(0, 3)) {
          try { new Notification(signal.title, { body: signal.detail.slice(0, 160), tag: `coordinator:${signal.id}` }) } catch { /* Unsupported context. */ }
        }
      }, COORDINATOR_NOTIFICATION_DELAY_MS)
      notificationTimers.add(timer)
    }
    async function refresh() {
      if (refreshing || disposed) return
      clearTimeout(timer)
      refreshing = true
      const observedRevision = revision.current
      try {
        const response = await fetch(`${endpoint}?provider=${session.provider}`, { signal: controller.signal })
        if (!response.ok) throw new Error('Could not refresh teammate state')
        const data = await response.json()
        if (!disposed && data.snapshot && !changes) {
          changes = new EventSource('/api/agent-protocol/runs/changes')
          changes.onmessage = () => { void refresh() }
        }
        if (!disposed && observedRevision === revision.current) { setState(data); setNotice(''); notifyTransitions(data) }
      } catch {
        if (!disposed && observedRevision === revision.current) setNotice('Teammate state is unavailable; showing the last observation.')
      } finally {
        refreshing = false
        if (!disposed) timer = setTimeout(refresh, 5000)
      }
    }
    void refresh()
    return () => { disposed = true; changes?.close(); controller.abort(); clearTimeout(timer); for (const pending of notificationTimers) clearTimeout(pending) }
  }, [endpoint, session.provider, requestKey, seenKey])

  async function send(body?: Omit<RequestBody, 'provider' | 'requestId'>) {
    if (busy) return
    const request = pending.current ?? (body ? { ...body, cwd: session.cwd, provider: session.provider, requestId: crypto.randomUUID() } : null)
    if (!request) return
    pending.current = request
    try { sessionStorage.setItem(requestKey, JSON.stringify(request)) } catch { /* Optional persistence. */ }
    revision.current += 1
    setBusy(true); setError('')
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Request could not be confirmed')
      revision.current += 1
      setState(data); setNotice(''); if (request.action === 'disable') onReturnToChat(); if (request.action === 'delegate' || request.action === 'message') setDetail(''); pending.current = null
      try { sessionStorage.removeItem(requestKey) } catch { /* Optional persistence. */ }
    } catch (error) { setError(error instanceof Error ? error.message : 'Request could not be confirmed') }
    finally { setBusy(false) }
  }
  // Herdr marks a completion seen when its agent is focused; reading a teammate's transcript is that focus.
  function inspect(agent: ProtocolAgent) { markSeenIds(coordinatorResultIdsForAgent(snapshot, agent.id)); onReturnToChat(); onInspect(agent) }
  function markSeen(item: CoordinatorAttentionItem) { markSeenIds([item.id]) }
  function markSeenIds(ids: string[]) {
    if (!ids.length || ids.every(id => seen.includes(id))) return
    const next = [...seen.filter(id => !ids.includes(id)), ...ids].slice(-500)
    setSeen(next)
    try { localStorage.setItem(seenKey, JSON.stringify(next)) } catch { /* Optional persistence. */ }
  }
  const attentionCount = coordinatorAttentionCount(state, seen) + Number(Boolean(error && pending.current))
  useEffect(() => { onAttentionChange(attentionCount) }, [attentionCount, onAttentionChange])
  const items = snapshot ? coordinatorAttention(snapshot) : []
  const visible = items.filter(item => item.kind !== 'result' || !seen.includes(item.id))
  const elsewhere = state?.interactive.executionElsewhere === true
  const locked = busy || Boolean(error && pending.current) || elsewhere
  const terminal = snapshot ? ['completed', 'failed', 'stopped'].includes(snapshot.run.status) : false
  const canLead = !snapshot || snapshot.agents.some(agent => agent.role === 'lead' && agent.sessionId === session.sessionId)
  const disabled = locked || terminal || !canLead
  const nativeAttention = state?.permissions.filter(item => item.agentId !== snapshot?.run.leadAgentId) ?? []
  return <section className="av-coord-conversation" aria-label="Conversation teammates">
    {elsewhere ? <p role="status">Running in another host. Use that window or connect the TUI to its server to control this team. Transcripts remain available here.</p> : null}
    <div className="av-coord-conversation-heading"><strong>Teammates{visible.length + nativeAttention.length ? ` · ${visible.length + nativeAttention.length} need attention` : ''}</strong>
    {terminal ? <span className="text-sm text-muted-foreground">Coordinator off</span> : null}
    {terminal || !state?.interactive.enabled ? <Button size="sm" variant="outline" disabled={locked || !canLead} onClick={() => { requestTeammateNotifications(); void send({ action: 'enable', detail: 'Enable interactive coordination' }) }}>Enable coordinator</Button> : <span className="text-sm text-muted-foreground">Coordinator on</span>}
    {state?.interactive.enabled && !terminal ? <Button size="sm" variant="ghost" disabled={locked || !canLead} title="Stop teammate work and automatic continuation; keep conversation history" onClick={() => void send({ action: 'disable', detail: 'Turn off coordination for this conversation' })}>Turn off</Button> : null}
    </div>
    <div id={`${id}-body`} className="av-coord-conversation-body">
    {state?.interactive.enabled ? <label className="av-coord-continuation"><input type="checkbox" checked={pending.current?.action === 'settings' ? pending.current.autoContinue ?? state.interactive.autoContinue : state.interactive.autoContinue} disabled={disabled} onChange={event => void send({ action: 'settings', detail: 'Update automatic continuation', autoContinue: event.target.checked })} />Continue when teammates respond</label> : null}
    {state?.interactive.enabled && snapshot ? <label className="av-coord-continuation" title="Applies to teammates started after the change"><input type="checkbox" checked={pending.current?.action === 'settings' ? pending.current.useWorktrees ?? snapshot.run.useWorktrees !== false : snapshot.run.useWorktrees !== false} disabled={disabled} onChange={event => void send({ action: 'settings', detail: 'Update teammate worktrees', useWorktrees: event.target.checked })} />Give new teammates their own worktree</label> : null}
    {state?.interactive.autoContinue && state.interactive.remainingTurns === 0 ? <p role="status">Automatic continuation paused after four turns. Send a message to continue.</p> : null}
    {state?.interactive.delivery && !state.interactive.delivery.active ? <div role="alert" className="rounded border p-3">
      <p>A previous lead delivery is unconfirmed. Inspect this conversation before choosing whether its mail arrived.</p>
      <Button disabled={locked} onClick={() => void send({ action: 'reconcile', detail: 'Confirmed delivery in transcript', batchId: state.interactive.delivery!.batchId, received: true })}>Mail was received</Button>
      <Button variant="outline" disabled={locked} onClick={() => void send({ action: 'reconcile', detail: 'Confirmed mail was not received', batchId: state.interactive.delivery!.batchId, received: false })}>Mail was not received · requeue</Button>
    </div> : null}
    {snapshot && state ? <TeammateRoster snapshot={snapshot} state={state} seen={seen} observationUnavailable={Boolean(notice)} onOpen={inspect} onFollowup={agent => { setTo(agent.id); setDetail(`Follow up with ${agent.name}: `) }} disabled={disabled} /> : null}
    {nativeAttention.map(item => <div key={`${item.agentId}:${item.permission.id}`} className="flex items-center justify-between gap-2 rounded border p-2" role="status"><span>{item.agentName}: {item.permission.title}</span><Button variant="outline" size="sm" onClick={() => { const agent = snapshot?.agents.find(agent => agent.id === item.agentId); if (agent) inspect(agent) }}>Inspect and answer</Button></div>)}
    {state?.recoveries.map(agentId => <div key={agentId} className="flex flex-wrap items-center gap-2 rounded border p-2"><span>{snapshot?.agents.find(agent => agent.id === agentId)?.name}: execution needs reconciliation</span><Button variant="outline" size="sm" onClick={() => { const agent = snapshot?.agents.find(agent => agent.id === agentId); if (agent) inspect(agent) }}>Inspect</Button><Button size="sm" disabled={disabled} onClick={() => void send({ action: 'resume-agent', to: agentId, detail: 'Resume after inspecting the teammate transcript' })}>Resume after inspection</Button></div>)}
    {notice ? <p role="status" className="text-sm">{notice}</p> : null}
      {!terminal ? <>
      <label htmlFor={`${id}-target`}>Send to</label>
      <NativeSelect id={`${id}-target`} value={to} disabled={disabled} onChange={event => setTo(event.target.value)}>
        <option value="auto">Available teammate or a new one</option>
        {snapshot?.agents.filter(agent => agent.role === 'teammate').map(agent => <option key={agent.id} value={agent.id}>{agent.name} · {agent.status}</option>)}
      </NativeSelect>
      <label htmlFor={`${id}-detail`}>Task or follow-up</label>
      <Textarea id={`${id}-detail`} value={detail} maxLength={8000} disabled={disabled} onChange={event => setDetail(event.target.value)} placeholder="Review the changes and report actionable findings." rows={2} />
      <details><summary>Files the teammate may edit</summary><label htmlFor={`${id}-paths`}>Write paths, one per line</label>
        <Textarea id={`${id}-paths`} value={paths} disabled={disabled} onChange={event => setPaths(event.target.value)} rows={2} />
      </details>
      <div className="flex flex-wrap gap-2">
        <Button disabled={disabled || !detail.trim()} onClick={() => void send({ action: 'delegate', detail, to, paths: paths.split('\n').map(value => value.trim()).filter(Boolean) })}>Ask teammate</Button>
        <Button variant="outline" disabled={disabled || to === 'auto' || !detail.trim()} onClick={() => void send({ action: 'message', detail, to })}>Message working teammate</Button>
      </div>
      </> : null}
      {error ? <div role="alert"><p>{error}</p><Button disabled={busy} onClick={() => void send()}>Retry same request</Button><Button variant="ghost" disabled={busy} onClick={() => { pending.current = null; setError(''); try { sessionStorage.removeItem(requestKey) } catch { /* Optional persistence. */ } }}>Edit after checking task history</Button></div> : null}
      {terminal ? <p>This run has ended. Its results and teammate transcripts remain available.</p> : null}
      {visible.map(item => <AttentionCard key={item.id} item={item} disabled={disabled} onSeen={() => markSeen(item)} onAction={body => void send(body)} />)}
      {snapshot ? <details><summary>Task history ({snapshot.tasks.length})</summary>{snapshot.tasks.map(task => <p key={task.id} className="whitespace-pre-wrap py-2">{task.title} · {task.status}{task.resultSummary ? `\n${task.resultSummary}` : ''}</p>)}</details> : null}
    </div>
  </section>
}

/** Asked from the enabling click: browsers only grant permission to a user gesture. */
function requestTeammateNotifications() {
  try { if (typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission() } catch { /* Unsupported context. */ }
}

function TeammateRoster({ snapshot, state, seen, observationUnavailable, onOpen, onFollowup, disabled }: {
  snapshot: ProtocolRunSnapshot; state: CoordinatorInteractiveState; seen: string[]; observationUnavailable: boolean; onOpen: (agent: ProtocolAgent) => void; onFollowup: (agent: ProtocolAgent) => void; disabled: boolean
}) {
  if (!snapshot.agents.some(agent => agent.role === 'teammate')) return null
  const stalled = coordinatorStalledAgentIds(state)
  return <div className="flex flex-wrap gap-2" aria-label="Persistent teammate conversations">
    {coordinatorRosterOrder(state, seen).map(agent => <div key={agent.id} className="rounded border p-2">
      <p>{agent.name} · {coordinatorAgentActivity(agent, state, observationUnavailable, stalled.includes(agent.id))}</p>
      {!agent.sessionId.startsWith('external:') ? <Button variant="ghost" size="sm" onClick={() => onOpen(agent)}>Transcript</Button> : null}
      <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onFollowup(agent)}>Follow up</Button>
    </div>)}
  </div>
}

function AttentionCard({ item, disabled, onSeen, onAction }: {
  item: CoordinatorAttentionItem; disabled: boolean; onSeen: () => void
  onAction: (body: Omit<RequestBody, 'provider' | 'requestId'>) => void
}) {
  const id = useId()
  const [answer, setAnswer] = useState('')
  const replyable = ['decision', 'message', 'blocker'].includes(item.kind)
  return <article className="rounded border p-3" aria-label={item.kind}>
    <strong>{item.title}</strong><p className="whitespace-pre-wrap text-sm">{item.detail}</p>
    {item.kind === 'result' ? <Button variant="ghost" size="sm" onClick={onSeen}>Mark reviewed</Button> : null}
    {item.kind === 'plan' ? <div className="flex gap-2">{[true, false].map(approved => <Button key={String(approved)} disabled={disabled} onClick={() => onAction({ action: 'review-plan', taskId: item.taskId, approved, detail: approved ? 'Plan approved by user' : 'Plan rejected; revise before proceeding' })}>{approved ? 'Approve plan' : 'Request revision'}</Button>)}</div> : null}
    {replyable ? <div className="flex flex-col gap-2"><label htmlFor={id}>Your reply</label><Textarea id={id} value={answer} disabled={disabled} onChange={event => setAnswer(event.target.value)} rows={2} />
      <Button disabled={disabled || !answer.trim()} onClick={() => onAction({ action: item.kind === 'decision' ? 'decision' : 'message', detail: answer,
        to: item.agentId, taskId: item.taskId, decisionId: item.decisionId, inReplyTo: item.messageId })}>Send reply</Button>
    </div> : null}
  </article>
}
