'use client'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { PLUGIN_API_VERSION, type PluginViewModule } from '@/lib/plugins/types'
import { skillCopyStatus, type SkillCopyReceipt } from '@/lib/plugins/skillsManager'
import type { WebPluginView, WebPluginViewProps } from '@/components/shell/pluginTypes'
import { useSkillsView, type SkillsViewState } from '../useSkillsView'
function Inventory({ state }: { state: SkillsViewState }) {
  return <section aria-label="Installed skills" className="flex min-h-0 flex-col gap-2">
    <label className="text-xs">Search skills<input className="mt-1 w-full rounded border bg-background p-2 text-sm" value={state.query} onChange={event => state.setQuery(event.target.value)} placeholder="Name, description, or folder" /></label>
    <label className="text-xs">Source location<select aria-label="Source location" className="mt-1 w-full rounded border bg-background p-2 text-xs" value={state.rootId} onChange={event => state.setRootId(event.target.value)}><option value="">All locations</option>{state.snapshot?.roots.map(root => <option key={root.id} value={root.id}>{root.scope} · {root.label} · {root.consumers.join(', ')}</option>)}</select></label>
    <p className="text-xs text-muted-foreground">{state.skills.length} skills · known folders on disk; provider runtime precedence may differ.</p>
    <div className="min-h-0 flex-1 overflow-auto">{state.skills.map(skill => <button key={skill.id} type="button" aria-pressed={state.skill?.id === skill.id} className={`mb-2 block w-full rounded border p-2 text-left ${state.skill?.id === skill.id ? 'bg-muted' : ''}`} onClick={() => state.setSkillId(skill.id)}>
      <span className="block text-sm font-semibold">{skill.name}{skill.linked ? ' · linked' : ''}</span><span className="block text-xs text-muted-foreground">{skill.description}</span><span className="block break-all text-xs">{state.snapshot?.roots.find(root => root.id === skill.rootId)?.label} · {skill.key}</span>
    </button>)}</div>
  </section>
}
function Resource({ state }: { state: SkillsViewState }) {
  if (!state.skill) return <p>Select a skill to inspect its instructions and resources.</p>
  return <section aria-label="Skill details" className="flex min-h-0 flex-col gap-2">
    <h3 className="font-semibold">{state.skill.name}</h3><p className="break-all text-xs text-muted-foreground">{state.sourceRoot?.path}/{state.skill.key}</p>
    <p className="text-xs">{state.sourceRoot?.consumers.join(' · ')} · {state.skill.files.length} resources</p>
    {state.skill.issues.length ? <p role="status" className="text-xs">{state.skill.issues.join('; ')}</p> : null}
    <label className="text-xs">Resource<select aria-label="Skill resource" className="ml-2 max-w-full rounded border bg-background p-1" value={state.file} onChange={event => state.setFileName(event.target.value)}>{[...new Set(['SKILL.md', ...state.skill.files.map(file => file.path)])].map(file => <option key={file}>{file}</option>)}</select></label>
    <pre aria-label="Skill resource preview" className="min-h-40 flex-1 overflow-auto whitespace-pre-wrap break-words rounded border p-3 font-mono text-xs">{state.fileText}</pre>
  </section>
}
function Destinations({ state }: { state: SkillsViewState }) {
  if (!state.skill || !state.snapshot) return null
  const skill = state.skill, snapshot = state.snapshot
  return <section aria-label="Copy destinations" className="flex min-h-0 flex-col gap-2">
    <h3 className="font-semibold">Compare and copy</h3><p className="text-xs text-muted-foreground">Independent copies of the complete skill bundle. Git metadata and node_modules are excluded.</p>
    <div className="max-h-80 overflow-auto">{snapshot.roots.filter(root => root.id !== skill.rootId).map(root => <label key={root.id} className="my-2 flex items-start gap-2 rounded border p-2 text-xs"><input aria-label={`Copy to ${root.label} ${root.scope}`} type="checkbox" disabled={!root.writable || state.busy} checked={state.targetIds.includes(root.id)} onChange={() => state.toggleTarget(root.id)} /><span className="min-w-0"><span className="block font-medium">{root.label} · {root.scope} · {skillCopyStatus(snapshot, skill, root.id)}</span><span className="block break-all text-muted-foreground">{root.path}</span><span className="block">{root.consumers.join(', ')}{root.note ? ` · ${root.note}` : ''}</span></span></label>)}</div>
    <Button size="sm" variant="outline" disabled={state.busy || !skill.syncable || !state.targetIds.length} onClick={() => void state.prepare()}>Preview copy</Button>
    <CopyPreview state={state} />
  </section>
}
function CopyPreview({ state }: { state: SkillsViewState }) {
  if (!state.preview) return null
  return <section aria-label="Copy preview" className="flex flex-col gap-2 rounded border p-2">
    <h4 className="text-sm font-semibold">Copy preview · {state.preview.sourceName}</h4>
    {state.preview.targets.map(target => <article key={target.rootId} className="text-xs"><p className="break-all font-medium">{target.status} · {target.path}</p>{target.reason ? <p>{target.reason}</p> : null}
      {target.status === 'replace' ? <label className="my-1 flex items-center gap-2"><input type="checkbox" aria-label={`Replace existing skill ${target.rootId}`} checked={state.replaceIds.includes(target.rootId)} disabled={state.busy} onChange={() => state.toggleReplacement(target.rootId)} />Replace this existing skill; save a backup</label> : null}
      <details><summary>File changes · {target.files.filter(file => file.status !== 'same').length}</summary>{target.files.map(file => <p className="break-all" key={file.path}>{file.status} · {file.path}</p>)}</details>
    </article>)}
    <Button size="sm" disabled={state.busy || !state.canApply} onClick={() => void state.apply()}>Apply copies</Button>
  </section>
}
function Receipt({ receipt }: { receipt: SkillCopyReceipt }) {
  return <article className="rounded border p-2 text-xs"><p>{receipt.sourceName} · {receipt.status} · {new Date(receipt.createdAt).toISOString()}</p>{receipt.error ? <p>{receipt.error}</p> : null}{receipt.results.map(result => <div key={result.rootId}><p className="break-all">{result.status} · {result.path}</p>{result.backup ? <p className="break-all">Backup: {result.backup}</p> : null}{result.error ? <p>{result.error}</p> : null}</div>)}</article>
}
function SkillsManager({ services, placement, close, useState: scoped }: WebPluginViewProps) {
  const state = useSkillsView(services['skills-manager']!, services.repository!.cwd, scoped)
  useEffect(() => {
    if (placement !== 'overlay') return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) close() }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }, [placement, close])
  const body = <section data-plugin-view="skills-manager" aria-label="Skills Manager" className="flex h-full min-h-0 flex-col gap-3 overflow-auto bg-background p-4 text-foreground">
    <header className="flex flex-wrap items-center gap-2"><h2 className="mr-auto font-semibold">Skills Manager</h2><Button size="sm" variant="outline" disabled={state.busy} onClick={() => void state.refresh()}>Refresh skills</Button>{placement === 'overlay' ? <Button size="sm" variant="ghost" onClick={close}>Close</Button> : null}</header>
    <p className="break-all text-xs text-muted-foreground">{services.repository!.cwd}</p>
    {state.notice ? <p role="status" className="text-sm">{state.notice}</p> : null}
    <div className="grid min-h-80 flex-1 grid-cols-[repeat(auto-fit,minmax(min(100%,250px),1fr))] gap-4"><Inventory state={state} /><Resource state={state} /><Destinations state={state} /></div>
    {state.snapshot?.diagnostics.length ? <details><summary>Discovery notices · {state.snapshot.diagnostics.length}</summary>{state.snapshot.diagnostics.map((diagnostic, i) => <p key={i} className="break-all text-xs">{diagnostic}</p>)}</details> : null}
    {state.snapshot?.receipts.length || state.receipt ? <details><summary>Recent copies</summary>{state.receipt ? <Receipt receipt={state.receipt} /> : null}{state.snapshot?.receipts.filter(receipt => receipt.id !== state.receipt?.id).map(receipt => <Receipt key={receipt.id} receipt={receipt} />)}</details> : null}
  </section>
  if (placement !== 'overlay') return body
  return <div role="dialog" aria-modal="true" aria-label="Skills Manager" className="fixed inset-0 z-50 grid place-items-center bg-black/40"><div className="h-[min(900px,94vh)] w-[min(1400px,96vw)] overflow-hidden rounded-lg border shadow-xl">{body}</div></div>
}
export const module: PluginViewModule<WebPluginView> = { apiVersion: PLUGIN_API_VERSION, pluginId: 'skills-manager', views: { 'skills-manager': SkillsManager } }
