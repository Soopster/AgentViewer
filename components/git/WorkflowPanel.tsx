'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { initialWorkflowValues, workflowPaths, workflowChoices, workflowSummary, type WorkflowContext, type WorkflowField, type WorkflowChoice } from '@/lib/git/workflowMenu'
import type { WorkflowDraft, WorkspaceSnapshot } from '@/lib/git/workspaceTypes'

function WorkflowInput({ field, value, change, disabled }: { field: WorkflowField; value: string; change: (value: string) => void; disabled: boolean }) {
  const id = `git-workflow-${field.key}`
  if (field.kind === 'toggle') return <label className="git-workflow-check"><input id={id} type="checkbox" checked={value === 'true'} disabled={disabled} onChange={event => change(String(event.target.checked))} />{field.label}</label>
  if (field.kind === 'paths') {
    const paths = workflowPaths(value || '[]')
    return <fieldset className="git-workflow-paths"><legend>{field.label}</legend>{field.options?.map(option => <label key={option.value} className="git-workflow-check"><input type="checkbox" checked={paths.includes(option.value)} disabled={disabled} onChange={event => change(JSON.stringify(event.target.checked ? [...paths, option.value] : paths.filter(path => path !== option.value)))} />{option.label}</label>)}</fieldset>
  }
  return <label htmlFor={id} className="git-workflow-field">{field.label}{field.kind === 'choice' ? <NativeSelect id={id} value={value} disabled={disabled} onChange={event => change(event.target.value)}>{field.options?.map(option => <NativeSelectOption key={option.value} value={option.value}>{option.label}</NativeSelectOption>)}</NativeSelect> : <Input id={id} value={value} disabled={disabled} onChange={event => change(event.target.value)} />}</label>
}
export function WorkflowPanel({ snapshot, context, path, busy, error, onRun, onClose }: { snapshot: WorkspaceSnapshot; context: WorkflowContext; path: string | null; busy: boolean; error: string | null; onRun: (action: WorkflowDraft, revision: string) => Promise<boolean>; onClose: () => void }) {
  const choices = workflowChoices(snapshot, context, path)
  const [selected, setSelected] = useState<WorkflowChoice | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [review, setReview] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const prepare = () => {
    if (!selected) return
    try { setReview(workflowSummary(selected, values)); setLocalError(null) } catch (error) { setLocalError(String(error instanceof Error ? error.message : error)) }
  }
  const submit = async () => {
    if (!selected) return
    try { if (await onRun(selected.build(values), snapshot.workflowRevision)) onClose() } catch (error) { setLocalError(String(error instanceof Error ? error.message : error)) }
  }
  return <section className="git-workflow-panel" aria-label="Git actions" onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.stopPropagation(); if (review) setReview(null); else if (selected) setSelected(null); else onClose() } }}>
    <div className="git-workspace-detail-header"><strong>{selected?.label ?? 'Git actions'}</strong><Button size="sm" variant="ghost" disabled={busy} onClick={onClose}>Back to workspace</Button></div>
    <div className="git-workflow-content">
      {!selected ? <div className="git-workflow-options">{choices.map(choice => <Button key={choice.id} variant="outline" size="sm" onClick={() => { setSelected(choice); setValues(initialWorkflowValues(choice)); setLocalError(null) }}>{choice.label}</Button>)}</div> : <>
        <p>{selected.description}</p>
        {review ? <><h3>Confirm target and options</h3><pre>{`${snapshot.root}\nBranch: ${snapshot.branch}\nHEAD: ${snapshot.head ?? '(unborn)'}\n${snapshot.files.length} changed files\n\n${review}`}</pre></> : <div className="git-workflow-fields">{selected.fields.map(field => <WorkflowInput key={field.key} field={field} value={values[field.key] ?? ''} change={value => setValues(previous => ({ ...previous, [field.key]: value }))} disabled={busy} />)}</div>}
        <div className="git-workspace-actions"><Button size="sm" disabled={busy} onClick={review ? () => void submit() : prepare}>{busy ? 'Running…' : review ? 'Confirm action' : 'Review action'}</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => { if (review) setReview(null); else setSelected(null) }}>Back</Button></div>
      </>}
      {localError || error ? <p role="alert" className="git-workspace-error">{localError ?? error}</p> : null}
    </div>
  </section>
}
