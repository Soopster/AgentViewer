'use client'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { PluginCardBlocks } from '@/components/shell/PluginCardBlocks'
import { PLUGIN_API_VERSION, type PluginViewModule } from '@/lib/plugins/types'
import type { WebPluginView, WebPluginViewProps } from '@/components/shell/pluginTypes'
import { previewRule, useAdaptiveView, type AdaptiveItem, type AdaptiveViewState } from '../useAdaptiveView'

const STATUS_STYLE = { active: 'text-green-600', draft: 'text-amber-600', disabled: 'text-muted-foreground' } as const
function RuleRow({ state, rule }: { state: AdaptiveViewState; rule: Extract<AdaptiveItem, { kind: 'rule' }>['rule'] }) {
  const [open, setOpen] = useState(rule.status === 'draft')
  const previews = open ? previewRule(rule) : []
  return <article data-adaptive-rule={rule.id} className="rounded border p-2 text-xs">
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" aria-expanded={open} className="min-w-0 flex-1 text-left" onClick={() => setOpen(value => !value)}><span className="font-semibold">{rule.id}</span> <span className={STATUS_STYLE[rule.status]}>{rule.status}</span><span className="block break-all text-muted-foreground">{rule.match.tool}{rule.overridesNative ? ' · replaces the built-in card' : ''}{rule.provenance?.by ? ` · by ${rule.provenance.by}` : ''}</span></button>
      {rule.status !== 'active' ? <Button size="sm" disabled={state.busy} onClick={() => void state.setStatus(rule.id, 'active')}>Enable</Button> : <Button size="sm" variant="outline" disabled={state.busy} onClick={() => void state.setStatus(rule.id, 'disabled')}>Disable</Button>}
      <Button size="sm" variant="outline" disabled={state.busy} onClick={() => void state.remove(rule.id)}>{state.armed === rule.id ? 'Confirm delete' : 'Delete'}</Button>
    </div>
    {open ? <div className="mt-2 grid gap-2">
      {previews.length ? previews.map((card, index) => <div key={index} className="rounded border p-2"><div className="font-semibold">{card.title || rule.match.tool}</div><PluginCardBlocks blocks={card.blocks} /></div>) : <p className="text-muted-foreground">No samples were saved with this rule, so there is no preview. It is drawn on real calls once enabled.</p>}
      <details><summary>Rule file</summary><pre className="max-h-64 overflow-auto text-[11px]">{JSON.stringify(rule, null, 2)}</pre></details>
    </div> : null}
  </article>
}
function ShapeRow({ state, shape }: { state: AdaptiveViewState; shape: Extract<AdaptiveItem, { kind: 'shape' }>['shape'] }) {
  return <article data-adaptive-shape={shape.tool} className="flex flex-wrap items-center gap-2 rounded border p-2 text-xs">
    <span className="min-w-0 flex-1"><span className="font-semibold break-all">{shape.tool}</span><span className="block text-muted-foreground">{shape.count} calls · keys: {shape.inputKeys.join(', ') || 'none'} · {shape.samples.length} samples</span></span>
    <Button size="sm" disabled={state.busy || !state.insertAvailable} title={state.insertAvailable ? undefined : 'Open a session to hand this to an agent'} onClick={() => void state.design(shape.key)}>Design card</Button>
    <Button size="sm" variant="outline" disabled={state.busy} onClick={() => void state.dismiss(shape.key)}>Dismiss</Button>
  </article>
}
function AdaptiveUi({ services, placement, close }: WebPluginViewProps) {
  const state = useAdaptiveView(services['adaptive-ui']!, services.composer?.insertText)
  useEffect(() => {
    if (placement !== 'overlay') return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) close() }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }, [placement, close])
  const rules = state.items.flatMap(item => item.kind === 'rule' ? [item] : []), shapes = state.items.flatMap(item => item.kind === 'shape' ? [item] : []), invalid = state.items.flatMap(item => item.kind === 'invalid' ? [item] : [])
  const body = <section data-plugin-view="adaptive-ui" aria-label="Adaptive UI" className="flex h-full min-h-0 flex-col gap-3 overflow-auto bg-background p-4 text-foreground">
    <header className="flex flex-wrap items-center gap-2"><h2 className="mr-auto font-semibold">Adaptive UI</h2><Button size="sm" variant="outline" disabled={state.busy} onClick={() => void state.refresh()}>Refresh</Button>{placement === 'overlay' ? <Button size="sm" variant="outline" onClick={close}>Close</Button> : null}</header>
    <p className="text-xs text-muted-foreground">Cards are data in {state.snapshot?.dir ?? 'the recipes folder'}. A new card starts as a draft: review its preview, then enable it. A failed call always shows as an error.</p>
    {state.notice ? <p role="status" className="text-sm">{state.notice}</p> : null}
    <h3 className="text-sm font-semibold">Cards · {rules.length}</h3>
    <div className="grid gap-2">{rules.map(item => <RuleRow key={item.key} state={state} rule={item.rule} />)}{!rules.length ? <p className="text-xs text-muted-foreground">No cards yet. Design one for a tool listed below.</p> : null}</div>
    <h3 className="text-sm font-semibold">Drawn generically · {shapes.length}</h3>
    <div className="grid gap-2">{shapes.map(item => <ShapeRow key={item.key} state={state} shape={item.shape} />)}{!shapes.length ? <p className="text-xs text-muted-foreground">Tools with no dedicated card show up here after their first finished call.</p> : null}</div>
    {invalid.length ? <details open><summary className="text-sm font-semibold">Refused files · {invalid.length}</summary>{invalid.map(item => <p key={item.key} className="break-all text-xs"><b>{item.file}</b>: {item.problems.join('; ')}</p>)}</details> : null}
  </section>
  if (placement !== 'overlay') return body
  return <div role="dialog" aria-modal="true" aria-label="Adaptive UI" className="fixed inset-0 z-50 grid place-items-center bg-black/40"><div className="h-[min(800px,92vh)] w-[min(960px,96vw)] overflow-hidden rounded-lg border shadow-xl">{body}</div></div>
}
export const module: PluginViewModule<WebPluginView> = { apiVersion: PLUGIN_API_VERSION, pluginId: 'adaptive-ui', views: { 'adaptive-ui': AdaptiveUi } }
