'use client'

import { useId, useRef, useState } from 'react'
import type { ExternalProtocolTaskCreateResult, ProtocolAgent, ProtocolRunSnapshot, ProtocolTask } from '@/lib/agentProtocol'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'

export default function CoordinatorAskAgent({ snapshot, onOpenSession, onMessage }: {
  snapshot: ProtocolRunSnapshot
  onOpenSession: (agent: ProtocolAgent) => void
  onMessage: (name: string) => void
}) {
  const id = useId()
  const [detail, setDetail] = useState('')
  const [target, setTarget] = useState('auto')
  const [paths, setPaths] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ExternalProtocolTaskCreateResult | null>(null)
  const request = useRef<{ requestId: string; detail: string; to: string; paths: string[] } | null>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const terminal = ['completed', 'failed', 'stopped'].includes(snapshot.run.status)
  const task = snapshot.tasks.find(task => task.id === result?.task?.id) ?? result?.task
  const agent = snapshot.agents.find(agent => agent.id === result?.delegation?.agentId)
  const locked = busy || Boolean(error && request.current)

  async function submit() {
    if (busy || terminal || !detail.trim()) return
    request.current ??= { requestId: crypto.randomUUID(), detail: detail.trim(), to: target,
      paths: paths.split('\n').map(path => path.trim()).filter(Boolean) }
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/agent-protocol/runs/${encodeURIComponent(snapshot.run.id)}/delegate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request.current),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Delegation could not be confirmed')
      setResult(payload)
      setDetail('')
      request.current = null
    } catch (error) {
      // Keep the original body and key: a dropped response may follow a
      // committed assignment. Retrying must not create a second teammate/task.
      setError(error instanceof Error ? error.message : 'Delegation could not be confirmed')
    } finally {
      setBusy(false)
    }
  }

  return <section className="flex flex-col gap-3 rounded-lg border p-4" aria-label="Ask another agent">
    <div><strong>Ask another agent</strong><p className="text-sm text-muted-foreground">Delegate a task and keep working here. Results update below.</p></div>
    <label htmlFor={`${id}-target`}>Teammate</label>
    <NativeSelect id={`${id}-target`} value={target} onChange={event => setTarget(event.target.value)} disabled={locked || terminal}>
      <option value="auto">Choose an available teammate or create one</option>
      {snapshot.agents.filter(agent => agent.role === 'teammate' && !['failed', 'stopped'].includes(agent.status)).map(agent =>
        <option key={agent.id} value={agent.id}>{agent.name} · {agent.status}</option>)}
    </NativeSelect>
    <label htmlFor={`${id}-task`}>What should they do?</label>
    <Textarea ref={composer} id={`${id}-task`} value={detail} onChange={event => setDetail(event.target.value)} disabled={locked || terminal}
      placeholder="Review the current changes and report actionable findings." rows={3} maxLength={8000} />
    <details><summary>Files they may edit</summary>
      <label htmlFor={`${id}-paths`}>Write paths, one per line</label>
      <Textarea id={`${id}-paths`} value={paths} onChange={event => setPaths(event.target.value)} disabled={locked || terminal} rows={2} />
    </details>
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => void submit()} disabled={busy || terminal || !detail.trim()}>{busy ? 'Assigning…' : error ? 'Retry same request' : 'Ask agent'}</Button>
      {error ? <Button variant="outline" onClick={() => { request.current = null; setError(null) }}>Edit request after checking the board</Button> : null}
    </div>
    {error ? <p role="alert">{error} Check the task board before submitting different work.</p> : null}
    {task ? <DelegatedTaskResult task={task} agent={agent} name={result?.delegation?.name} terminal={terminal} locked={locked}
      onOpenSession={onOpenSession} onMessage={onMessage} onFollowup={agent => {
        setTarget(agent.id)
        setDetail(`Follow up on ${task.id}: `)
        composer.current?.focus()
      }} /> : null}
  </section>
}

function DelegatedTaskResult({ task, agent, name, terminal, locked, onOpenSession, onMessage, onFollowup }: {
  task: ProtocolTask
  agent?: ProtocolAgent
  name?: string
  terminal: boolean
  locked: boolean
  onOpenSession: (agent: ProtocolAgent) => void
  onMessage: (name: string) => void
  onFollowup: (agent: ProtocolAgent) => void
}) {
  const taskTerminal = ['completed', 'failed', 'cancelled'].includes(task.status)
  return <article className="flex flex-col gap-2 border-t pt-3" aria-label="Delegated task">
    <p role="status">{agent?.name ?? name}: {task.title} · {task.status === 'claimed' ? 'Queued' : task.status.replaceAll('_', ' ')}</p>
    {task.resultSummary ? <p className="whitespace-pre-wrap">{task.resultSummary}</p> : null}
    {task.resultDetail ? <details><summary>Full result</summary><p className="whitespace-pre-wrap">{task.resultDetail}</p></details> : null}
    <div className="flex flex-wrap gap-2">
      {agent?.sessionId ? <Button variant="outline" onClick={() => onOpenSession(agent)}>Open transcript</Button> : null}
      {agent && !terminal ? <Button variant="outline" onClick={() => onMessage(agent.name)}>Message {agent.name}</Button> : null}
      {agent && taskTerminal && !terminal ? <Button variant="outline" disabled={locked} onClick={() => onFollowup(agent)}>Follow up with {agent.name}</Button> : null}
    </div>
  </article>
}
