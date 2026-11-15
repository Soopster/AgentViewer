'use client'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { PluginCardBlocks } from '@/components/shell/PluginCardBlocks'
import { PLUGIN_API_VERSION, type PluginViewModule } from '@/lib/plugins/types'
import type { WebPluginView, WebPluginViewProps } from '@/components/shell/pluginTypes'
import { explainRule, explanationLines } from '@/lib/adaptiveUi/explain'
import { inputRows, resultView } from '@/lib/adaptiveUi/sampleView'
import { ADAPTIVE_FILTERS, coverageWarnings, countAdaptive, describeAdaptiveItem, filterAdaptiveItems, historyFor, previewRule, useAdaptiveView, type AdaptiveFilter, type AdaptiveItem, type AdaptiveRowTone, type AdaptiveViewState } from '../useAdaptiveView'

// The same workspace hierarchy as the terminal: filters with counts over a list, and the selected item with
// its tabs and actions beside it. Below the `md` breakpoint it shows the list or the detail, with a way back.
const RULE_TABS = [['preview', 'Preview'], ['why', 'Why'], ['history', 'History'], ['rule', 'Rule']] as const
type RuleTab = (typeof RULE_TABS)[number][0]
// app/globals.css resets `*` to `margin: 0; padding: 0` OUTSIDE any cascade layer, which beats every Tailwind
// padding and margin utility, so a plugin view built from `p-4`/`px-2` draws flush against its edges. Until that
// reset moves into a layer, the few spacing utilities this view uses are restored here, scoped to the view.
const SPACING = `[data-plugin-view="adaptive-ui"].p-4,[data-plugin-view="adaptive-ui"] .p-4{padding:1rem}[data-plugin-view="adaptive-ui"] .p-2{padding:.5rem}[data-plugin-view="adaptive-ui"] .p-1{padding:.25rem}[data-plugin-view="adaptive-ui"] .px-1{padding-inline:.25rem}[data-plugin-view="adaptive-ui"] .px-2{padding-inline:.5rem}[data-plugin-view="adaptive-ui"] .px-3{padding-inline:.75rem}[data-plugin-view="adaptive-ui"] .py-1{padding-block:.25rem}[data-plugin-view="adaptive-ui"] .pt-1{padding-top:.25rem}[data-plugin-view="adaptive-ui"] .pt-2{padding-top:.5rem}[data-plugin-view="adaptive-ui"] .pl-2{padding-left:.5rem}[data-plugin-view="adaptive-ui"] .mb-1{margin-bottom:.25rem}[data-plugin-view="adaptive-ui"] .m-0{margin:0}[data-plugin-view="adaptive-ui"] .h-8{height:2rem}[data-plugin-view="adaptive-ui"] button{cursor:pointer}`
const TONE_CLASS: Record<AdaptiveRowTone, string> = { accent: 'text-primary', good: 'text-green-600', warn: 'text-amber-600', muted: 'text-muted-foreground', bad: 'text-red-600' }

function Detail({ state, item, tab, setTab }: { state: AdaptiveViewState; item: AdaptiveItem; tab: RuleTab; setTab: (tab: RuleTab) => void }) {
  const [instruction, setInstruction] = useState('')
  useEffect(() => setInstruction(''), [item.key])
  const row = describeAdaptiveItem(item, state.origins)
  const modRule = item.kind === 'rule' && !!state.origins[item.rule.id]
  return <section aria-label="Details" className="flex h-full min-h-0 flex-col gap-2">
    <header>
      <h3 className="break-all text-sm font-semibold">{row.title}</h3>
      <p className={`break-all text-xs ${TONE_CLASS[row.tone]}`}>{row.sub}</p>
    </header>
    {item.kind === 'rule' ? <div role="tablist" aria-label="Card views" className="flex gap-1 border-b">
      {RULE_TABS.map(([id, label]) => <button key={id} role="tab" type="button" aria-selected={tab === id} className={`px-2 py-1 text-xs ${tab === id ? 'border-b-2 border-primary font-semibold' : 'text-muted-foreground'}`} onClick={() => setTab(id)}>{label}</button>)}
    </div> : null}
    <div className="min-h-0 flex-1 overflow-auto text-xs">
      {item.kind === 'suggestion' ? <div className="grid gap-2"><p>{item.suggestion.detail}</p><p className="text-muted-foreground">{item.suggestion.kind === 'view' ? 'Applying adds a new custom view. It is never selected for you; pick it from the View menu.' : 'Applying drafts a card in place with a model that has no tools. The draft shows beside real calls for you to keep or discard.'}</p></div> : null}
      {item.kind === 'invalid' ? <div className="grid gap-1"><p className="text-amber-600">This file is not drawn:</p>{item.problems.map((problem, i) => <p key={i} className="break-words text-red-600">· {problem}</p>)}</div> : null}
      {item.kind === 'shape' ? <div className="grid gap-3">
        <p className="text-muted-foreground">{item.shape.mcpServer ? `MCP server ${item.shape.mcpServer} · ` : ''}input keys: {item.shape.inputKeys.join(', ') || 'none'}</p>
        {item.shape.samples.length ? item.shape.samples.map((sample, index) => {
          const rows = inputRows(sample.input), result = resultView(sample)
          return <article key={index} className="grid gap-1 rounded border p-2" aria-label={`Sample ${index + 1}`}>
            <h4 className="font-semibold text-primary">{item.shape.samples.length > 1 ? `Sample ${index + 1} of ${item.shape.samples.length}` : 'Sample'}</h4>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Input</p>
            {rows.length ? <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5">{rows.map(([key, value]) => [<dt key={`k${key}`} className="text-muted-foreground">{key}</dt>, <dd key={`v${key}`} className="m-0 break-words">{value}</dd>])}</dl> : <p className="text-muted-foreground">(no arguments)</p>}
            <p className={`text-[11px] uppercase tracking-wide ${result.error ? 'text-red-600' : 'text-muted-foreground'}`}>{result.kind === 'none' ? 'Result' : result.error ? 'Result · error' : 'Result'}</p>
            {result.kind === 'none' ? <p className="text-muted-foreground">(the call had not finished: no result kept)</p> : <pre className={`max-h-72 overflow-auto whitespace-pre-wrap break-words border-l-2 pl-2 text-[11px] ${result.error ? 'border-red-600 text-red-600' : 'border-border'}`}>{result.text}</pre>}
          </article>
        }) : <p className="text-muted-foreground">No samples yet: call this tool once and let it finish. “Design here” needs one; “Design with an agent” can ask for it.</p>}
        <p className="text-[11px] text-muted-foreground">Samples are redacted: secret-looking keys are removed and long values cut.</p>
      </div> : null}
      {item.kind === 'rule' && tab === 'preview' ? <div className="grid gap-2">
        {previewRule(item.rule).length ? previewRule(item.rule).map((card, index) => <div key={index} className="rounded border p-2"><div className="font-semibold">{card.title || item.rule.match.tool}</div><PluginCardBlocks blocks={card.blocks} /></div>) : <p className="text-muted-foreground">No samples were kept with this rule, so there is nothing to preview here. It draws on real calls once enabled; while it is a draft it also shows beside them.</p>}
        {coverageWarnings(item.rule).length ? <div role="status" className="rounded border border-amber-600 p-2 text-amber-700">{coverageWarnings(item.rule).map((warning, i) => <p key={i}>⚠ {warning}</p>)}</div> : null}
      </div> : null}
      {item.kind === 'rule' && tab === 'why' ? <pre className="whitespace-pre-wrap text-[11px]">{explanationLines(explainRule(item.rule)).join('\n')}</pre> : null}
      {item.kind === 'rule' && tab === 'history' ? (historyFor(state, item.rule.id).length ? <div className="grid gap-1">{historyFor(state, item.rule.id).map((entry, i) => <p key={i} className="break-all">{entry.at.slice(0, 19).replace('T', ' ')} · {entry.actor} · {entry.action}{entry.revision ? ` r${entry.revision}` : ''} · {entry.summary}</p>)}</div> : <p className="text-muted-foreground">Nothing recorded for this card yet.</p>) : null}
      {item.kind === 'rule' && tab === 'rule' ? <><p className="break-all text-muted-foreground">{state.snapshot?.dir}/{item.rule.id}.json</p><pre className="overflow-auto text-[11px]">{JSON.stringify(item.rule, null, 2)}</pre></> : null}
    </div>
    <footer className="flex flex-wrap items-center gap-2 border-t pt-2">
      {item.kind === 'suggestion' ? <><Button size="sm" disabled={state.busy} onClick={() => void state.applySuggestion(item.suggestion)}>{item.suggestion.kind === 'view' ? 'Add the view' : 'Design here'}</Button><Button size="sm" variant="outline" disabled={state.busy} onClick={() => void state.dismissSuggestion(item.suggestion.id)}>Dismiss</Button></> : null}
      {item.kind === 'shape' ? <><Button size="sm" disabled={state.busy || !item.shape.samples.length} title={item.shape.samples.length ? 'Ask a model with no tools to draft a card' : 'No samples kept yet'} onClick={() => void state.designHere(item.shape.key)}>Design here</Button><Button size="sm" variant="outline" disabled={state.busy || !state.insertAvailable} title={state.insertAvailable ? undefined : 'Open a session to hand this to an agent'} onClick={() => void state.design(item.shape.key)}>Design with an agent</Button><Button size="sm" variant="outline" disabled={state.busy} onClick={() => void state.dismiss(item.shape.key)}>Dismiss</Button></> : null}
      {item.kind === 'rule' && modRule ? <span className="text-xs text-muted-foreground">Shipped by mod {state.origins[item.rule.id]}: read-only here</span> : null}
      {item.kind === 'rule' && !modRule ? <>
        {item.rule.status === 'active' ? <Button size="sm" variant="outline" disabled={state.busy} onClick={() => void state.setStatus(item.rule.id, 'disabled')}>Disable</Button> : <Button size="sm" disabled={state.busy} onClick={() => void state.setStatus(item.rule.id, 'active')}>Enable</Button>}
        <Button size="sm" variant="outline" disabled={state.busy} onClick={() => void state.remove(item.rule.id)}>{state.armed === item.rule.id ? 'Confirm delete' : 'Delete'}</Button>
        <form className="flex min-w-0 flex-1 flex-wrap items-center gap-2" onSubmit={event => { event.preventDefault(); if (instruction.trim() && !state.busy) void state.refineHere(item.rule.id, instruction.trim()).then(() => setInstruction('')) }}>
          <input aria-label={`Change ${item.rule.id}`} className="min-w-40 flex-1 rounded border bg-background p-1 text-xs" maxLength={500} placeholder="Change this card… e.g. show the owner, drop the table" value={instruction} onChange={event => setInstruction(event.target.value)} />
          <Button size="sm" type="submit" disabled={state.busy || !instruction.trim()}>Change</Button>
          <Button size="sm" type="button" variant="outline" disabled={state.busy || !state.insertAvailable} title={state.insertAvailable ? undefined : 'Open a session to hand this to an agent'} onClick={() => void state.refineWithAgent(item.rule.id)}>Change with an agent</Button>
        </form>
      </> : null}
    </footer>
  </section>
}

function AdaptiveUi({ services, placement, close, useState: scoped }: WebPluginViewProps) {
  const state = useAdaptiveView(services['adaptive-ui']!, services.composer?.insertText)
  const [filter, setFilter] = scoped<AdaptiveFilter>('filter', 'all')
  const [selectedKey, setSelectedKey] = scoped<string>('selected', '')
  const [tab, setTab] = scoped<RuleTab>('tab', 'preview')
  const [narrowDetail, setNarrowDetail] = useState(false)
  useEffect(() => {
    if (placement !== 'overlay') return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) { if (narrowDetail) setNarrowDetail(false); else close() } }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }, [placement, close, narrowDetail])
  const visible = useMemo(() => filterAdaptiveItems(state.items, filter), [state.items, filter])
  const selected = visible.find(item => item.key === selectedKey) ?? visible[0]
  const ruleCount = state.snapshot?.rules.length ?? 0
  let lastSection = ''
  const body = <section data-plugin-view="adaptive-ui" aria-label="Adaptive UI" className="flex h-full min-h-0 flex-col gap-2 overflow-hidden bg-background p-4 text-foreground">
    <style>{SPACING}</style>
    <header className="flex flex-wrap items-center gap-2">
      <h2 className="mr-auto font-semibold">Adaptive UI <span className="text-xs font-normal text-muted-foreground">cards for tool calls · {ruleCount} card{ruleCount === 1 ? '' : 's'} · {countAdaptive(state.items, 'generic')} drawn generically</span></h2>
      <Button size="sm" variant="outline" disabled={state.busy} onClick={() => void state.refresh()}>Refresh</Button>
      {placement === 'overlay' ? <Button size="sm" variant="outline" onClick={close}>Close</Button> : null}
    </header>
    <div role="tablist" aria-label="Show" className="flex flex-wrap gap-1">
      {ADAPTIVE_FILTERS.map(entry => <button key={entry.id} role="tab" type="button" aria-selected={filter === entry.id} className={`rounded px-2 py-1 text-xs ${filter === entry.id ? 'bg-muted font-semibold' : 'text-muted-foreground'}`} onClick={() => setFilter(entry.id)}>{entry.label} {countAdaptive(state.items, entry.id)}</button>)}
    </div>
    {state.notice ? <p role="status" className="text-xs">{state.notice}</p> : null}
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-[minmax(240px,380px)_1fr]">
      <nav aria-label="Cards and tools" className={`min-h-0 overflow-auto ${narrowDetail ? 'hidden md:block' : ''}`}>
        {!state.snapshot ? <p className="p-2 text-xs text-muted-foreground">Loading…</p> : null}
        {state.snapshot && !visible.length ? (filter === 'all'
          ? <div className="grid gap-2 p-2 text-xs"><p className="font-semibold">No cards yet.</p><p className="text-muted-foreground">A card is a small recipe for how one tool call reads in the transcript. Tools that no built-in card draws appear here after their first finished call; then you can design a card for them.</p><Button size="sm" variant="outline" className="justify-self-start" onClick={() => void state.refresh()}>Refresh</Button></div>
          : <p className="p-2 text-xs text-muted-foreground">Nothing under {ADAPTIVE_FILTERS.find(entry => entry.id === filter)!.label}.</p>) : null}
        {visible.map(item => {
          const row = describeAdaptiveItem(item, state.origins), on = item.key === selected?.key
          const header = filter === 'all' && row.section !== lastSection ? <h4 key={`s:${row.section}`} className="px-2 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{row.section}</h4> : null
          lastSection = row.section
          return [header, <button key={item.key} type="button" aria-pressed={on} className={`block w-full rounded px-2 py-1 text-left ${on ? 'bg-muted' : 'hover:bg-muted/50'}`} onClick={() => { setSelectedKey(item.key); state.disarm(); setNarrowDetail(true) }}>
            <span className={`block break-all text-sm font-medium ${row.tone === 'muted' ? '' : TONE_CLASS[row.tone]}`}><span aria-hidden>{row.glyph} </span>{row.title}</span>
            <span className="block break-all text-xs text-muted-foreground">{row.sub}</span>
          </button>]
        })}
      </nav>
      <div className={`min-h-0 ${narrowDetail ? '' : 'hidden md:block'}`}>
        {selected ? <>
          <Button size="sm" variant="ghost" className="mb-1 md:hidden" onClick={() => setNarrowDetail(false)}>‹ List</Button>
          <Detail state={state} item={selected} tab={tab} setTab={setTab} />
        </> : <div className="grid h-full place-content-center gap-1 p-4 text-center text-xs"><p className="font-semibold">Select a card or a tool</p><p className="text-muted-foreground">The list shows your cards and the tools no built-in card draws.</p></div>}
      </div>
    </div>
  </section>
  if (placement !== 'overlay') return body
  return <div role="dialog" aria-modal="true" aria-label="Adaptive UI" className="fixed inset-0 z-50 grid place-items-center bg-black/40"><div className="h-[min(760px,92vh)] w-[min(1040px,96vw)] overflow-hidden rounded-lg border shadow-xl">{body}</div></div>
}
export const module: PluginViewModule<WebPluginView> = { apiVersion: PLUGIN_API_VERSION, pluginId: 'adaptive-ui', views: { 'adaptive-ui': AdaptiveUi } }
