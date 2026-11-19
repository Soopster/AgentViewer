'use client'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { PLUGIN_API_VERSION, type PluginViewModule } from '@/lib/plugins/types'
import { captureMemoryReply } from '@/lib/plugins/projectMemory'
import type { WebPluginView, WebPluginViewProps } from '@/components/shell/pluginTypes'
import { useMemoryView } from '../useMemoryView'
function ProjectMemory({ services, placement, close, useState: scoped }: WebPluginViewProps) {
  const state = useMemoryView(services['project-memory']!, services.repository!.cwd, scoped)
  const excerpt = captureMemoryReply(services['session-transcript']?.rawMessages ?? []), session = services.session?.session
  useEffect(() => { if (placement !== 'overlay') return; const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) close() }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key) }, [placement, close])
  const body = <section data-plugin-view="project-memory" aria-label="Shared Project Memory" className="flex h-full min-h-0 flex-col gap-3 overflow-auto bg-background p-4 text-foreground">
    <header className="flex flex-wrap items-center gap-2"><h2 className="mr-auto font-semibold">Shared Project Memory</h2><Button size="sm" variant="outline" disabled={state.busy} onClick={() => state.create()}>New note</Button><Button size="sm" variant="outline" disabled={state.busy} onClick={() => void state.refresh()}>Refresh memory</Button>{placement === 'overlay' ? <Button size="sm" variant="ghost" onClick={close}>Close</Button> : null}</header>
    <p className="break-all text-xs text-muted-foreground">{services.repository!.cwd}</p>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={state.busy || !state.snapshot} checked={state.snapshot?.autoRecall ?? false} onChange={() => void state.recall()} />Recall approved memory on new turns</label>
    <p className="text-xs text-muted-foreground">Only approved notes are recalled across providers. Editing a note returns it to draft.</p>
    {state.notice ? <p role="status" className="text-sm">{state.notice}</p> : null}
    <div className="grid min-h-64 flex-1 grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-4">
      <section aria-label="Memory notes" className="min-h-0 overflow-auto"><label className="text-xs">Search memory<input className="my-2 w-full rounded border bg-background p-2" value={state.query} onChange={event => state.setQuery(event.target.value)} /></label>{state.notes.map(note => <button key={note.id} type="button" className="mb-2 block w-full rounded border p-2 text-left" aria-pressed={state.note?.id === note.id} onClick={() => state.select(note.id)}><span className="block text-sm font-medium">{note.title}</span><span className="text-xs text-muted-foreground">{note.kind} · {note.reviewed ? 'approved' : 'draft'}{note.pinned ? ' · pinned' : ''}</span></button>)}</section>
      <section aria-label="Memory editor" className="flex min-h-0 flex-col gap-2">
        <label className="text-xs">Note title<input className="mt-1 w-full rounded border bg-background p-2 text-sm" disabled={state.busy} value={state.draft.title} onChange={event => state.edit({ title: event.target.value })} /></label>
        <label className="text-xs">Note type<select className="ml-2 rounded border bg-background p-1" disabled={state.busy} value={state.draft.kind} onChange={event => state.edit({ kind: event.target.value as typeof state.draft.kind })}><option value="decision">Decision</option><option value="convention">Convention</option><option value="lesson">Lesson</option></select></label>
        <label className="text-xs">Memory text<Textarea aria-label="Memory text" className="min-h-48" disabled={state.busy} value={state.draft.body} onChange={event => state.edit({ body: event.target.value })} /></label>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" disabled={state.busy} checked={state.draft.pinned} onChange={event => state.edit({ pinned: event.target.checked })} />Pin for recall even without a keyword match</label>
        <div className="flex flex-wrap gap-2"><Button size="sm" disabled={state.busy || !state.draft.title.trim() || !state.draft.body.trim()} onClick={() => void state.save()}>Save draft</Button><Button size="sm" variant="outline" disabled={state.busy || !state.note || state.dirty} onClick={() => void state.review()}>{state.note?.reviewed ? 'Return to draft' : 'Approve note'}</Button><Button size="sm" variant="ghost" disabled={state.busy || !state.note} onClick={() => void state.remove()}>Delete note</Button></div>
        <Button size="sm" variant="outline" disabled={state.busy || !excerpt || !session?.provider} onClick={() => { if (excerpt && session?.provider) state.create(excerpt.text, { provider: session.provider, providerInstanceId: session.providerInstanceId, sessionId: session.sessionId, messageUuid: excerpt.uuid }) }}>Capture latest reply</Button>
        {state.draft.source ? <div className="text-xs"><p className="break-all">Source: {state.draft.source.provider}@{state.draft.source.providerInstanceId ?? 'default'} · {state.draft.source.sessionId}</p><Button variant="ghost" size="sm" disabled={!services['session-navigation']} onClick={() => { if (state.draft.source) services['session-navigation']?.open(state.draft.source, state.draft.source.messageUuid) }}>Open source conversation</Button></div> : null}
      </section>
    </div>
  </section>
  return placement === 'overlay' ? <div role="dialog" aria-modal="true" aria-label="Shared Project Memory" className="fixed inset-0 z-50 grid place-items-center bg-black/40"><div className="h-[min(800px,92vh)] w-[min(1100px,96vw)] overflow-hidden rounded-lg border shadow-xl">{body}</div></div> : body
}
export const module: PluginViewModule<WebPluginView> = { apiVersion: PLUGIN_API_VERSION, pluginId: 'project-memory', views: { 'project-memory': ProjectMemory } }
