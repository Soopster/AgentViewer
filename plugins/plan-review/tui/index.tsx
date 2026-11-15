/** @jsxImportSource @opentui/react */
import { useEffect, useRef, useState } from 'react'
import type { BoxRenderable, TextareaRenderable, ScrollBoxRenderable } from '@opentui/core'
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import { latestPlan, planApproved, planNotes, planRevisionDiff, PLAN_LABELS, type PlanTarget } from '../../../lib/plugins/planReview'
import { useReviewView } from '../useReviewView'
import { popoverRootProps, PopoverDetachButton, fitText, type TuiPluginView, type TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'
const TABS = ['Plan', 'Notes', 'History'] as const
type ReviewTab = typeof TABS[number]
function Review({ services, theme, width, height, placement, close, detach, focused, registerKeys, setCapture, useState: scoped }: TuiPluginViewProps) {
  const session = services.session?.session
  const target: PlanTarget | undefined = session?.provider ? { provider: session.provider, providerInstanceId: session.providerInstanceId, sessionId: session.sessionId } : undefined
  const state = useReviewView(services['plan-review']!, services.repository!.cwd, target, scoped)
  const [line, setLine] = scoped('line', 0), [mark, setMark] = scoped<number | null>('mark', null)
  const [tab, setTab] = scoped<ReviewTab>('tab', 'Plan')
  const [region, setRegion] = scoped<'plans' | 'document'>('region', 'document')
  const [sidebar, setSidebar] = scoped('sidebar', true)
  const [navigationOpen, setNavigationOpen] = useState(false)
  const [help, setHelp] = useState(false)
  const [revisionIndex, setRevisionIndex] = scoped('history-index', -1), [noteCursor, setNoteIndex] = scoped('note-index', 0)
  const [editing, setEditing] = useState<'comment' | 'file' | null>(null), [file, setFile] = scoped('file', '')
  const [messages, setMessages] = useState<{ id: string; text: string }[] | null>(null), [messageIndex, setMessageIndex] = useState(0)
  const [mode, setMode] = scoped<'default' | 'acceptEdits'>('permission-mode', 'default')
  const editor = useRef<TextareaRenderable>(null), scroll = useRef<ScrollBoxRenderable>(null)
  const planList = useRef<ScrollBoxRenderable>(null), noteList = useRef<ScrollBoxRenderable>(null)
  const selectedPlanRow = useRef<BoxRenderable>(null), selectedNoteRow = useRef<BoxRenderable>(null)
  const review = state.review, revision = review && latestPlan(review), lines = revision?.text.split('\n') ?? []
  const selectedLine = Math.min(line, Math.max(0, lines.length - 1)), notes = review ? planNotes(review) : []
  const noteIndex = Math.max(0, Math.min(noteCursor, notes.length - 1))
  const reviews = state.snapshot?.reviews ?? []
  const pending = notes.filter(note => !note.resolved).length
  const overlay = placement === 'overlay', w = overlay ? Math.max(1, Math.min(width - 4, 150)) : width, h = overlay ? Math.max(1, height - 4) : height
  const narrow = w < 85, showSidebar = narrow ? navigationOpen : sidebar
  const navWidth = narrow ? w - (overlay ? 2 : 0) : Math.min(34, Math.floor(w * .28)), tw = Math.max(1, w - (showSidebar ? navWidth : 0) - 4)
  const toggleSidebar = () => { if (narrow) setNavigationOpen(!navigationOpen); else setSidebar(!sidebar); setRegion('document') }
  const choose = (id: string) => { void state.choose(id).then(ok => { if (ok) { setLine(0); setMark(null); setRevisionIndex(-1); setRegion('document'); setNavigationOpen(false) } }) }
  const openMessages = () => { setNavigationOpen(false); if (target) void services['plan-review']!.messages(target).then(items => { setMessages(items); setMessageIndex(Math.max(0, items.length - 1)) }).catch(cause => state.setNotice(String(cause))) }
  const select = (kind: 'comment' | 'deletion' | 'label') => {
    if (!revision || tab !== 'Plan') return
    const first = Math.min(mark ?? selectedLine, selectedLine), last = Math.max(mark ?? selectedLine, selectedLine)
    const start = lines.slice(0, first).reduce((sum, value) => sum + value.length + 1, 0), end = start + lines.slice(first, last + 1).join('\n').length
    if (state.beginSelection(kind, start, end)) { setMark(null); setEditing('comment') }
  }
  useEffect(() => { setCapture(editing && focused ? 'input' : false); return () => setCapture(false) }, [editing, focused, setCapture])
  useEffect(() => { scroll.current?.scrollTo(Math.max(0, selectedLine - 2)) }, [selectedLine, tab, review?.id])
  useEffect(() => { if (selectedPlanRow.current) planList.current?.scrollChildIntoView(selectedPlanRow.current) }, [review?.id, showSidebar])
  useEffect(() => { if (selectedNoteRow.current) noteList.current?.scrollChildIntoView(selectedNoteRow.current) }, [noteIndex, tab, review?.sequence])
  useEffect(() => {
    registerKeys(key => {
      if (!focused) return false
      if (editing) {
        if (editing === 'comment' && state.draft.kind === 'label' && (key.name === 'left' || key.name === 'right')) {
          const at = PLAN_LABELS.findIndex(label => label === state.draft.text)
          state.setDraft({ ...state.draft, text: PLAN_LABELS[(at + (key.name === 'left' ? -1 : 1) + PLAN_LABELS.length) % PLAN_LABELS.length] }); return true
        }
        if (key.name === 'escape') { setEditing(null); return true }
        if (key.ctrl && (key.name === 's' || key.name === 'return')) {
          if (editing === 'file') void state.openFile(editor.current?.plainText ?? file).then(ok => { if (ok) setEditing(null) })
          else void state.annotate().then(ok => { if (ok) setEditing(null) })
          return true
        }
        return false
      }
      if (key.ctrl && key.name === 'n') { toggleSidebar(); return true }
      if (key.ctrl || key.meta) return false
      if (messages) {
        if (key.name === 'escape') setMessages(null)
        else if (key.name === 'up' || key.name === 'k') setMessageIndex(value => Math.max(0, value - 1))
        else if (key.name === 'down' || key.name === 'j') setMessageIndex(value => Math.min(messages.length - 1, value + 1))
        else if (key.name === 'return' && messages[messageIndex]) void state.openMessage(messages[messageIndex].id).then(ok => { if (ok) setMessages(null) })
        else return false
        return true
      }
      if (state.busy) return false
      if (key.sequence === '?' || key.name === '?') { setHelp(!help); return true }
      if (key.name === '1') { if (narrow) setNavigationOpen(true); else setSidebar(true); setRegion('plans'); return true }
      if (key.name === '2') { setNavigationOpen(false); setRegion('document'); setTab('Plan'); return true }
      if (key.name === 'tab') {
        if (narrow && showSidebar) { setNavigationOpen(false); setRegion('document') }
        else if (showSidebar) setRegion(region === 'plans' ? 'document' : 'plans')
        else setTab(TABS[(TABS.indexOf(tab) + (key.shift ? 2 : 1)) % TABS.length])
        return true
      }
      if (key.name === 'left' || key.name === 'right') { setTab(TABS[(TABS.indexOf(tab) + (key.name === 'left' ? 2 : 1)) % TABS.length]); setRegion('document'); return true }
      if ((region === 'plans' || narrow) && showSidebar && ['j', 'k', 'up', 'down'].includes(key.name)) {
        const at = reviews.findIndex(item => item.id === review?.id)
        const next = reviews[Math.max(0, Math.min(reviews.length - 1, at + (key.name === 'j' || key.name === 'down' ? 1 : -1)))]
        if (next) void state.choose(next.id).then(ok => { if (ok) { setLine(0); setMark(null); setRevisionIndex(-1) } })
        return true
      }
      if (showSidebar && (region === 'plans' || narrow) && key.name === 'return') { setNavigationOpen(false); setRegion('document'); return true }
      switch (key.name) {
        case 'escape': if (navigationOpen) setNavigationOpen(false); else if (help) setHelp(false); else if (tab !== 'Plan') setTab('Plan'); else if (region === 'plans') setRegion('document'); else if (mark !== null) setMark(null); else close(); break
        case 'j': case 'down': if (tab === 'Notes') setNoteIndex(Math.min(Math.max(0, notes.length - 1), noteIndex + 1)); else if (tab === 'History') setRevisionIndex(Math.min((review?.revisions.length ?? 1) - 1, (revisionIndex < 0 ? (review?.revisions.length ?? 1) - 1 : revisionIndex) + 1)); else setLine(Math.max(0, Math.min(lines.length - 1, selectedLine + 1))); break
        case 'k': case 'up': if (tab === 'Notes') setNoteIndex(Math.max(0, noteIndex - 1)); else if (tab === 'History') setRevisionIndex(Math.max(0, (revisionIndex < 0 ? (review?.revisions.length ?? 1) - 1 : revisionIndex) - 1)); else setLine(Math.max(0, selectedLine - 1)); break
        case 'v': if (revision && tab === 'Plan') setMark(mark === null ? selectedLine : null); break
        case 'c': select('comment'); break
        case 'd': select('deletion'); break
        case 'l': select('label'); break
        case 'g': if (!review) return false; state.setDraft({ ...state.draft, kind: 'global' }); setEditing('comment'); break
        case 'e': if (!review) return false; setEditing('comment'); break
        case 'f': setNavigationOpen(false); setEditing('file'); break
        case 'm': openMessages(); break
        case 'a': void state.approve(); break
        case 'i': void state.send('implement', mode); break
        case 'r': void state.send('feedback'); break
        case 'u': void state.reconcile(); break
        case 'b': void state.retryDraft(); break
        case 't': setMode(mode === 'default' ? 'acceptEdits' : 'default'); break
        case 'h': setTab(tab === 'History' ? 'Plan' : 'History'); break
        case ',': setRevisionIndex(Math.max(0, (revisionIndex < 0 ? (review?.revisions.length ?? 1) - 1 : revisionIndex) - 1)); break
        case '.': setRevisionIndex(Math.min((review?.revisions.length ?? 1) - 1, revisionIndex + 1)); break
        case 'n': case 'p': {
          const index = Math.min(Math.max(0, noteIndex + (key.name === 'n' ? 1 : -1)), Math.max(0, notes.length - 1)); setNoteIndex(index)
          if (notes[index]?.anchor?.status === 'active') setLine(notes[index].anchor!.line - 1)
          break
        }
        case 'z': if (notes[noteIndex]) void state.resolve(notes[noteIndex].id, !notes[noteIndex].resolved); break
        case 'x': if (notes[noteIndex]) void state.remove(notes[noteIndex].id); break
        case '[': case ']': {
          const reviews = state.snapshot?.reviews ?? [], at = reviews.findIndex(item => item.id === review?.id)
          const next = reviews[Math.max(0, Math.min(reviews.length - 1, at + (key.name === '[' ? -1 : 1)))]
          if (next) choose(next.id)
          break
        }
        default: return false
      }
      return true
    })
    return () => registerKeys(null)
  })
  const historyAt = Math.min(revisionIndex < 0 ? (review?.revisions.length ?? 1) - 1 : revisionIndex, (review?.revisions.length ?? 1) - 1)
  const old = review?.revisions[historyAt], previous = review?.revisions[historyAt - 1]
  const historyDraft = old && review?.drafts[`editor:${old.hash}`]
  const historyText = (old ? previous ? planRevisionDiff(previous.text, old.text) : old.text : '') + (historyDraft ? `\n\nDraft from this revision:\n${historyDraft.text || old!.text.slice(historyDraft.start, historyDraft.end)}` : '')
  const receipt = review?.deliveries.filter(item => item.revision === revision?.hash).at(-1)
  const action = (label: string, run: () => void, enabled = true) => <box flexShrink={0} paddingX={1} onMouseDown={() => { if (focused && !state.busy && enabled) run() }}><text fg={enabled ? theme.cyan : theme.dim} wrapMode="none">{label}</text></box>
  const status = review ? planApproved(review) ? `Approved${pending ? ` · ${pending} open notes` : ''}` : pending ? `${pending} open notes` : 'Needs review' : state.snapshot ? 'No plans' : 'Loading…'
  return <box {...popoverRootProps(!overlay, { top: 2, left: Math.max(0, Math.floor((width - w) / 2)), width: w, height: h }, 50)} border={overlay} borderColor={theme.border2} backgroundColor={theme.surface} flexDirection="column" overflow="hidden" title={overlay ? ' Plan Review ' : undefined}>
    {overlay && detach ? <PopoverDetachButton theme={theme} onPress={detach} /> : null}
    <box height={1} flexShrink={0} flexDirection="row" paddingX={1}>
      {action(narrow ? '[≡]' : showSidebar ? '[◀]' : '[▶]', toggleSidebar)}
      <text fg={theme.cyan} wrapMode="none">{fitText(`[Repo] ${services.repository!.cwd.split('/').pop()} · ${status}`, Math.max(1, w - 12))}</text>
    </box>
    {state.error || state.notice ? <text fg={theme.amber} wrapMode="word">{state.notice || state.error}</text> : null}
    <box flexDirection="row" flexGrow={1} minHeight={0}>
      {showSidebar ? <box width={navWidth} flexShrink={0} flexDirection="column" backgroundColor={theme.surface2} border={['right']} borderColor={region === 'plans' ? theme.cyan : theme.border}>
        <box height={1} flexShrink={0} paddingX={1} backgroundColor={region === 'plans' ? theme.surface3 : undefined} onMouseDown={() => { if (focused) setRegion('plans') }}><text fg={theme.cyan}>{`[1] Plans (${reviews.length})`}</text></box>
        <scrollbox ref={planList} flexGrow={1} minHeight={1}>
          {reviews.map(item => <box key={item.id} ref={item.id === review?.id ? selectedPlanRow : undefined} flexDirection="column" paddingX={1} paddingY={1} backgroundColor={item.id === review?.id ? theme.surface3 : undefined} onMouseDown={() => { if (focused && !state.busy) choose(item.id) }}>
            <text fg={item.id === review?.id ? theme.cyan : theme.text} wrapMode="none">{fitText(`${item.id === review?.id ? '›' : ' '} ${item.title}`, navWidth - 4)}</text>
            <text fg={planApproved(item) ? theme.green : theme.dim} wrapMode="none">{fitText(`  ${planApproved(item) ? 'Approved' : 'Needs review'} · r${item.revisions.length}`, navWidth - 4)}</text>
          </box>)}
          {!reviews.length ? <box padding={1}><text fg={theme.dim} wrapMode="word">Plans from this repository appear here.</text></box> : null}
        </scrollbox>
        <box flexDirection="column" flexShrink={0} paddingY={1}>
          <text fg={theme.muted}> Open for review</text>
          {action('[m] Session message', openMessages, Boolean(target))}
          {action('[f] Markdown file', () => { setNavigationOpen(false); setEditing('file') })}
        </box>
      </box> : null}
      {!narrow || !showSidebar ? <box flexGrow={1} minWidth={0} flexDirection="column" onMouseDown={() => { if (focused) setRegion('document') }}>
        <box height={1} flexShrink={0} flexDirection="row" backgroundColor={theme.surface2}>
          {TABS.map(value => <box key={value} paddingX={1} backgroundColor={tab === value ? theme.surface3 : undefined} onMouseDown={() => { if (focused) { setTab(value); setRegion('document') } }}><text fg={tab === value ? theme.cyan : theme.muted}>{value === 'Notes' ? `Notes (${notes.length})` : value === 'Plan' ? '[2] Plan' : value}</text></box>)}
        </box>
        {review ? <>
          <text fg={theme.text} wrapMode="none">{fitText(` ${review.title}`, tw)}</text>
          <text fg={theme.dim} wrapMode="none">{fitText(` ${revision!.source.target.provider} · ${revision!.source.path ?? revision!.source.target.sessionId} · r${review.revisions.length}`, tw)}</text>
        </> : null}
        {editing ? <box flexDirection="column" flexGrow={1} minHeight={3} paddingX={1}>
          <text fg={theme.cyan}>{editing === 'file' ? 'Repository Markdown path · Ctrl+S opens · Esc back' : `${state.draft.kind} · Ctrl+S saves · Esc keeps draft`}</text>
          {editing === 'comment' && state.draft.kind !== 'global' ? <text fg={theme.dim} wrapMode="word">{fitText(revision?.text.slice(state.draft.start, state.draft.end) ?? '', tw)}</text> : null}
          {editing === 'comment' && state.draft.kind === 'label' ? <text fg={theme.cyan}>{`Left/right choose · ${state.draft.text}`}</text> : <textarea key={`${review?.id}:${editing}:${revision?.hash}`} ref={editor} initialValue={editing === 'file' ? file : state.draft.text} focused={focused} flexGrow={1} width="100%" onContentChange={() => { const text = editor.current?.plainText ?? ''; if (editing === 'file') setFile(text); else state.setDraft({ ...state.draft, text }) }} />}
        </box> : messages ? <scrollbox flexGrow={1} minHeight={1} paddingX={1}>
          <text fg={theme.cyan}>Session messages · j/k select · Enter opens · Esc back</text>
          {messages.length ? messages.map((item, index) => <text key={item.id} fg={index === messageIndex ? theme.cyan : theme.text} wrapMode="word" onMouseDown={() => { if (focused) { setMessageIndex(index); void state.openMessage(item.id).then(ok => { if (ok) setMessages(null) }) } }}>{fitText(`${index === messageIndex ? '›' : ' '} ${item.text.replace(/\s+/g, ' ')}`, tw)}</text>) : <text fg={theme.dim}>No recent assistant messages.</text>}
        </scrollbox> : !revision ? <box flexGrow={1} minHeight={1} flexDirection="column" justifyContent="center" alignItems="center" paddingX={2} gap={1}>
          <text fg={theme.text}>Start a plan review</text>
          <text fg={theme.dim} wrapMode="word">{state.snapshot ? 'Choose a message or Markdown file to review.' : 'Loading plans from this repository…'}</text>
          <box flexDirection="column" alignItems="center">
            {action('[m] Review a session message', openMessages, Boolean(target))}
            {action('[f] Open a Markdown file', () => setEditing('file'))}
          </box>
          <text fg={theme.dim} wrapMode="word">Completed plans also appear here automatically.</text>
        </box> : <>
          <box height={1} flexShrink={0} flexDirection="row" overflow="hidden" backgroundColor={theme.surface2}>
            {tab === 'Plan' ? <>
              {action('[c] Comment', () => select('comment'))}{action('[v] Range', () => setMark(mark === null ? selectedLine : null))}{action('[g] General note', () => { state.setDraft({ ...state.draft, kind: 'global' }); setEditing('comment') })}
            </> : tab === 'Notes' ? <>{action('[z] Resolve / reopen', () => { if (notes[noteIndex]) void state.resolve(notes[noteIndex].id, !notes[noteIndex].resolved) }, Boolean(notes.length))}{action('[x] Delete', () => { if (notes[noteIndex]) void state.remove(notes[noteIndex].id) }, Boolean(notes.length))}</> : <text fg={theme.cyan}> , / . revision · j/k navigate</text>}
          </box>
          <scrollbox key={`${review?.id}:${tab}`} ref={tab === 'Plan' ? scroll : tab === 'Notes' ? noteList : undefined} flexGrow={1} minHeight={1} paddingX={1}>
            {tab === 'History' ? <>
              <text fg={theme.cyan}>{`Revision ${historyAt + 1}/${review!.revisions.length} · comparison with previous`}</text>
              {historyText.split('\n').map((value, index) => <text key={index} fg={value.startsWith('+ ') ? theme.green : value.startsWith('- ') ? theme.red : theme.text} wrapMode="word">{value || ' '}</text>)}
            </> : tab === 'Notes' ? notes.length ? notes.map((note, index) => <box key={note.id} ref={index === noteIndex ? selectedNoteRow : undefined} flexDirection="column" paddingY={1} backgroundColor={index === noteIndex ? theme.surface2 : undefined} onMouseDown={() => { if (focused) { setNoteIndex(index); if (note.anchor?.status === 'active') setLine(note.anchor.line - 1) } }}>
              <text fg={note.resolved ? theme.green : theme.cyan}>{`${index === noteIndex ? '›' : ' '} ${index + 1}. ${note.kind} · ${note.resolved ? 'resolved' : 'open'}`}</text>
              {note.anchor ? <text fg={theme.dim} wrapMode="word">{`${note.anchor.status === 'active' ? `Line ${note.anchor.line}` : 'Selection no longer matched'} · ${note.anchor.quote}`}</text> : null}
              <text fg={theme.text} wrapMode="word">{note.text || 'Remove this passage.'}</text>
            </box>) : <text fg={theme.dim}>No notes yet. Select plan lines to comment, or press g for general feedback.</text> : lines.map((value, index) => {
              const selected = mark !== null && index >= Math.min(mark, selectedLine) && index <= Math.max(mark, selectedLine)
              const annotated = notes.some(note => !note.resolved && note.anchor?.status === 'active' && note.anchor.line === index + 1)
              return <text key={`${revision?.hash}:${index}`} bg={index === selectedLine || selected ? theme.surface3 : undefined} fg={index === selectedLine || selected ? theme.cyan : theme.text} wrapMode="word" onMouseDown={() => { if (focused) setLine(index) }}>{`${index === selectedLine ? '›' : ' '} ${String(index + 1).padStart(3)} ${annotated ? '●' : ' '} ${value || ' '}`}</text>
            })}
          </scrollbox>
        </>}
        {!editing && !messages && tab === 'Plan' && notes[noteIndex] ? <box flexDirection="column" flexShrink={0} backgroundColor={theme.surface2} paddingX={1}>
          <text fg={theme.cyan} wrapMode="none">{fitText(`Note ${noteIndex + 1}/${notes.length} · ${notes[noteIndex].kind} · n/p navigate · Notes tab for details`, tw)}</text>
          <text fg={theme.text} wrapMode="none">{fitText(notes[noteIndex].text || 'Remove this passage.', tw)}</text>
        </box> : null}
        {revision && !editing && !messages ? <>
          <box flexDirection="row" flexShrink={0} flexWrap="wrap" backgroundColor={theme.surface2}>
            {action('[a] Approve', () => { void state.approve() })}
            {action('[r] Request changes', () => { void state.send('feedback') })}
            {action('[i] Implement', () => { void state.send('implement', mode) }, Boolean(review && planApproved(review) && !(revision.source.kind === 'native' && pending)))}
          </box>
          {revision.source.kind === 'native' ? <text fg={theme.amber} wrapMode="word">{` t permissions: ${mode === 'default' ? 'ask before edits' : 'accept edits'}`}</text> : null}
          {receipt ? <text fg={receipt.status === 'sent' ? theme.green : theme.amber} wrapMode="word">{`${receipt.action} · ${receipt.status}${receipt.error ? ` · ${receipt.error}` : ''}`}</text> : null}
        </> : null}
      </box> : null}
    </box>
    {help ? <box flexDirection="column" flexShrink={0} paddingX={1} backgroundColor={theme.surface2}>
      <text fg={theme.cyan}>Review shortcuts · ? hides help</text>
      <text fg={theme.dim} wrapMode="word">j/k move · v range · c comment · d remove passage · l label · g general · e draft</text>
      <text fg={theme.dim} wrapMode="word">[ ] plans · h history · , . revisions · n/p notes · z resolve · x delete note</text>
      <text fg={theme.dim} wrapMode="word">a approve · r request changes · i implement · t permissions · u receipt · b replace conflicted draft</text>
      <text fg={theme.dim} wrapMode="word">1 plans · 2 document · m messages · f Markdown file · Ctrl+N sidebar · Tab focus · ←/→ tabs</text>
    </box> : null}
    <box height={1} flexShrink={0} paddingX={1}><text fg={state.busy ? theme.amber : theme.dim} wrapMode="none">{fitText(state.busy ? 'Saving…' : editing ? 'Ctrl+S save · Esc back' : messages ? 'j/k select · Enter open · Esc back' : 'Tab focus · ←/→ tabs · Ctrl+N sidebar · ? help · Esc back/close', Math.max(1, w - 4))}</text></box>
  </box>
}
export const module: PluginViewModule<TuiPluginView> = { apiVersion: PLUGIN_API_VERSION, pluginId: 'plan-review', views: { 'plan-review': Review } }
