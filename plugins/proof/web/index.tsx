'use client'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { WebPluginViewProps, WebPluginView, WebPluginWidget } from '@/components/shell/pluginTypes'
import { PLUGIN_API_VERSION, type PluginViewModule, type PluginWidgetModule } from '@/lib/plugins/types'
import { proofFreshness, proofSummary, proofRunLabel, type ProofCheck } from '@/lib/plugins/proof'
import { useProof } from '@/lib/plugins/useProof'
import { useProofView, type ProofViewState } from '../useProofView'


function Configuration({ state, draft, setDraft, save, discard, configError, setConfigError }: { state: ProofViewState; draft: string; setDraft: (value: string) => void; save: () => Promise<void>; discard: () => void; configError: string; setConfigError: (value: string) => void }) {
  return <div className="flex flex-col gap-2">
      <label htmlFor="proof-config" className="text-sm">Check definitions (JSON array)</label>
      <p className="text-xs text-muted-foreground">Fields: id, label, executable, args (array), cwd (relative), timeoutMs. Commands run only when requested.</p>
      <Textarea id="proof-config" value={draft} onChange={event => setDraft(event.target.value)} className="min-h-64 font-mono text-xs" />
      {configError ? <p role="alert">{configError}</p> : null}
      <div className="flex gap-2"><Button size="sm" disabled={state.busy} onClick={() => void save()}>Save configuration</Button><Button variant="ghost" size="sm" onClick={discard}>Discard</Button></div>
      <div className="flex flex-wrap gap-2">{state.snapshot?.suggestions.map(check => <Button key={check.id} variant="outline" size="sm" onClick={() => {
        try { const checks = JSON.parse(draft) as ProofCheck[]; if (!Array.isArray(checks)) throw new Error('Use a JSON array'); const id = check.id; if (!checks.some(item => item.id === id)) setDraft(JSON.stringify([...checks, { ...check, id }], null, 2)) }
        catch (error) { setConfigError(String(error)) }
      }}>Add {check.label}</Button>)}</div>
    </div>
}

function Checks({ state }: { state: ProofViewState }) {
  const active = state.snapshot?.runs.find(run => !run.finishedAt)
  return <div className="flex flex-col gap-2">
      {state.snapshot?.config.checks.length === 0 ? <p>No checks configured. Choose package scripts or add your own executable and arguments.</p> : null}
      {state.snapshot?.config.checks.map(check => <label key={check.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={state.selected.includes(check.id)} onChange={() => state.toggle(check.id)} /><span>{check.label}</span><code className="truncate text-xs text-muted-foreground">{JSON.stringify([check.executable, ...check.args])}</code></label>)}
      <div className="flex gap-2"><Button size="sm" disabled={state.busy || !!active || !state.selected.length} onClick={() => void state.start()}>Run selected</Button>{active ? <Button variant="outline" size="sm" disabled={state.busy} onClick={() => void state.cancel()}>Cancel run</Button> : null}</div>
    </div>
}


function Output({ state, canPrepare }: { state: ProofViewState; canPrepare: boolean }) {
  if (!state.result) return null
  return <div className="flex flex-col gap-2">
      <p className="text-xs">{state.result.error}{state.result.exitCode !== undefined ? ` · Exit ${state.result.exitCode ?? 'signal'}` : ''}{state.result.finishedAt && state.result.startedAt ? ` · ${((state.result.finishedAt - state.result.startedAt) / 1000).toFixed(1)}s` : ''}</p>
      <pre aria-label="Verification output" className="overflow-auto whitespace-pre-wrap rounded border p-3 font-mono text-xs">{(state.all ? state.output : state.output.split('\n').slice(0, 12).join('\n')) || 'No captured output yet.'}</pre>
      {state.result.truncated ? <p className="text-xs">Output truncated at 1 MiB.</p> : null}
      <div className="flex gap-2">{state.output.split('\n').length > 12 ? <Button variant="ghost" size="sm" onClick={() => state.setAll(!state.all)}>{state.all ? 'Show less' : 'Show all'}</Button> : null}
        <Button variant="outline" size="sm" disabled={!state.run?.origin || !canPrepare || state.result.status === 'passed' || state.result.status === 'running' || state.result.status === 'queued'} onClick={state.prepare}>Prepare fix prompt</Button></div>
    </div>
}

function Receipts({ state, canPrepare }: { state: ProofViewState; canPrepare: boolean }) {
  return <>
    {state.snapshot?.runs.length ? <label className="flex flex-col gap-1 text-sm">Run history<select aria-label="Verification run" value={state.run?.id ?? ''} onChange={event => { state.setRunId(event.target.value); state.setCheckId(null) }} className="rounded border bg-background p-2">{state.snapshot.runs.map(run => <option key={run.id} value={run.id}>{proofRunLabel(run)} · {run.finishedAt ? 'settled' : 'running'}</option>)}</select></label> : null}
    <div className="flex flex-wrap gap-2">{state.run?.results.map(result => <Button key={result.check.id} variant={state.result?.check.id === result.check.id ? 'secondary' : 'outline'} size="sm" onClick={() => { state.setCheckId(result.check.id); state.setAll(false) }}>{result.check.label} · {result.status} · {state.snapshot ? proofFreshness(result, state.snapshot) : 'unknown'}</Button>)}</div>
    <Output state={state} canPrepare={canPrepare} />
  </>
}

function Proof({ services, placement, close, useState: scopedState }: WebPluginViewProps) {
  const cwd = services.repository!.cwd, session = services.session?.session
  const origin = session?.provider ? { provider: session.provider, providerInstanceId: session.providerInstanceId, sessionId: session.sessionId } : undefined
  const state = useProofView(services.proof!, cwd, origin, services.composer?.insertText, scopedState)
  const [editing, setEditing] = scopedState('editing', false), [draft, setDraft] = scopedState('config-draft', ''), [configError, setConfigError] = useState('')
  useEffect(() => {
    if (placement !== 'overlay') return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [placement, close])
  const edit = () => { setDraft(JSON.stringify(state.snapshot?.config.checks ?? [], null, 2)); setEditing(true); setConfigError('') }
  const save = async () => {
    try { const checks = JSON.parse(draft) as ProofCheck[]; if (await state.configure(checks)) setEditing(false) }
    catch (error) { setConfigError(String(error)) }
  }
  const body = <section data-plugin-view="proof" aria-label="Proof verification" className="flex h-full min-h-0 flex-col gap-3 overflow-auto bg-background p-4 text-foreground">
    <div className="flex flex-wrap items-center gap-2">
      <h2 className="mr-auto font-semibold">Proof · {state.snapshot ? proofSummary(state.snapshot) : 'loading'}</h2>
      <Button variant="outline" size="sm" onClick={() => void state.refresh()}>Refresh status</Button>
      <Button variant="outline" size="sm" disabled={!state.snapshot || state.busy} onClick={edit}>Configure checks</Button>
      {placement === 'overlay' ? <Button variant="ghost" size="sm" onClick={close}>Close</Button> : null}
    </div>
    <p className="break-all text-xs text-muted-foreground">{cwd}</p>
    <p className="text-xs text-muted-foreground">Receipts cover Git-visible source and configured commands. Browser, provider and environment behaviour need their own checks.</p>
    {state.error || state.notice ? <p role="status" className="text-sm">{state.error ?? state.notice}</p> : null}
    {state.snapshot?.fingerprintError ? <p role="status">Freshness unknown: {state.snapshot.fingerprintError}</p> : null}
    {editing ? <Configuration state={state} draft={draft} setDraft={setDraft} save={save} discard={() => setEditing(false)} configError={configError} setConfigError={setConfigError} /> : null}
    <Checks state={state} />
    <Receipts state={state} canPrepare={!!services.composer?.insertText} />
  </section>
  if (placement !== 'overlay') return body
  return <div role="dialog" aria-modal="true" aria-label="Proof" className="fixed inset-0 z-50 grid place-items-center bg-black/40"><div className="h-[min(800px,90vh)] w-[min(1000px,95vw)] overflow-hidden rounded-lg border shadow-xl">{body}</div></div>
}
function Status({ services }: React.ComponentProps<WebPluginWidget>) {
  const { snapshot, error } = useProof(services?.proof, services?.repository?.cwd ?? null)
  if (!snapshot || (!snapshot.config.checks.length && !snapshot.runs.length)) return null
  return <div data-proof-status role="status" className="rounded-md border bg-background px-3 py-2 text-xs shadow-sm">Proof · {error ? 'freshness unavailable' : proofSummary(snapshot)}</div>
}
export const module: PluginViewModule<WebPluginView> = { apiVersion: PLUGIN_API_VERSION, pluginId: 'proof', views: { proof: Proof } }
export const widgets: PluginWidgetModule<WebPluginWidget> = { apiVersion: PLUGIN_API_VERSION, pluginId: 'proof', widgets: { status: Status } }
