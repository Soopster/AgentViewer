'use client'
import { useId, useState } from 'react'
import { resourceLimits, resourceSummary, type CoordinatorResources as Resources } from '@/lib/coordinatorResources'
import type { ProtocolRunBudget } from '@/lib/agentProtocol'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function CoordinatorResources({ resources, disabled, onApply }: {
  resources: Resources; disabled: boolean; onApply: (limits: { maxAgents: number; budget: ProtocolRunBudget }) => void
}) {
  const id = useId()
  const current = () => ({ capacity: String(resources.maxAgents), tokens: String(resources.budget?.maxTokens ?? ''), cost: String(resources.budget?.maxCostUsd ?? ''), minutes: String(resources.budget?.maxDurationMinutes ?? '') })
  const [fields, setFields] = useState(current)
  const [error, setError] = useState('')
  return <details className="rounded border p-2" open={resources.pausedReason ? true : undefined}><summary>Team resources{resources.pausedReason ? ' · scheduling paused' : ''}</summary>
    {resourceSummary(resources).map(line => <p key={line} className="text-sm">{line}</p>)}
    <div className="grid gap-2 sm:grid-cols-2">
      {([['capacity', 'Agent capacity (includes lead)'], ['tokens', 'Run token limit'], ['cost', 'Run cost limit (USD)'], ['minutes', 'Run duration limit (minutes)']] as const).map(([key, label]) => <div key={key}>
        <label htmlFor={`${id}-${key}`}>{label}</label><Input id={`${id}-${key}`} inputMode={key === 'capacity' || key === 'tokens' ? 'numeric' : 'decimal'} value={fields[key]} disabled={disabled} onChange={event => setFields({ ...fields, [key]: event.target.value })} />
      </div>)}
    </div>
    <p className="text-sm text-muted-foreground">An empty budget field removes that limit. Applying limits may resume eligible work in this team. It does not replay uncertain execution.</p>
    <div className="flex gap-2"><Button disabled={disabled} onClick={() => { try { onApply(resourceLimits(fields)); setError('') } catch (error) { setError(String(error)) } }}>Apply team limits</Button>
      <Button variant="ghost" disabled={disabled} onClick={() => { setFields(current()); setError('') }}>Use current limits</Button></div>
    {error ? <p role="alert">{error}</p> : null}
  </details>
}
