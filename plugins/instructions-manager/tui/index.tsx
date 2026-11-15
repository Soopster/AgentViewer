/** @jsxImportSource @opentui/react */
import { lazy, Suspense, useEffect, useRef } from 'react'
import type { BoxRenderable, ScrollBoxRenderable, TextareaRenderable } from '@opentui/core'
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import { popoverRootProps, PopoverDetachButton, fitText, ShortcutHelp, type ShortcutHelpGroup, type TuiPluginView, type TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'
import { useInstructionsView, type InstructionsTab, type InstructionsViewState } from '../useInstructionsView'
const InstructionMarkdown = lazy(() => import('./InstructionMarkdown').then(value => ({ default: value.InstructionMarkdown })))
const TABS: InstructionsTab[] = ['read', 'edit', 'copy', 'preview', 'history']
const HELP: ShortcutHelpGroup[] = [
  { title: 'Navigate', rows: [['Tab / Enter', 'Switch list and detail'], ['j/k or ↑/↓', 'Move file/destination or scroll'], ['← / →', 'Switch detail tabs'], ['/', 'Search instruction paths and accounts'], ['g', 'Cycle scope: all/user/project/nested/ancestor'], ['v', 'Toggle raw/rich Markdown'], ['r', 'Refresh disk state; keep drafts']] },
  { title: 'Edit and copy', rows: [['e', 'Edit selected file'], ['n', 'Enter a new rule path'], ['Ctrl+S', 'Preview editor save / open entered path'], ['Escape', 'Leave editor; keep draft'], ['p', 'Preview save, or selected copy destination'], ['Space', 'Confirm replacement in Preview'], ['a', 'Apply reviewed change'], ['x', 'Reload editor from refreshed disk state'], ['h', 'Open change history and backup paths']] },
]
type Theme = TuiPluginViewProps['theme']
function FileList({ state, theme, onSelect }: { state: InstructionsViewState; theme: Theme; onSelect: (path: string) => void }) {
  const scroll = useRef<ScrollBoxRenderable>(null), row = useRef<BoxRenderable>(null)
  useEffect(() => { if (row.current) scroll.current?.scrollChildIntoView(row.current) }, [state.selected])
  return <scrollbox ref={scroll} flexGrow={1} minHeight={0}>{state.files.map(file => <box key={file.id} ref={state.selected === file.path ? row : undefined} flexDirection="column" paddingX={1} backgroundColor={state.selected === file.path ? theme.surface2 : undefined} onMouseDown={() => onSelect(file.path)}><text fg={state.selected === file.path ? theme.cyan : theme.text} wrapMode="word">{`${state.selected === file.path ? '›' : ' '} ${file.label}`}</text><text fg={theme.dim} wrapMode="word">{`${file.scope} · ${file.exists ? 'on disk' : 'missing'}${file.writable ? '' : ' · read only'}`}</text></box>)}</scrollbox>
}
function ChangePreview({ state, theme }: { state: InstructionsViewState; theme: Theme }) {
  const value = state.preview
  if (!value) return <text fg={theme.dim} wrapMode="word">Preview a save or copy before applying. Existing files require replacement selection and get a backup.</text>
  return <box flexDirection="column"><text fg={theme.cyan}>{`${value.status} · ${value.change.source ? 'copy' : 'save'}`}</text><text fg={theme.text} wrapMode="word">{value.file.path}</text>{value.notices.map(note => <text key={note} fg={theme.dim} wrapMode="word">{note}</text>)}<text fg={theme.amber}>Before</text><text fg={theme.text} wrapMode="word">{value.before || '(empty)'}</text><text fg={theme.green}>After</text><text fg={theme.text} wrapMode="word">{value.change.text || '(empty)'}</text></box>
}
function History({ state, theme }: { state: InstructionsViewState; theme: Theme }) {
  const receipts = [state.receipt, ...(state.snapshot?.receipts ?? []).filter(item => item.requestId !== state.receipt?.requestId)].filter(item => item !== null)
  return <box flexDirection="column">{state.notice ? <text fg={theme.amber} wrapMode="word">{state.notice}</text> : null}{receipts.length ? receipts.map(receipt => <box key={receipt.requestId} flexDirection="column" marginBottom={1}><text fg={theme.cyan}>{receipt.status}</text><text fg={theme.text} wrapMode="word">{receipt.path}</text>{receipt.backup ? <text fg={theme.dim} wrapMode="word">{`Backup: ${receipt.backup}`}</text> : null}</box>) : <text fg={theme.dim}>No instruction changes yet.</text>}</box>
}
function InstructionsManager(props: TuiPluginViewProps) {
  const { services, theme, width, height, focused, placement, close, detach, registerKeys, setCapture, useState: useViewState } = props
  const state = useInstructionsView(services['instructions-manager']!, services.repository!.cwd, useViewState)
  const [pane, setPane] = useViewState<'files' | 'detail'>('pane', 'files'), [editing, setEditing] = useViewState<'text' | 'search' | 'path' | null>('editing', null)
  const [newPath, setNewPath] = useViewState('new-path', '.claude/rules/project.md'), [rich, setRich] = useViewState('rich', true), [help, setHelp] = useViewState('help', false)
  const editor = useRef<TextareaRenderable>(null), detailScroll = useRef<ScrollBoxRenderable>(null), helpScroll = useRef<ScrollBoxRenderable>(null), destinationRow = useRef<BoxRenderable>(null)
  const destinations = state.snapshot?.files.filter(file => file.writable && file.path !== state.selected) ?? []
  const overlay = placement === 'overlay', w = overlay ? Math.max(1, Math.min(width - 4, 125)) : width, h = overlay ? Math.max(1, height - 4) : height
  const wide = w >= 78, listWidth = Math.max(24, Math.min(38, Math.floor(w * .32))), bodyWidth = Math.max(1, w - (wide ? listWidth + 3 : 3))
  const canAct = focused && !state.busy && !help
  useEffect(() => { setCapture(focused && (editing || help) ? 'input' : false); return () => setCapture(false) }, [focused, editing, help, setCapture])
  useEffect(() => { if (destinationRow.current) detailScroll.current?.scrollChildIntoView(destinationRow.current) }, [state.destination])
  useEffect(() => { detailScroll.current?.scrollTo(0) }, [state.selected, state.tab])
  const choose = (path: string) => { if (!canAct || editing) return; state.select(path); setPane('detail') }
  const startEdit = () => { if (canAct && state.content?.file.writable) { state.setTab('edit'); setPane('detail'); setEditing('text') } }
  useEffect(() => {
    registerKeys(key => {
      if (!focused) return false
      if (help) { if (key.name === 'escape' || key.name === '?') setHelp(false); else if (['j', 'down', 'k', 'up'].includes(key.name)) helpScroll.current?.scrollBy(key.name === 'k' || key.name === 'up' ? -1 : 1); return true }
      if (editing) {
        if (key.name === 'escape') { setEditing(null); return true }
        if (key.ctrl && key.name === 's') { const mode = editing; setEditing(null); if (mode === 'text') void state.prepare(false); if (mode === 'path') { state.newRule(newPath); setPane('detail') } return true }
        return false
      }
      if (key.ctrl || key.meta || state.busy) return false
      if (key.name === '?') { setHelp(true); return true }
      if (key.name === 'escape') { if (pane === 'detail') setPane('files'); else close(); return true }
      if (key.name === 'tab' || key.name === 'return') { setPane(pane === 'files' ? 'detail' : 'files'); return true }
      if (key.name === 'left' || key.name === 'right') { state.setTab(TABS[(TABS.indexOf(state.tab) + (key.name === 'left' ? 4 : 1)) % TABS.length]); setPane('detail'); return true }
      if (['j', 'down', 'k', 'up'].includes(key.name)) {
        const delta = key.name === 'k' || key.name === 'up' ? -1 : 1
        if (pane === 'files') { const at = state.files.findIndex(file => file.path === state.selected), next = state.files[Math.max(0, Math.min(state.files.length - 1, at + delta))]; if (next) state.select(next.path) }
        else if (state.tab === 'copy') { const at = destinations.findIndex(file => file.path === state.destination), next = destinations[Math.max(0, Math.min(destinations.length - 1, at + delta))]; if (next) state.setDestination(next.path) }
        else detailScroll.current?.scrollBy(delta)
        return true
      }
      const actions: Record<string, () => void> = {
        e: startEdit, n: () => setEditing('path'), '/': () => setEditing('search'), v: () => setRich(!rich), h: () => { state.setTab('history'); setPane('detail') }, r: () => { void state.refresh() }, x: state.reload,
        g: () => { const scopes = ['all', 'user', 'project', 'nested', 'ancestor']; state.setScope(scopes[(scopes.indexOf(state.scope) + 1) % scopes.length]) },
        p: () => { setPane('detail'); void state.prepare(state.tab === 'copy') },
        space: () => { if (state.tab === 'preview' && state.preview?.status === 'replace') state.setReplace(!state.replace) },
        a: () => { if (state.tab === 'preview' && state.preview && (state.preview.status !== 'replace' || state.replace)) void state.apply() },
      }
      const action = actions[key.name]; if (!action) return false; action(); return true
    }); return () => registerKeys(null)
  })
  return <box {...popoverRootProps(!overlay, { top: 2, left: Math.max(0, Math.floor((width - w) / 2)), width: w, height: h }, 50)} border={overlay} borderColor={theme.border2} backgroundColor={theme.surface} flexDirection="column" title={overlay ? ' Instructions Manager ' : undefined}>
    {overlay && detach ? <PopoverDetachButton theme={theme} onPress={detach} /> : null}
    <box flexShrink={0} flexDirection="row" paddingX={1}><text fg={theme.text}>{fitText(`Instructions Manager · ${services.repository!.cwd}`, Math.max(1, w - 4))}</text></box>
    <text fg={theme.dim} flexShrink={0} wrapMode="word">{`Known files · scope ${state.scope} · ${state.files.length} targets · runtime loading varies by provider`}</text>
    {state.notice ? <text fg={theme.amber} wrapMode="word" height={2} flexShrink={0}>{state.notice}</text> : null}
    {editing ? <box flexGrow={1} minHeight={0} flexDirection="column"><text fg={theme.cyan}>{`Edit ${editing} · Ctrl+S ${editing === 'text' ? 'preview save' : 'done'} · Esc keeps draft`}</text><textarea key={`${state.selected}:${editing}`} ref={editor} initialValue={editing === 'text' ? state.draft?.text ?? '' : editing === 'search' ? state.query : newPath} focused={focused} flexGrow={1} width="100%" onContentChange={() => { const text = editor.current?.plainText ?? ''; if (editing === 'text') state.edit(text); else if (editing === 'search') state.setQuery(text); else setNewPath(text) }} /></box> : <box flexGrow={1} minHeight={0} flexDirection="row">
      {wide || pane === 'files' ? <box width={wide ? listWidth : '100%'} flexDirection="column" border={wide ? ['right'] : false} borderColor={theme.border} onMouseDown={() => { if (canAct) setPane('files') }}><text flexShrink={0} fg={pane === 'files' ? theme.cyan : theme.dim}>Files · / search · g scope</text><FileList state={state} theme={theme} onSelect={choose} /></box> : null}
      {wide || pane === 'detail' ? <box flexGrow={1} minWidth={0} flexDirection="column" paddingX={1} onMouseDown={() => { if (canAct) setPane('detail') }}>
        <box flexShrink={0} flexDirection="row" gap={1}>{TABS.map(tab => <box key={tab} onMouseDown={() => { if (canAct) { state.setTab(tab); setPane('detail') } }}><text fg={state.tab === tab ? theme.cyan : theme.dim}>{state.tab === tab ? `[${tab}]` : tab}</text></box>)}</box>
        <text fg={theme.text} wrapMode="word">{state.content?.file.path ?? state.selected}</text>
        <scrollbox ref={detailScroll} flexGrow={1} minHeight={0}>
          {state.tab === 'read' ? <>{state.content ? <><text fg={theme.dim} wrapMode="word">{`${state.content.file.consumers.join(' · ')}\n${state.content.file.applies}${state.content.file.note ? `\n${state.content.file.note}` : ''}`}</text>{!state.content.file.exists ? <text fg={theme.dim}>Missing file. Press e to create instructions.</text> : rich ? <Suspense fallback={<text>Loading Markdown…</text>}><InstructionMarkdown text={state.content.text} width={bodyWidth} theme={theme} syntaxStyle={props.syntaxStyle} /></Suspense> : <text fg={theme.text} wrapMode="word">{state.content.text}</text>}{state.content.references.length ? <text fg={theme.dim} wrapMode="word">{`References (not expanded): ${state.content.references.join(', ')}`}</text> : null}</> : <text fg={theme.dim}>Select a file. Loading instructions…</text>}</> : null}
          {state.tab === 'edit' ? <><text fg={theme.dim}>e edits · p previews save · x reloads editor</text><text fg={theme.text} wrapMode="word">{state.draft?.text || 'Empty instruction file'}</text></> : null}
          {state.tab === 'copy' ? <><text fg={theme.dim} wrapMode="word">Choose a destination with j/k or click; p previews an independent copy. Source stays unchanged.</text>{destinations.map(file => <box key={file.id} ref={file.path === state.destination ? destinationRow : undefined} flexDirection="column" backgroundColor={state.destination === file.path ? theme.surface2 : undefined} onMouseDown={() => { if (canAct) state.setDestination(file.path) }}><text fg={state.destination === file.path ? theme.cyan : theme.text} wrapMode="word">{`${state.destination === file.path ? '›' : ' '} ${file.scope} · ${file.label}`}</text><text fg={theme.dim} wrapMode="word">{file.consumers.join(', ')}</text></box>)}</> : null}
          {state.tab === 'preview' ? <ChangePreview state={state} theme={theme} /> : null}
          {state.tab === 'history' ? <History state={state} theme={theme} /> : null}
        </scrollbox>
        {state.tab === 'preview' && state.preview ? <box flexShrink={0} flexDirection="column">{state.preview.status === 'replace' ? <box onMouseDown={() => { if (canAct) state.setReplace(!state.replace) }}><text fg={theme.amber}>{`[${state.replace ? 'x' : ' '}] Replace existing instructions with backup · Space`}</text></box> : null}<box onMouseDown={() => { if (canAct && (state.preview?.status !== 'replace' || state.replace)) void state.apply() }}><text fg={state.busy || (state.preview.status === 'replace' && !state.replace) ? theme.dim : theme.green}>Apply reviewed change · a</text></box></box> : <box flexShrink={0} flexDirection="row" gap={2}><box onMouseDown={startEdit}><text fg={theme.cyan}>Edit · e</text></box><box onMouseDown={() => { if (canAct) void state.prepare(state.tab === 'copy') }}><text fg={theme.cyan}>Preview · p</text></box><box onMouseDown={() => { if (canAct) setEditing('path') }}><text fg={theme.cyan}>New rule · n</text></box></box>}
      </box> : null}
    </box>}
    <text fg={theme.dim} flexShrink={0}>Tab panes · ←/→ tabs · j/k navigate · ? help · Esc back</text>
    {help ? <ShortcutHelp title="Instructions Manager" groups={HELP} theme={theme} width={w} height={h} scrollRef={helpScroll} onClose={() => setHelp(false)} /> : null}
  </box>
}
export const module: PluginViewModule<TuiPluginView> = { apiVersion: PLUGIN_API_VERSION, pluginId: 'instructions-manager', views: { 'instructions-manager': InstructionsManager } }
