'use client'
import { useEffect, useId, useState } from 'react'
import type { AgentProvider } from '@/lib/types'
import type { PlaybookSummary, RunPlaybook } from '@/lib/agentProtocol'
import type { InteractiveWorkflowPreview } from '@/lib/agentCoordination'
import { workflowArguments, workflowPreviewLines } from '@/lib/coordinatorWorkflow'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'

export default function CoordinatorWorkflow({ cwd, provider, disabled, onStart }: {
  cwd: string; provider: AgentProvider; disabled: boolean
  onStart: (playbook: RunPlaybook, args: unknown) => void
}) {
  const id = useId()
  const [recipes, setRecipes] = useState<PlaybookSummary[]>([])
  const [name, setName] = useState('')
  const [args, setArgs] = useState('')
  const [preview, setPreview] = useState<InteractiveWorkflowPreview | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void fetch(`/api/agent-protocol/playbooks?${new URLSearchParams({ cwd })}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); if (controller.signal.aborted) return; setRecipes(data.playbooks); setName(data.playbooks[0]?.name ?? '') })
      .catch(error => { if (!controller.signal.aborted) setError(String(error)) })
    return () => controller.abort()
  }, [cwd])
  async function inspect() {
    setBusy(true); setError(''); setPreview(null)
    try {
      const query = new URLSearchParams({ cwd, name, provider, preview: 'interactive' })
      const value = workflowArguments(args)
      if (value !== undefined) query.set('args', JSON.stringify(value))
      const response = await fetch(`/api/agent-protocol/playbooks?${query}`, { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Preview failed')
      setPreview(data)
    } catch (error) { setError(String(error)) }
    finally { setBusy(false) }
  }
  return <details className="rounded border p-2"><summary>Start a saved team workflow</summary>
    <p className="text-sm text-muted-foreground">Finish existing work first. Preview the full board before starting. Your conversation stays lead.</p>
    {recipes.length ? <div className="space-y-2">
      <label htmlFor={`${id}-recipe`}>Workflow</label>
      <NativeSelect id={`${id}-recipe`} value={name} disabled={disabled || busy} onChange={event => { setName(event.target.value); setPreview(null) }}>
        {recipes.map(recipe => <option key={recipe.name} value={recipe.name}>{recipe.name} · {recipe.taskCount} tasks</option>)}
      </NativeSelect>
      <label htmlFor={`${id}-args`}>Arguments (text or JSON)</label>
      <Textarea id={`${id}-args`} value={args} rows={2} maxLength={8000} disabled={disabled || busy} placeholder={recipes.find(recipe => recipe.name === name)?.argsHint} onChange={event => { setArgs(event.target.value); setPreview(null) }} />
      <Button variant="outline" disabled={disabled || busy} onClick={() => void inspect()}>Preview workflow</Button>
      {preview ? <><pre className="max-h-80 overflow-auto whitespace-pre-wrap text-sm">{workflowPreviewLines(preview).join('\n')}</pre>
        <Button disabled={disabled || busy} onClick={() => onStart(preview.playbook, preview.args)}>Start this team in chat</Button></> : null}
    </div> : <p className="text-sm">No saved workflows in this project. Save a playbook from the Coordinator board to reuse it here.</p>}
    {error ? <p role="alert">{error}</p> : null}
  </details>
}
