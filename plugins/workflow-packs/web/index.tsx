'use client'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { PLUGIN_API_VERSION, type PluginViewModule } from '@/lib/plugins/types'
import { WORKFLOW_PACKS } from '@/lib/plugins/workflowPacks'
import type { WebPluginView, WebPluginViewProps } from '@/components/shell/pluginTypes'
import { useWorkflowPacks } from '../useWorkflowPacks'
function WorkflowPacks({ services, placement, close, useState: scoped }: WebPluginViewProps) {
  const state = useWorkflowPacks(services.playbooks!, services.repository!.cwd, scoped)
  useEffect(() => { if (placement !== 'overlay') return; const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) close() }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key) }, [placement, close])
  const body = <section data-plugin-view="workflow-packs" aria-label="Workflow Packs" className="flex h-full min-h-0 flex-col gap-3 overflow-auto bg-background p-4 text-foreground">
    <header className="flex items-center gap-2"><h2 className="mr-auto font-semibold">Workflow Packs</h2>{placement === 'overlay' ? <Button size="sm" variant="ghost" onClick={close}>Close</Button> : null}</header>
    <p className="break-all text-xs text-muted-foreground">{services.repository!.cwd}</p><p className="text-xs">Install templates, then choose the installed playbook in Start coordinated run. Installation starts no agents.</p>
    <label className="text-sm">Pack<select aria-label="Workflow pack" className="ml-2 rounded border bg-background p-2" value={state.selected} onChange={event => state.setSelected(event.target.value)}>{WORKFLOW_PACKS.map(pack => <option key={pack.id} value={pack.id}>{pack.title}</option>)}<option value="import">Import pack JSON</option></select></label>
    {state.selected === 'import' ? <label className="text-xs">Pack JSON<Textarea aria-label="Pack JSON" className="min-h-48 font-mono" value={state.json} onChange={event => state.setJson(event.target.value)} /></label> : null}
    {state.notice ? <p role="status" className="text-sm">{state.notice}</p> : null}
    {state.pack ? <><h3 className="font-semibold">{state.pack.title} · {state.pack.version}</h3><p className="text-sm">{state.pack.description}</p><p className="text-xs">Inspiration: {state.pack.sources.map(url => <a key={url} href={url} target="_blank" rel="noreferrer" className="mr-3 underline">{url.replace('https://github.com/', '')}</a>)}</p>
      {state.pack.playbooks.map(playbook => <article key={playbook.name} className="rounded border p-3 text-sm"><h4 className="font-semibold">{playbook.name}</h4><p className="text-xs">{playbook.description} · up to {playbook.maxAgents ?? 'default'} agents · plan approval {playbook.requirePlanApproval ? 'required' : 'provider default'} · review {playbook.requireReview ? 'required' : 'provider default'}{playbook.autonomy ? ` · autonomy ${playbook.autonomy}` : ''}</p>{playbook.gateCommand ? <pre className="whitespace-pre-wrap text-xs">Gate: {playbook.gateCommand}</pre> : null}{playbook.phases.map((phase, index) => <details key={index}><summary>{index + 1}. {phase.title} · {phase.tasks.length} tasks</summary>{phase.tasks.map((task, i) => <div key={task.key ?? i} className="my-2"><p className="font-medium">{task.title} · {task.role}</p><p className="whitespace-pre-wrap text-xs">{task.detail}</p>{task.verifyCommands?.length ? <pre className="whitespace-pre-wrap text-xs">{task.verifyCommands.join('\n')}</pre> : null}</div>)}</details>)}<details><summary>Full playbook definition</summary><pre className="overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(playbook, null, 2)}</pre></details></article>)}
      <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={state.busy} onClick={() => void state.preview()}>Preview installation</Button><Button size="sm" disabled={state.busy || !state.rows?.some(row => row.status === 'missing')} onClick={() => void state.install()}>Install missing workflows</Button></div>
      {state.rows ? <section aria-label="Pack installation preview">{state.rows.map(row => <p className="text-sm" key={row.name}>{row.name} · {row.status}{row.reason ? ` · ${row.reason}` : ''}</p>)}</section> : null}
    </> : null}
  </section>
  return placement === 'overlay' ? <div role="dialog" aria-modal="true" aria-label="Workflow Packs" className="fixed inset-0 z-50 grid place-items-center bg-black/40"><div className="h-[min(800px,92vh)] w-[min(1100px,96vw)] overflow-hidden rounded-lg border shadow-xl">{body}</div></div> : body
}
export const module: PluginViewModule<WebPluginView> = { apiVersion: PLUGIN_API_VERSION, pluginId: 'workflow-packs', views: { 'workflow-packs': WorkflowPacks } }
