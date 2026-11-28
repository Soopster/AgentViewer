/** @jsxImportSource @opentui/react */
import { useEffect, useRef, useState } from 'react'
import type { BoxRenderable, ScrollBoxRenderable, TextareaRenderable } from '@opentui/core'
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import { captureMemoryReply, type ProjectMemoryNote } from '../../../lib/plugins/projectMemory'
import { popoverRootProps, PopoverDetachButton, fitText, ShortcutHelp, type ShortcutHelpGroup, type TuiPluginView, type TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'
import { useMemoryView } from '../useMemoryView'
const FILTERS = ['All notes', 'Agent', 'Drafts', 'Approved', 'Pinned', 'Decisions', 'Conventions', 'Lessons'] as const
type Filter = typeof FILTERS[number]
const TABS = ['Note', 'Source', 'Recall'] as const
type Tab = typeof TABS[number]
type Region = 'filters' | 'notes' | 'detail'
const matches = (note: ProjectMemoryNote, filter: Filter) => filter === 'All notes' || (filter === 'Agent' && note.author === 'agent') || (filter === 'Drafts' && !note.reviewed && note.author !== 'agent') || (filter === 'Approved' && note.reviewed) || (filter === 'Pinned' && note.pinned) || (filter === 'Decisions' && note.kind === 'decision') || (filter === 'Conventions' && note.kind === 'convention') || (filter === 'Lessons' && note.kind === 'lesson')
const HELP: readonly ShortcutHelpGroup[] = [
  { title: 'Navigate', rows: [['1 / 2 / 3', 'Filters / notes / details'], ['Tab / Shift+Tab', 'Next / previous pane'], ['← / →', 'Switch detail tabs'], ['j/k or ↑/↓', 'Move selection or scroll note'], ['Enter', 'Open note or choose filter'], ['Ctrl+N', 'Toggle filters'], ['/', 'Search memory']] },
  { title: 'Write and review', rows: [['n / c', 'New note / capture latest reply'], ['t / e', 'Edit title / note text'], ['y / p', 'Cycle type / toggle pin'], ['s / Ctrl+S', 'Save draft / save in editor'], ['a', 'Approve saved note / return to draft'], ['d', 'Delete saved note']] },
  { title: 'Recall and source', rows: [['r', 'Toggle automatic recall for this project'], ['m', 'Toggle agents keeping their own memory'], ['o', 'Open source conversation']] },
]
function ProjectMemory(props: TuiPluginViewProps) {
  const { services, theme, width, height, focused, placement, detach, registerKeys, setCapture, useState: scoped } = props
  const state = useMemoryView(services['project-memory']!, services.repository!.cwd, scoped)
  const [editing, setEditing] = scoped<'title' | 'body' | 'search' | null>('editing', null)
  const [filter, setFilter] = scoped<Filter>('filter', 'All notes'), [tab, setTab] = scoped<Tab>('tab', 'Note')
  const [region, setRegion] = scoped<Region>('region', 'notes'), [sidebar, setSidebar] = scoped('sidebar', true)
  const [creating, setCreating] = scoped('creating', false), [initialized, setInitialized] = scoped('initialized', false)
  const [navigationOpen, setNavigationOpen] = useState(false), [help, setHelp] = useState(false)
  const editor = useRef<TextareaRenderable>(null), list = useRef<ScrollBoxRenderable>(null), selectedRow = useRef<BoxRenderable>(null)
  const content = useRef<ScrollBoxRenderable>(null), helpScroll = useRef<ScrollBoxRenderable>(null)
  const excerpt = captureMemoryReply(services['session-transcript']?.detail?.rawMessages ?? []), session = services.session?.session
  const overlay = placement === 'overlay', w = overlay ? Math.max(1, Math.min(width - 4, 150)) : width, h = overlay ? Math.max(1, height - 4) : height
  const inner = Math.max(1, w - 2), narrow = w < 80, full = w >= 110
  const showFilters = full ? sidebar : navigationOpen
  const showNotes = (full || !navigationOpen) && (!narrow || region !== 'detail')
  const showDetail = (full || !navigationOpen) && (!narrow || region === 'detail')
  const filterWidth = full ? Math.min(25, Math.floor(inner * .2)) : inner
  const listWidth = narrow ? inner : Math.min(36, Math.floor(inner * .3))
  const detailWidth = Math.max(1, inner - (showFilters ? filterWidth : 0) - (showNotes ? listWidth : 0))
  const notes = state.notes.filter(note => matches(note, filter)), all = state.snapshot?.notes ?? []
  const hasDraft = state.note ? notes.some(note => note.id === state.note?.id) : creating || Boolean(state.draft.title || state.draft.body)
  const canSave = state.dirty && Boolean(state.draft.title.trim() && state.draft.body.trim())
  const choose = (id: string) => { state.select(id); setCreating(false); if (narrow) setRegion('detail'); else setRegion('notes'); setNavigationOpen(false) }
  const chooseFilter = (next: Filter, keepFocus = false) => {
    setFilter(next)
    const first = state.notes.find(note => matches(note, next)); if (first) state.select(first.id)
    if (!keepFocus) { setRegion('notes'); setNavigationOpen(false) }
  }
  const openEditor = (field: 'title' | 'body') => { setEditing(field); setRegion('detail'); setNavigationOpen(false); setTab('Note'); setCreating(true) }
  const create = (capture = false) => {
    if (capture && (!excerpt || !session?.provider)) return
    state.create(capture ? excerpt!.text : '', capture ? { provider: session!.provider!, providerInstanceId: session!.providerInstanceId, sessionId: session!.sessionId, messageUuid: excerpt!.uuid } : undefined)
    setCreating(true); setRegion('detail'); setNavigationOpen(false); setTab('Note'); setEditing('title')
  }
  const changeTab = (next: Tab) => { setTab(next); setRegion('detail'); setNavigationOpen(false) }
  const toggleSidebar = () => { if (full) { setSidebar(!sidebar); if (region === 'filters') setRegion('notes') } else { setNavigationOpen(!navigationOpen); setRegion(navigationOpen ? 'notes' : 'filters') } }
  useEffect(() => {
    if (!initialized && state.snapshot) { setInitialized(true); if (!state.draft.title && !state.draft.body && !creating && state.notes[0]) state.select(state.notes[0].id) }
  }, [initialized, state.snapshot, state.notes, state.draft.title, state.draft.body, creating, state.select, setInitialized])
  useEffect(() => { setCapture(focused ? editing ? 'input' : help : false); return () => setCapture(false) }, [editing, help, focused, setCapture])
  useEffect(() => { if (selectedRow.current) list.current?.scrollChildIntoView(selectedRow.current) }, [state.note?.id, showNotes, filter])
  useEffect(() => { content.current?.scrollTo(0) }, [state.draft.id, tab])
  useEffect(() => {
    registerKeys(key => {
      if (!focused) return false
      if (help) {
        if (key.name === 'escape' || key.name === '?' || key.sequence === '?') setHelp(false)
        else if (key.name === 'j' || key.name === 'down') helpScroll.current?.scrollBy(1)
        else if (key.name === 'k' || key.name === 'up') helpScroll.current?.scrollBy(-1)
        else if (key.name === 'pagedown') helpScroll.current?.scrollBy(10)
        else if (key.name === 'pageup') helpScroll.current?.scrollBy(-10)
        return true
      }
      if (editing) {
        if (key.name === 'escape') { setEditing(null); return true }
        if (editing === 'search' && key.name === 'return') { setEditing(null); return true }
        if (editing === 'title' && key.name === 'return' && !key.shift) { setEditing('body'); return true }
        if (key.ctrl && key.name === 's') { if (editing === 'search') setEditing(null); else void state.save().then(ok => { if (ok) setEditing(null) }); return true }
        return false
      }
      if (key.ctrl && key.name === 'n') { toggleSidebar(); return true }
      if (key.ctrl || key.meta || state.busy) return false
      const move = (delta: number) => {
        if (region === 'filters') chooseFilter(FILTERS[Math.max(0, Math.min(FILTERS.length - 1, FILTERS.indexOf(filter) + delta))], true)
        else if (region === 'detail') content.current?.scrollBy(delta)
        else { const at = notes.findIndex(note => note.id === state.note?.id), next = notes[Math.max(0, Math.min(notes.length - 1, at + delta))]; if (next) state.select(next.id) }
      }
      const actions: Record<string, () => void> = {
        escape: () => { if (navigationOpen) { setNavigationOpen(false); setRegion('notes') } else if (tab !== 'Note') changeTab('Note'); else if (region !== 'notes') setRegion('notes'); else props.close() },
        '?': () => setHelp(true), n: () => create(), c: () => create(true), t: () => openEditor('title'), e: () => openEditor('body'),
        '/': () => { setEditing('search'); setRegion('notes'); setNavigationOpen(false) },
        '1': () => { if (full) setSidebar(true); else setNavigationOpen(true); setRegion('filters') },
        '2': () => { setRegion('notes'); setNavigationOpen(false) }, '3': () => { setRegion('detail'); setNavigationOpen(false) },
        tab: () => { if (navigationOpen) { setNavigationOpen(false); setRegion('notes'); return } const regions: Region[] = [...(showFilters ? ['filters' as const] : []), 'notes', 'detail']; setRegion(regions[(regions.indexOf(region) + (key.shift ? regions.length - 1 : 1)) % regions.length]) },
        left: () => changeTab(TABS[(TABS.indexOf(tab) + 2) % TABS.length]), right: () => changeTab(TABS[(TABS.indexOf(tab) + 1) % TABS.length]),
        j: () => move(1), down: () => move(1), k: () => move(-1), up: () => move(-1),
        return: () => { if (region === 'filters') { setNavigationOpen(false); setRegion('notes') } else { setRegion('detail'); setTab('Note') } },
        s: () => { if (canSave) void state.save() }, a: () => { if (hasDraft) void state.review() }, d: () => { if (hasDraft) void state.remove().then(ok => { if (ok) setCreating(false) }) },
        r: () => { void state.recall() }, m: () => { void state.toggleAgentMemory() }, p: () => { if (hasDraft) state.edit({ pinned: !state.draft.pinned }) },
        y: () => { if (hasDraft) state.edit({ kind: state.draft.kind === 'decision' ? 'convention' : state.draft.kind === 'convention' ? 'lesson' : 'decision' }) },
        o: () => { if (hasDraft && state.draft.source) services['session-navigation']?.open(state.draft.source, state.draft.source.messageUuid) },
      }
      const action = actions[key.sequence === '?' ? '?' : key.name]; if (!action) return false; action(); return true
    }); return () => registerKeys(null)
  })
  const action = (label: string, run: () => void, enabled = true) => <box paddingX={1} flexShrink={0} onMouseDown={() => { if (focused && !state.busy && enabled) run() }}><text fg={enabled ? theme.cyan : theme.dim} wrapMode="none">{label}</text></box>
  const status = state.dirty ? 'Unsaved changes' : state.note?.author === 'agent' ? 'Agent note' : state.note?.reviewed ? 'Approved' : 'Draft'
  return <box {...popoverRootProps(!overlay, { top: 2, left: Math.max(0, Math.floor((width - w) / 2)), width: w, height: h }, props.zIndex ?? 50)} border={overlay} borderColor={theme.border2} backgroundColor={theme.surface} flexDirection="column" overflow="hidden" title={overlay ? ' Shared Project Memory ' : undefined}>
    {overlay && detach ? <PopoverDetachButton theme={theme} onPress={detach} /> : null}
    <box height={1} flexShrink={0} flexDirection="row" paddingX={1}>
      {action(full ? showFilters ? '[◀]' : '[▶]' : '[≡]', toggleSidebar)}
      <box flexGrow={1} minWidth={0}><text fg={theme.cyan} wrapMode="none">{fitText(`[Repo] ${services.repository!.cwd.split('/').pop()} · ${all.length} ${all.length === 1 ? 'note' : 'notes'}`, Math.max(1, inner - 40))}</text></box>
      {action(state.agentMemory ? '[m] Agents on' : '[m] Agents off', () => { void state.toggleAgentMemory() }, Boolean(state.snapshot))}
      {action(state.snapshot?.autoRecall ? '[r] Recall on' : '[r] Recall off', () => { void state.recall() }, Boolean(state.snapshot))}
    </box>
    {state.notice ? <text fg={theme.amber} wrapMode="word">{state.notice}</text> : null}
    <box flexGrow={1} minHeight={0} flexDirection="row">
      {showFilters ? <box width={filterWidth} flexShrink={0} flexDirection="column" backgroundColor={theme.surface2} border={full ? ['right'] : false} borderColor={region === 'filters' ? theme.cyan : theme.border}>
        <box height={1} flexShrink={0} paddingX={1}><text fg={theme.cyan}>[1] Memory</text></box>
        {FILTERS.map(value => <box key={value} height={1} flexShrink={0} paddingX={1} backgroundColor={filter === value ? theme.surface3 : undefined} onMouseDown={() => { if (focused && !state.busy) chooseFilter(value) }}><text fg={filter === value ? theme.cyan : theme.text} wrapMode="none">{fitText(`${filter === value ? '›' : ' '} ${value} (${all.filter(note => matches(note, value)).length})`, filterWidth - 3)}</text></box>)}
        <box flexGrow={1} />
        {action('[n] New note', () => create())}
        {action('[c] Capture reply', () => create(true), Boolean(excerpt && session?.provider))}
      </box> : null}
      {showNotes ? <box width={listWidth} flexShrink={0} flexDirection="column" border={!narrow ? ['right'] : false} borderColor={region === 'notes' ? theme.cyan : theme.border}>
        <box height={1} flexShrink={0} paddingX={1} backgroundColor={region === 'notes' ? theme.surface3 : theme.surface2} onMouseDown={() => { if (focused) setRegion('notes') }}><text fg={theme.cyan}>{`[2] Notes (${notes.length})`}</text></box>
        <box height={1} flexShrink={0} paddingX={1} onMouseDown={() => { if (focused) { setEditing('search'); setRegion('notes') } }}><text fg={theme.dim} wrapMode="none">{fitText(`/ ${state.query || 'Search memory'}`, listWidth - 3)}</text></box>
        {editing === 'search' ? <box height={3} flexShrink={0}><textarea ref={editor} initialValue={state.query} focused={focused} width="100%" onContentChange={() => state.setQuery(editor.current?.plainText ?? '')} /></box> : null}
        <scrollbox ref={list} flexGrow={1} minHeight={1}>
          {!state.note && hasDraft ? <box height={2} flexShrink={0} flexDirection="column" paddingX={1} backgroundColor={theme.surface3} onMouseDown={() => { if (focused) setRegion('detail') }}><text fg={theme.cyan} wrapMode="none">{fitText(`› ${state.draft.title || 'Untitled draft'}`, listWidth - 3)}</text><text fg={theme.amber}>Unsaved draft</text></box> : null}
          {notes.map(note => <box key={note.id} ref={state.note?.id === note.id ? selectedRow : undefined} height={2} flexShrink={0} flexDirection="column" paddingX={1} backgroundColor={state.note?.id === note.id ? theme.surface3 : undefined} onMouseDown={() => { if (focused && !state.busy && !editing) choose(note.id) }}>
            <text fg={state.note?.id === note.id ? theme.cyan : theme.text} wrapMode="none">{fitText(`${state.note?.id === note.id ? '›' : ' '} ${note.title}`, listWidth - 3)}</text>
            <text fg={note.author === 'agent' ? theme.cyan : note.reviewed ? theme.green : theme.dim} wrapMode="none">{fitText(`${note.kind} · ${note.author === 'agent' ? 'agent' : note.reviewed ? 'approved' : 'draft'}${note.pinned ? ' · pinned' : ''}`, listWidth - 3)}</text>
          </box>)}
          {!notes.length ? <box padding={1}><text fg={theme.dim} wrapMode="word">{state.snapshot ? all.length ? 'No notes match this view. Change the filter or search.' : 'No project notes yet.' : 'Loading project memory…'}</text></box> : null}
        </scrollbox>
      </box> : null}
      {showDetail ? <box width={narrow ? inner : detailWidth} flexShrink={0} flexDirection="column" minWidth={0} onMouseDown={() => { if (focused) setRegion('detail') }}>
        <box height={1} flexShrink={0} flexDirection="row" backgroundColor={theme.surface2}>{TABS.map(value => <box key={value} paddingX={1} backgroundColor={value === tab ? theme.surface3 : undefined} onMouseDown={() => { if (focused && !editing) changeTab(value) }}><text fg={value === tab ? theme.cyan : theme.muted}>{value}</text></box>)}</box>
        {tab === 'Recall' ? <scrollbox ref={content} flexGrow={1} minHeight={1} padding={1}>
          <text fg={theme.cyan}>{`Automatic recall · ${state.snapshot?.autoRecall ? 'on' : 'off'}`}</text>
          <text fg={theme.text} wrapMode="word">Approved project notes can be recalled on new turns across providers using this repository. Current task and session instructions take precedence.</text>
          <text fg={theme.cyan}>{`Agent memory · ${state.agentMemory ? 'on' : 'off'}`}</text>
          <text fg={theme.text} wrapMode="word">Agents save what they learn here as they work and recall it in later sessions, without approval. Edit or delete any of their notes; editing one makes it yours.</text>
          <text fg={theme.dim} wrapMode="word">{`${all.filter(note => note.author === 'agent').length} agent notes`}</text>
          {action(state.agentMemory ? '[m] Turn agent memory off' : '[m] Turn agent memory on', () => { void state.toggleAgentMemory() }, Boolean(state.snapshot))}
          <text fg={theme.dim} wrapMode="word">{`${all.filter(note => note.reviewed).length} approved · ${all.filter(note => note.reviewed && note.pinned).length} pinned for recall`}</text>
          {action(state.snapshot?.autoRecall ? '[r] Turn recall off' : '[r] Turn recall on', () => { void state.recall() }, Boolean(state.snapshot))}
          <text fg={theme.dim} wrapMode="word">Drafts are excluded. Save and approve edits before recalling them. Pinning makes an approved note eligible even without a keyword match.</text>
        </scrollbox> : !hasDraft && (!editing || editing === 'search') ? <box flexGrow={1} flexDirection="column" justifyContent="center" alignItems="center" paddingX={2} gap={1}>
          <text fg={theme.text}>Build shared project memory</text>
          <text fg={theme.dim} wrapMode="word">Keep decisions, conventions, and lessons with this repository.</text>
          {action('[n] Create a note', () => create())}
          {action('[c] Capture latest reply', () => create(true), Boolean(excerpt && session?.provider))}
          <text fg={theme.dim} wrapMode="word">Save a draft, then approve it for recall.</text>
        </box> : <>
          <box height={1} flexShrink={0} paddingX={1}><text fg={theme.text} wrapMode="none">{fitText(state.draft.title || 'Untitled draft', detailWidth - 2)}</text></box>
          <box height={1} flexShrink={0} paddingX={1}><text fg={state.dirty ? theme.amber : state.note?.reviewed ? theme.green : theme.dim} wrapMode="none">{fitText(`${state.draft.kind} · ${status}${state.draft.pinned ? ' · pinned' : ''}`, detailWidth - 2)}</text></box>
          {editing && editing !== 'search' ? <box flexGrow={1} minHeight={2} flexDirection="column" paddingX={1}>
            <text fg={theme.cyan} wrapMode="word">{`Edit ${editing} · Ctrl+S save${editing === 'title' ? ' · Enter text' : ''} · Esc keep draft`}</text>
            <textarea key={`${state.draft.id}:${editing}`} ref={editor} initialValue={state.draft[editing]} focused={focused} flexGrow={1} width="100%" onContentChange={() => state.edit({ [editing]: editor.current?.plainText ?? '' })} />
          </box> : tab === 'Source' ? <scrollbox ref={content} flexGrow={1} minHeight={1} padding={1}>
            {state.draft.source ? <><text fg={theme.cyan}>Captured from a session</text><text fg={theme.text} wrapMode="word">{`${state.draft.source.provider}@${state.draft.source.providerInstanceId ?? 'default'}\nSession: ${state.draft.source.sessionId}\nMessage: ${state.draft.source.messageUuid ?? 'not recorded'}`}</text>{action('[o] Open conversation', () => { services['session-navigation']?.open(state.draft.source!, state.draft.source!.messageUuid) }, Boolean(services['session-navigation']))}</> : <text fg={theme.dim} wrapMode="word">Manually written note. Capture a session reply to keep a link to its source.</text>}
          </scrollbox> : <>
            <box height={1} flexShrink={0} flexDirection="row" backgroundColor={theme.surface2} overflow="hidden">{action('[t] Title', () => openEditor('title'))}{action('[e] Text', () => openEditor('body'))}{action(`[y] ${state.draft.kind}`, () => state.edit({ kind: state.draft.kind === 'decision' ? 'convention' : state.draft.kind === 'convention' ? 'lesson' : 'decision' }))}{action(state.draft.pinned ? '[p] Unpin' : '[p] Pin', () => state.edit({ pinned: !state.draft.pinned }))}</box>
            <scrollbox ref={content} flexGrow={1} minHeight={1} paddingX={1}><text fg={theme.text} wrapMode="word">{state.draft.body || 'Add the decision, convention, or lesson to remember.'}</text></scrollbox>
          </>}
          {!editing ? <box flexDirection="row" flexWrap="wrap" flexShrink={0} backgroundColor={theme.surface2}>{action('[s] Save draft', () => { void state.save() }, canSave)}{action(state.note?.reviewed ? '[a] Return to draft' : '[a] Approve', () => { void state.review() }, Boolean(state.note && !state.dirty))}{action('[d] Delete', () => { void state.remove().then(ok => { if (ok) setCreating(false) }) }, Boolean(state.note))}</box> : null}
        </>}
      </box> : null}
    </box>
    <box height={1} flexShrink={0} paddingX={1}><text fg={state.busy ? theme.amber : theme.dim} wrapMode="none">{fitText(help ? '' : state.busy ? 'Saving…' : editing === 'search' ? 'Search memory · Enter done · Esc back' : editing ? 'Ctrl+S save draft · Esc keep draft' : 'Tab focus · ←/→ tabs · / search · ? help · Esc back/close', inner - 2)}</text></box>
    {help ? <ShortcutHelp title="Memory shortcuts" groups={HELP} theme={theme} width={inner} height={h - (overlay ? 2 : 0)} scrollRef={helpScroll} onClose={() => { if (focused) setHelp(false) }} /> : null}
  </box>
}
export const module: PluginViewModule<TuiPluginView> = { apiVersion: PLUGIN_API_VERSION, pluginId: 'project-memory', views: { 'project-memory': ProjectMemory } }
