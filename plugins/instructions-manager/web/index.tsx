'use client'
import './styles.css'
import { useEffect, useRef, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { NativeSelect } from '@/components/ui/native-select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { PLUGIN_API_VERSION, type PluginViewModule } from '@/lib/plugins/types'
import { INSTRUCTION_SCOPE_HELP } from '@/lib/plugins/instructionsManager'
import type { WebPluginView, WebPluginViewProps } from '@/components/shell/pluginTypes'
import { useInstructionsView, type InstructionsViewState, type InstructionsTab } from '../useInstructionsView'
const TABS: readonly [InstructionsTab, string][] = [['read', 'Read'], ['edit', 'Edit'], ['copy', 'Copy'], ['preview', 'Preview'], ['history', 'History']]
const MARKDOWN_COMPONENTS: Components = {
        h1: props => <h1 {...props} className="my-3 text-xl font-semibold" />, h2: props => <h2 {...props} className="my-3 text-lg font-semibold" />, h3: props => <h3 {...props} className="my-2 font-semibold" />,
        p: props => <p {...props} className="my-2 text-sm leading-relaxed" />, ul: props => <ul {...props} className="my-2 list-disc pl-5 text-sm" />, ol: props => <ol {...props} className="my-2 list-decimal pl-5 text-sm" />,
        pre: props => <pre {...props} className="my-2 overflow-auto rounded border bg-muted p-2 font-mono text-xs" />, code: props => <code {...props} className="font-mono text-xs" />,
        table: props => <div className="overflow-x-auto"><table {...props} className="my-2 border-collapse text-sm" /></div>, th: props => <th {...props} className="border p-2 text-left" />, td: props => <td {...props} className="border p-2" />,
        a: props => <a {...props} className="underline" target="_blank" rel="noreferrer" />,
      }
function Inventory({ state }: { state: InstructionsViewState }) {
  const [newPath, setNewPath] = useState('.claude/rules/project.md')
  return <section aria-label="Instruction files" className="flex min-h-0 flex-col gap-2">
    <label className="text-xs">Search instructions<Input value={state.query} onChange={event => state.setQuery(event.target.value)} /></label>
    <label className="text-xs">Instruction scope<NativeSelect aria-label="Instruction scope" className="ml-2 rounded border bg-background p-1" value={state.scope} onChange={event => state.setScope(event.target.value)}>{['all', 'user', 'project', 'nested', 'ancestor'].map(scope => <option key={scope} value={scope}>{scope}</option>)}</NativeSelect></label>
    <p className="text-xs text-muted-foreground">{state.files.length} files and creation targets</p>
    <div className="max-h-96 min-h-0 flex-1 overflow-auto">{state.files.map(file => <button key={file.id} type="button" aria-pressed={state.selected === file.path} disabled={state.busy} className="mb-1 block w-full rounded border p-2 text-left aria-pressed:bg-muted" onClick={() => state.select(file.path)}><span className="block break-all text-xs font-medium">{file.label}</span><span className="block text-xs text-muted-foreground">{file.scope} · {file.exists ? 'on disk' : 'missing'}{file.writable ? '' : ' · read only'}</span></button>)}</div>
    <label className="text-xs">New rule path<Input value={newPath} disabled={state.busy} onChange={event => setNewPath(event.target.value)} placeholder=".github/instructions/tests.instructions.md" /></label>
    <Button size="sm" variant="outline" disabled={state.busy || !newPath.trim()} onClick={() => state.newRule(newPath)}>Open or create rule</Button>
    <p className="text-xs text-muted-foreground">Use a Markdown path in .claude/rules or a .instructions.md path in .github/instructions.</p>
  </section>
}
function Reader({ state }: { state: InstructionsViewState }) {
  const [rich, setRich] = useState(true)
  const value = state.content
  if (!value) return <p className="text-sm">Select an instruction file to read or create it.</p>
  const body = value.text.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
  return <section aria-label="Instruction content" className="flex flex-col gap-3">
    <Button size="sm" variant="outline" onClick={() => setRich(!rich)}>{rich ? 'Show raw' : 'Show rich'}</Button>
    {!value.file.exists ? <p>This file does not exist yet. Open Edit to create it.</p> : rich ? <><div className="instructions-reader max-w-none text-foreground"><ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>{body}</ReactMarkdown></div>{value.metadata ? <details><summary>Rule metadata</summary><pre className="whitespace-pre-wrap break-words text-xs">{value.metadata}</pre></details> : null}</> : <pre className="whitespace-pre-wrap break-words text-xs">{value.text}</pre>}
    {value.references.length ? <details><summary>Referenced Markdown · not expanded</summary>{value.references.map(reference => <p className="break-all text-xs" key={reference}>{reference}</p>)}</details> : null}
  </section>
}
function Editor({ state }: { state: InstructionsViewState }) {
  return <section aria-label="Instruction editor" className="flex flex-col gap-2">
    <label className="text-xs">Instruction text<Textarea aria-label="Instruction text" className="mt-2 min-h-80 font-mono" disabled={state.busy || !state.content?.file.writable || !state.draft} value={state.draft?.text ?? ''} onChange={event => state.edit(event.target.value)} /></label>
    <div className="flex flex-wrap gap-2"><Button size="sm" disabled={state.busy || !state.content?.file.writable || !state.draft} onClick={() => void state.prepare(false)}>Preview save</Button><Button size="sm" variant="outline" disabled={state.busy} onClick={state.reload}>Reload editor</Button></div>
    <p className="text-xs text-muted-foreground">{state.dirty ? 'Unsaved draft. ' : ''}Leaving this tab keeps the draft in this view. Reload editor discards it.</p>
  </section>
}
function Copy({ state }: { state: InstructionsViewState }) {
  return <section aria-label="Copy instructions" className="flex flex-col gap-3"><p className="text-sm">Copy the complete on-disk text. The source stays unchanged; imports and frontmatter are preserved as written.</p>
    <label className="text-xs">Copy destination<NativeSelect aria-label="Copy destination" className="mt-2 w-full rounded border bg-background p-2" value={state.destination} disabled={state.busy} onChange={event => state.setDestination(event.target.value)}><option value="">Choose an instruction file</option>{state.snapshot?.files.filter(file => file.writable && file.path !== state.selected).map(file => <option key={file.id} value={file.path}>{file.scope} · {file.label} · {file.consumers.join(', ')}</option>)}</NativeSelect></label>
    <Button size="sm" disabled={state.busy || !state.destination || !state.content?.hash || state.dirty} onClick={() => void state.prepare(true)}>Preview copy</Button>{state.dirty ? <p className="text-xs">Save or reload your editor draft before copying.</p> : null}
  </section>
}
function Preview({ state }: { state: InstructionsViewState }) {
  const value = state.preview
  if (!value) return <p className="text-sm">Preview a save or copy to inspect the exact before and after text.</p>
  return <section aria-label="Instruction change preview" className="flex flex-col gap-3"><h3 className="font-medium">{value.status} · {value.change.source ? 'copy' : 'save'}</h3><p className="break-all text-xs">{value.file.path}</p>{value.notices.map(notice => <p key={notice} className="text-xs text-muted-foreground">{notice}</p>)}<div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-3"><section><h4 className="text-sm font-medium">Before</h4><pre aria-label="Before instructions" className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded border p-2 text-xs">{value.before || '(empty)'}</pre></section><section><h4 className="text-sm font-medium">After</h4><pre aria-label="After instructions" className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded border p-2 text-xs">{value.change.text || '(empty)'}</pre></section></div>
    {value.status === 'replace' ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={state.replace} disabled={state.busy} onChange={event => state.setReplace(event.target.checked)} />Replace existing instructions and save a backup</label> : null}
    <Button size="sm" disabled={state.busy || (value.status === 'replace' && !state.replace)} onClick={() => void state.apply()}>Apply reviewed change</Button>
  </section>
}
function History({ state }: { state: InstructionsViewState }) {
  const receipts = [state.receipt, ...(state.snapshot?.receipts ?? []).filter(item => item.requestId !== state.receipt?.requestId)].filter(item => item !== null)
  return <section aria-label="Instruction history" className="flex flex-col gap-2">{!receipts.length ? <p className="text-sm">No instruction changes yet.</p> : receipts.map(receipt => <article key={receipt.requestId} className="rounded border p-2 text-xs"><p>{receipt.status} · {new Date(receipt.createdAt).toISOString()}</p><p className="break-all">{receipt.path}</p>{receipt.backup ? <p className="break-all">Backup: {receipt.backup}</p> : null}</article>)}</section>
}
function InstructionsManager({ services, placement, close, useState: scoped }: WebPluginViewProps) {
  const state = useInstructionsView(services['instructions-manager']!, services.repository!.cwd, scoped), root = useRef<HTMLElement>(null)
  useEffect(() => { if (placement !== 'overlay') return; const previous = document.activeElement as HTMLElement | null; root.current?.focus(); return () => previous?.focus() }, [placement])
  const body = <section ref={root} tabIndex={-1} data-plugin-view="instructions-manager" aria-label="Instructions Manager" className="flex h-full min-h-0 flex-col gap-3 overflow-auto bg-background p-3 text-foreground" onKeyDown={event => { if (placement === 'overlay' && event.key === 'Escape') { event.stopPropagation(); close() } }}>
    <header className="flex flex-wrap items-center gap-2"><h2 className="mr-auto font-semibold">Instructions Manager</h2><Button size="sm" variant="outline" disabled={state.busy} onClick={() => void state.refresh()}>Refresh instructions</Button>{placement === 'overlay' ? <Button size="sm" variant="ghost" onClick={close}>Close</Button> : null}</header>
    <p className="break-all text-xs text-muted-foreground">{services.repository!.cwd}</p><p className="text-xs text-muted-foreground">{INSTRUCTION_SCOPE_HELP}</p>
    {state.notice ? <Alert role="status"><AlertDescription>{state.notice}</AlertDescription></Alert> : null}
    <div className="instructions-columns grid min-h-80 flex-1 gap-4"><Inventory state={state} /><section className="flex min-h-0 flex-col gap-2"><p className="break-all text-xs font-medium">{state.content?.file.path ?? state.selected}</p><p className="text-xs text-muted-foreground">{state.content?.file.consumers.join(' · ')} · {state.content?.file.applies}{state.content?.file.note ? ` · ${state.content.file.note}` : ''}</p><Tabs value={state.tab} onValueChange={value => state.setTab(value as InstructionsTab)} className="min-h-0 flex-1"><TabsList className="max-w-full overflow-x-auto">{TABS.map(([id, title]) => <TabsTrigger key={id} value={id}>{title}</TabsTrigger>)}</TabsList><TabsContent value="read"><Reader state={state} /></TabsContent><TabsContent value="edit"><Editor state={state} /></TabsContent><TabsContent value="copy"><Copy state={state} /></TabsContent><TabsContent value="preview"><Preview state={state} /></TabsContent><TabsContent value="history"><History state={state} /></TabsContent></Tabs></section></div>
    {state.snapshot?.diagnostics.length ? <details><summary className="text-xs">Discovery notes</summary>{state.snapshot.diagnostics.map(note => <p className="text-xs" key={note}>{note}</p>)}</details> : null}
  </section>
  return placement === 'overlay' ? <div role="dialog" aria-modal="true" aria-label="Instructions Manager" className="fixed inset-0 z-50 grid place-items-center bg-black/40"><div className="h-[min(850px,94vh)] w-[min(1200px,96vw)] overflow-hidden rounded-lg border shadow-xl">{body}</div></div> : body
}
export const module: PluginViewModule<WebPluginView> = { apiVersion: PLUGIN_API_VERSION, pluginId: 'instructions-manager', views: { 'instructions-manager': InstructionsManager } }
