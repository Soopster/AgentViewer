'use client'

// Web entry for the Editor: open project files in buffers, edit and save them.
// It keeps the terminal editor's file-boundary rules, because both lose data
// silently when wrong: line endings and a byte-order mark are a file property,
// not buffer content (a textarea turns CRLF into LF, which would rewrite every
// line of a Windows file on save), and a save is refused when the file changed
// on disk since it was read (the route's sha256 guard) rather than overwriting
// someone else's edit.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { PLUGIN_API_VERSION, type PluginViewModule } from '@/lib/plugins/types'
import type { WebPluginView, WebPluginViewProps } from '@/components/shell/pluginTypes'
import { editorTextFromDisk, editorTextToDisk, type EditorFileEncodingMarks } from '../tui/editorLineEndings'
import { highlightCode, type CodeHighlight } from '@/lib/codeHighlight'
import { codeStyleToHighlightsTheme, getCodeThemeStyle, useCodeTheme } from '@/components/shell/sdk'

// Highlighting is a layer under a transparent textarea. Past these sizes it is
// skipped (a minified file is one enormous line), as the terminal editor does.
const MAX_HIGHLIGHT_CHARS = 400_000
const MAX_HIGHLIGHT_LINE = 4_000
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx', json: 'json', md: 'markdown',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', swift: 'swift', c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp',
  hpp: 'cpp', cs: 'csharp', css: 'css', scss: 'scss', html: 'html', xml: 'xml', yaml: 'yaml', yml: 'yaml', toml: 'toml', sh: 'bash',
  zsh: 'bash', sql: 'sql', php: 'php', lua: 'lua', vue: 'vue', svelte: 'svelte', dockerfile: 'dockerfile',
}
const languageOf = (path: string) => {
  const name = path.split('/').pop()?.toLowerCase() ?? ''
  return LANGUAGE_BY_EXTENSION[name === 'dockerfile' ? 'dockerfile' : name.split('.').pop() ?? ''] ?? 'text'
}
const CODE_TEXT: CSSProperties = { margin: 0, padding: '10px 14px', fontFamily: 'var(--font-mono, monospace)', fontSize: 13, lineHeight: '20px', whiteSpace: 'pre', tabSize: 2, border: 'none' }

// ── Language server ──────────────────────────────────────────────────────────
type LspPosition = { line: number; character: number }
type LspDiagnostic = { line: number; character: number; endLine: number; endCharacter: number; severity: 1 | 2 | 3 | 4; message: string; source?: string }
type LspStatus = { state: 'starting' | 'ready' | 'loading' | 'unavailable' | 'error'; name: string; message?: string; detail?: string } | null
type LspCompletion = { label: string; detail?: string; insertText: string; insertTextFormat?: 1 | 2; filterText?: string; textEdit?: { range: { start: LspPosition; end: LspPosition }; newText: string } }
async function lsp<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  const response = await fetch('/api/editor/lsp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, ...payload }) })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || body.error) throw new Error(body.error || `Language server ${action} failed (${response.status})`)
  return body as T
}
/** A string offset as an LSP position: LSP counts UTF-16 units, which is what a JS string index is. */
export function positionAt(text: string, offset: number): LspPosition {
  const before = text.slice(0, offset)
  const line = before.split('\n').length - 1
  return { line, character: offset - (before.lastIndexOf('\n') + 1) }
}
export function offsetAt(text: string, position: LspPosition): number {
  let offset = 0
  for (let line = 0; line < position.line; line++) { const next = text.indexOf('\n', offset); if (next < 0) return text.length; offset = next + 1 }
  const end = text.indexOf('\n', offset)
  return Math.min(offset + position.character, end < 0 ? text.length : end)
}
/** A snippet's text with its placeholders reduced to their defaults: `foo(${1:bar})$0` → `foo(bar)`. */
export function snippetText(snippet: string): string {
  return snippet.replace(/\$\{\d+:([^}]*)\}/g, '$1').replace(/\$\{\d+\}|\$\d+/g, '')
}
/** What accepting a completion does to the text: its edit's range, or the identifier before the caret. */
export function applyCompletion(text: string, caret: number, item: LspCompletion): { text: string; caret: number } {
  const raw = item.textEdit?.newText ?? item.insertText
  const insert = item.insertTextFormat === 2 ? snippetText(raw) : raw
  let start: number, end: number
  if (item.textEdit) { start = offsetAt(text, item.textEdit.range.start); end = Math.max(offsetAt(text, item.textEdit.range.end), caret) }
  else { start = caret; while (start > 0 && /[\w$]/.test(text[start - 1]!)) start--; end = caret }
  return { text: text.slice(0, start) + insert + text.slice(end), caret: start + insert.length }
}

/** Every match of `needle` in `text`, case-insensitive. */
export function findMatches(text: string, needle: string): number[] {
  if (!needle) return []
  const haystack = text.toLowerCase(), target = needle.toLowerCase(), out: number[] = []
  for (let at = haystack.indexOf(target); at >= 0 && out.length < 10_000; at = haystack.indexOf(target, at + Math.max(target.length, 1))) out.push(at)
  return out
}

/** The buffer: a line gutter, highlighted text, and the textarea that edits it, scrolled together. */
function CodeArea({ path, value, area, onChange, onKeyDown, onCaret, diagnostics = [], popup }: {
  path: string; value: string; area: React.RefObject<HTMLTextAreaElement | null>
  onChange: (value: string) => void; onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void; onCaret: (target: HTMLTextAreaElement) => void
  diagnostics?: readonly LspDiagnostic[]
  /** Drawn at the caret: completions or hover text. */
  popup?: React.ReactNode
}) {
  const [scroll, setScroll] = useState({ top: 0, left: 0 })
  const charWidth = useMemo(() => {
    if (typeof document === 'undefined') return 7.8
    const context = document.createElement('canvas').getContext('2d')
    if (!context) return 7.8
    context.font = `13px ${getComputedStyle(document.body).getPropertyValue('--font-mono') || 'monospace'}`
    return context.measureText('M').width || 7.8
  }, [])
  // The worst diagnostic on each line, for the gutter.
  const worst = useMemo(() => {
    const out = new Map<number, LspDiagnostic>()
    for (const diagnostic of diagnostics) { const seen = out.get(diagnostic.line); if (!seen || diagnostic.severity < seen.severity) out.set(diagnostic.line, diagnostic) }
    return out
  }, [diagnostics])
  const [highlight, setHighlight] = useState<{ source: string; result: CodeHighlight } | null>(null)
  // The reader's code theme: concrete colours, matching the transcript's code blocks.
  const { themeId } = useCodeTheme()
  const theme = useMemo(() => codeStyleToHighlightsTheme(getCodeThemeStyle(themeId)), [themeId])
  const layer = useRef<HTMLPreElement>(null)
  const gutter = useRef<HTMLDivElement>(null)
  const lineCount = useMemo(() => value.split('\n').length, [value])
  const highlightable = value.length <= MAX_HIGHLIGHT_CHARS && !value.split('\n').some(line => line.length > MAX_HIGHLIGHT_LINE)
  useEffect(() => {
    if (!highlightable) { setHighlight(null); return undefined }
    let live = true
    // Debounced: a keystroke costs a re-tokenize only once typing pauses.
    const timer = window.setTimeout(() => {
      void highlightCode(value, languageOf(path), theme).then(result => { if (live && result) setHighlight({ source: value, result }) })
    }, 120)
    return () => { live = false; window.clearTimeout(timer) }
  }, [value, path, highlightable, theme])
  const sync = () => {
    const target = area.current
    if (!target) return
    if (layer.current) { layer.current.scrollTop = target.scrollTop; layer.current.scrollLeft = target.scrollLeft }
    if (gutter.current) gutter.current.scrollTop = target.scrollTop
    setScroll({ top: target.scrollTop, left: target.scrollLeft })
  }
  const caret = area.current ? positionAt(value, area.current.selectionStart) : { line: 0, character: 0 }
  // Tokens describe the text they were made from; until a fresh pass lands, the layer shows plain text.
  const tokens = highlight?.source === value ? highlight.result.lines : null
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', background: 'var(--surface)' }}>
      <div ref={gutter} aria-hidden style={{ ...CODE_TEXT, padding: '10px 8px 10px 12px', color: 'var(--text-3)', textAlign: 'right', overflow: 'hidden', userSelect: 'none', borderRight: '1px solid var(--border)', minWidth: 44 }}>
        {Array.from({ length: lineCount }, (_, index) => {
          const diagnostic = worst.get(index)
          return <div key={index} data-editor-diagnostic-line={diagnostic ? diagnostic.severity : undefined} title={diagnostic?.message}
            style={diagnostic ? { color: diagnostic.severity === 1 ? 'var(--red, #f85149)' : diagnostic.severity === 2 ? 'var(--amber, #d29922)' : 'var(--cyan, #39c5cf)', fontWeight: 700 } : undefined}>{diagnostic ? `● ${index + 1}` : index + 1}</div>
        })}
      </div>
      <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
        <pre ref={layer} aria-hidden data-editor-highlight={tokens ? 'on' : 'off'} style={{ ...CODE_TEXT, position: 'absolute', inset: 0, overflow: 'hidden', color: (tokens && highlight?.result.foreground) || 'var(--text)', pointerEvents: 'none' }}>
          {tokens ? tokens.map((line, row) => <div key={row}>{line.length ? line.map((token, index) => <span key={index} style={{ color: token.color, fontStyle: token.fontStyle === 1 ? 'italic' : undefined }}>{token.content}</span>) : ' '}</div>) : value + '\n'}
        </pre>
        <textarea ref={area} aria-label={`Editing ${path}`} data-editor-buffer={path} spellCheck={false} value={value} wrap="off"
          onChange={event => { onChange(event.target.value); onCaret(event.target) }} onKeyDown={onKeyDown} onKeyUp={event => onCaret(event.currentTarget)} onClick={event => onCaret(event.currentTarget)} onScroll={sync}
          style={{ ...CODE_TEXT, position: 'absolute', inset: 0, width: '100%', height: '100%', resize: 'none', outline: 'none', background: 'transparent', color: 'transparent', caretColor: 'var(--text)', overflow: 'auto' }} />
        {popup ? <div style={{ position: 'absolute', zIndex: 2, top: 10 + (caret.line + 1) * 20 - scroll.top, left: Math.max(4, 14 + caret.character * charWidth - scroll.left) }}>{popup}</div> : null}
      </div>
    </div>
  )
}

type Buffer = { path: string; content: string; saved: string; sha256: string; marks: EditorFileEncodingMarks; conflict?: boolean }
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`

async function readFile(cwd: string, path: string): Promise<Buffer> {
  const response = await fetch(`/api/files/edit?${new URLSearchParams({ cwd, path })}`)
  const body = await response.json().catch(() => ({}))
  if (!response.ok || body.error) throw new Error(body.error || `Could not open ${path} (${response.status})`)
  const { content, ...marks } = editorTextFromDisk(body.content as string)
  return { path, content, saved: content, sha256: body.sha256, marks }
}

function Editor({ services, placement, close, useState: useScopedState }: WebPluginViewProps) {
  const cwd = services.repository!.cwd
  const docked = placement !== 'overlay'
  const [openPaths, setOpenPaths] = useScopedState<string[]>('open', [])
  const [activePath, setActivePath] = useScopedState<string | null>('active', null)
  const [buffers, setBuffers] = useState<Record<string, Buffer>>({})
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ path: string }[]>([])
  const [finding, setFinding] = useState(false)
  const [status, setStatus] = useState<{ tone: 'info' | 'error'; text: string } | null>(null)
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const [search, setSearch] = useState<string | null>(null)
  const [matchIndex, setMatchIndex] = useState(0)
  const findInput = useRef<HTMLInputElement>(null)
  const [diagnostics, setDiagnostics] = useState<LspDiagnostic[]>([])
  const [lspStatus, setLspStatus] = useState<LspStatus>(null)
  const [completion, setCompletion] = useState<{ items: LspCompletion[]; index: number } | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const lspOpen = useRef<string | null>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const active = activePath ? buffers[activePath] : undefined
  const dirty = (buffer?: Buffer) => !!buffer && buffer.content !== buffer.saved
  // A status line describes the buffer it was about; switching buffers clears it.
  useEffect(() => { setStatus(null) }, [activePath])
  // The language server: opened when a buffer is shown, told every edit (debounced), polled for diagnostics.
  const activeLoaded = !!active
  useEffect(() => {
    if (!activePath || !activeLoaded) return undefined
    const path = activePath
    let live = true
    lspOpen.current = null
    setDiagnostics([]); setLspStatus(null); setCompletion(null); setHover(null)
    lsp<{ status: LspStatus }>('open', { cwd, path, text: buffers[path]?.content ?? '' })
      .then(result => { if (live) { lspOpen.current = path; setLspStatus(result.status) } })
      .catch(cause => { if (live) setLspStatus({ state: 'error', name: 'language server', message: message(cause) }) })
    const timer = window.setInterval(() => {
      if (lspOpen.current !== path) return
      lsp<{ status: LspStatus; diagnostics: LspDiagnostic[] }>('state', { cwd, path })
        .then(state => { if (live) { setLspStatus(state.status); setDiagnostics(state.diagnostics) } }).catch(() => {})
    }, 1500)
    return () => { live = false; window.clearInterval(timer) }
  // Opening a server is a buffer lifecycle event, not a keystroke one.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath, activeLoaded, cwd])
  const activeContent = active?.content
  useEffect(() => {
    if (!activePath || activeContent === undefined || lspOpen.current !== activePath) return undefined
    const timer = window.setTimeout(() => { void lsp('change', { cwd, path: activePath, text: activeContent }).catch(() => {}) }, 250)
    return () => window.clearTimeout(timer)
  }, [activePath, activeContent, cwd])
  const caretPosition = () => (active && area.current ? positionAt(area.current.value, area.current.selectionStart) : null)
  const requestCompletion = async (trigger?: string) => {
    const position = caretPosition()
    if (!active || !position || lspOpen.current !== active.path) return
    // The server must have the text the caret is in before it is asked about it.
    await lsp('change', { cwd, path: active.path, text: area.current?.value ?? active.content }).catch(() => {})
    const { items } = await lsp<{ items: LspCompletion[] }>('completion', { cwd, path: active.path, position, trigger }).catch(() => ({ items: [] as LspCompletion[] }))
    setCompletion(items.length ? { items, index: 0 } : null)
    if (!items.length && !trigger) setStatus({ tone: 'info', text: 'No completions here' })
  }
  const acceptCompletion = (item: LspCompletion) => {
    const target = area.current
    if (!active || !target) return
    const next = applyCompletion(target.value, target.selectionStart, item)
    onEdit(next.text)
    setCompletion(null)
    window.requestAnimationFrame(() => { target.selectionStart = target.selectionEnd = next.caret; target.focus() })
  }
  const showHover = async () => {
    const position = caretPosition()
    if (!active || !position) return
    const { hover: result } = await lsp<{ hover: { contents?: string } | null }>('hover', { cwd, path: active.path, position }).catch(() => ({ hover: null }))
    setHover(result?.contents?.trim() || 'Nothing to show here')
  }
  const goToDefinition = async () => {
    const position = caretPosition()
    if (!active || !position) return
    const { locations } = await lsp<{ locations: Array<{ path: string; inside: boolean; range: { start: LspPosition } }> }>('definition', { cwd, path: active.path, position }).catch(() => ({ locations: [] as Array<{ path: string; inside: boolean; range: { start: LspPosition } }> }))
    const target = locations.find(location => location.inside)
    if (!target) { setStatus({ tone: 'info', text: locations[0] ? `Defined outside the project: ${locations[0].path}` : 'No definition found' }); return }
    await open(target.path)
    let tries = 0
    const jump = () => {
      const buffer = area.current
      if (!buffer || buffer.getAttribute('data-editor-buffer') !== target.path) { if (++tries < 60) window.setTimeout(jump, 50); return }
      const offset = offsetAt(buffer.value, target.range.start)
      buffer.focus(); buffer.setSelectionRange(offset, offset)
      buffer.scrollTop = Math.max(0, (target.range.start.line - 5) * 20)
      trackCursor(buffer)
    }
    jump()
  }
  const nextDiagnostic = () => {
    const position = caretPosition()
    const target = area.current
    if (!position || !target || !diagnostics.length) return
    const sorted = [...diagnostics].sort((a, b) => a.line - b.line || a.character - b.character)
    const next = sorted.find(d => d.line > position.line || (d.line === position.line && d.character > position.character)) ?? sorted[0]!
    const offset = offsetAt(target.value, { line: next.line, character: next.character })
    target.focus(); target.setSelectionRange(offset, offset)
    target.scrollTop = Math.max(0, (next.line - 5) * 20)
    trackCursor(target)
    setStatus({ tone: next.severity === 1 ? 'error' : 'info', text: `${next.line + 1}:${next.character + 1} ${next.message}${next.source ? ` (${next.source})` : ''}` })
  }

  // Buffers named in the scoped state (a window moved, a layout restored) are read again.
  useEffect(() => {
    for (const path of openPaths) {
      if (buffers[path]) continue
      readFile(cwd, path).then(buffer => setBuffers(current => current[path] ? current : { ...current, [path]: buffer }))
        .catch(cause => setStatus({ tone: 'error', text: message(cause) }))
    }
  }, [cwd, openPaths])
  useEffect(() => {
    if (!finding) return undefined
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      fetch(`/api/files?${new URLSearchParams({ cwd, q: query })}`, { signal: controller.signal })
        .then(response => response.json()).then(body => setResults(Array.isArray(body.files) ? body.files : []))
        .catch(() => {})
    }, 120)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [cwd, query, finding])

  const open = useCallback(async (path: string) => {
    setFinding(false); setQuery('')
    if (!openPaths.includes(path)) setOpenPaths(current => [...current, path])
    setActivePath(path)
    if (!buffers[path]) {
      try { const buffer = await readFile(cwd, path); setBuffers(current => ({ ...current, [path]: buffer })) }
      catch (cause) { setStatus({ tone: 'error', text: message(cause) }) }
    }
    window.setTimeout(() => area.current?.focus(), 0)
  }, [cwd, openPaths, buffers])

  const save = useCallback(async (overwrite = false) => {
    if (!active) return
    const body = { cwd, path: active.path, content: editorTextToDisk(active.content, active.marks), expectedSha256: active.sha256 }
    if (overwrite) {
      // Overwriting is a choice made after a conflict: take the disk's current hash, keep this buffer's text.
      const fresh = await readFile(cwd, active.path).catch(() => null)
      if (fresh) body.expectedSha256 = fresh.sha256
    }
    const response = await fetch('/api/files/edit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const result = await response.json().catch(() => ({}))
    if (response.status === 409) {
      setBuffers(current => ({ ...current, [active.path]: { ...active, conflict: true } }))
      setStatus({ tone: 'error', text: `${active.path} changed on disk since it was opened — reload it, or overwrite with your version` })
      return
    }
    if (!response.ok || result.error) { setStatus({ tone: 'error', text: result.error || `Save failed (${response.status})` }); return }
    // A save adopts its own output only if the buffer has not moved on since.
    setBuffers(current => {
      const now = current[active.path]
      if (!now) return current
      return { ...current, [active.path]: { ...now, saved: active.content, sha256: result.sha256, conflict: false } }
    })
    setStatus({ tone: 'info', text: `Saved ${active.path}` })
    if (lspOpen.current === active.path) void lsp('saved', { cwd, path: active.path, text: active.content }).catch(() => {})
  }, [active, cwd])
  const reload = async () => {
    if (!active) return
    try { const buffer = await readFile(cwd, active.path); setBuffers(current => ({ ...current, [active.path]: buffer })); setStatus({ tone: 'info', text: `Reloaded ${active.path} from disk` }) }
    catch (cause) { setStatus({ tone: 'error', text: message(cause) }) }
  }
  // Closing the editor with unsaved buffers asks first, as the terminal editor does.
  const closeEditor = useCallback(() => {
    const unsaved = Object.values(buffers).filter(buffer => buffer.content !== buffer.saved).map(buffer => buffer.path)
    if (unsaved.length && !window.confirm(`Discard unsaved changes to ${unsaved.join(', ')}?`)) return
    close()
  }, [buffers, close])
  const closeBuffer = (path: string) => {
    if (dirty(buffers[path]) && !window.confirm(`Discard unsaved changes to ${path}?`)) return
    const remaining = openPaths.filter(entry => entry !== path)
    setOpenPaths(remaining)
    setBuffers(current => { const next = { ...current }; delete next[path]; return next })
    void lsp('close', { cwd, path }).catch(() => {})
    if (activePath === path) setActivePath(remaining.at(-1) ?? null)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey
      if (mod && event.key.toLowerCase() === 's') { event.preventDefault(); void save() }
      else if (mod && event.key.toLowerCase() === 'p') { event.preventDefault(); setFinding(true) }
      else if (mod && event.key.toLowerCase() === 'f') { event.preventDefault(); setSearch(current => current ?? ''); window.setTimeout(() => findInput.current?.select(), 0) }
      else if (event.key === 'Escape') { if (event.defaultPrevented) return; if (search !== null) { setSearch(null); area.current?.focus() } else if (finding) setFinding(false); else if (!docked) closeEditor() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save, finding, search, docked, closeEditor])
  useEffect(() => { if (!activePath && openPaths.length === 0) setFinding(true) }, [activePath, openPaths.length])

  const onEdit = (value: string) => { if (active) setBuffers(current => ({ ...current, [active.path]: { ...active, content: value } })) }
  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // An open completion list takes the arrows, Enter/Tab and Escape.
    if (completion) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setCompletion({ ...completion, index: (completion.index + (event.key === 'ArrowDown' ? 1 : -1) + completion.items.length) % completion.items.length }); return }
      if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); acceptCompletion(completion.items[completion.index]!); return }
      if (event.key === 'Escape') { event.preventDefault(); setCompletion(null); return }
    }
    if (hover && event.key === 'Escape') { event.preventDefault(); setHover(null); return }
    if (hover) setHover(null)
    if (event.ctrlKey && event.key === ' ') { event.preventDefault(); void requestCompletion(); return }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'i') { event.preventDefault(); void showHover(); return }
    if (event.key === 'F12') { event.preventDefault(); void goToDefinition(); return }
    if (event.key === 'F8') { event.preventDefault(); nextDiagnostic(); return }
    if (event.key === '.' && !event.metaKey && !event.ctrlKey) window.setTimeout(() => { void requestCompletion('.') }, 0)
    else if (completion && !/^[\w$]$/.test(event.key)) setCompletion(null)
    // Tab indents (two spaces) instead of leaving the editor.
    if (event.key !== 'Tab' || event.metaKey || event.ctrlKey) return
    event.preventDefault()
    const target = event.currentTarget
    const { selectionStart: start, selectionEnd: end, value } = target
    const next = `${value.slice(0, start)}  ${value.slice(end)}`
    onEdit(next)
    window.requestAnimationFrame(() => { target.selectionStart = target.selectionEnd = start + 2 })
  }
  const trackCursor = (target: HTMLTextAreaElement) => {
    const before = target.value.slice(0, target.selectionStart)
    const line = before.split('\n').length
    setCursor({ line, column: before.length - before.lastIndexOf('\n') })
  }

  const body = (
    <div data-plugin-view="editor" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--surface)', color: 'var(--text)' }}>
      <div style={{ display: 'flex', alignItems: 'stretch', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)', overflowX: 'auto' }}>
        {openPaths.map(path => (
          <div key={path} data-editor-tab={path} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', borderRight: '1px solid var(--border)', background: path === activePath ? 'var(--surface)' : 'transparent', fontSize: 12, whiteSpace: 'nowrap' }}>
            <button type="button" onClick={() => setActivePath(path)} style={{ border: 'none', background: 'transparent', color: path === activePath ? 'var(--text)' : 'var(--text-2)', cursor: 'pointer', fontSize: 12 }}>
              {dirty(buffers[path]) ? '● ' : ''}{path.split('/').pop()}
            </button>
            <button type="button" aria-label={`Close ${path}`} onClick={() => closeBuffer(path)} style={{ border: 'none', background: 'transparent', color: 'var(--text-3)', cursor: 'pointer' }}>×</button>
          </div>
        ))}
        <button type="button" onClick={() => setFinding(true)} style={{ border: 'none', background: 'transparent', color: 'var(--text-2)', padding: '0 10px', cursor: 'pointer', fontSize: 12 }}>+ Open file ⌘P</button>
        <span style={{ flex: 1 }} />
        {!docked ? <button type="button" aria-label="Close" onClick={closeEditor} style={{ border: 'none', background: 'transparent', color: 'var(--text-2)', padding: '0 10px', cursor: 'pointer' }}>✕</button> : null}
      </div>
      {finding ? (
        <div style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>
          <input autoFocus aria-label="Open file" placeholder="Search files in the project…" value={query} onChange={event => setQuery(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter' && results[0]) { event.preventDefault(); void open(results[0].path) } }}
            style={{ width: '100%', fontSize: 13, padding: '6px 8px', background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6 }} />
          <div style={{ maxHeight: 260, overflow: 'auto', marginTop: 6 }}>
            {results.map(result => (
              <button key={result.path} type="button" data-editor-result={result.path} onClick={() => { void open(result.path) }}
                style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'transparent', color: 'var(--text)', padding: '3px 6px', cursor: 'pointer', fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}>{result.path}</button>
            ))}
          </div>
        </div>
      ) : null}
      {active && search !== null ? (() => {
        const matches = findMatches(active.content, search)
        const current = matches.length ? ((matchIndex % matches.length) + matches.length) % matches.length : -1
        const go = (step: number) => {
          if (!matches.length) return
          const next = ((current + step) % matches.length + matches.length) % matches.length
          setMatchIndex(next)
          const target = area.current
          if (!target) return
          // Select the match and scroll the textarea to it: a blur/focus pair makes the browser reveal the selection.
          target.focus()
          target.setSelectionRange(matches[next]!, matches[next]! + search.length)
          const line = active.content.slice(0, matches[next]!).split('\n').length
          target.scrollTop = Math.max(0, (line - 5) * 20)
          trackCursor(target)
          findInput.current?.focus()
        }
        return (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 12px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)', fontSize: 12 }}>
            <input ref={findInput} aria-label="Find in file" placeholder="Find" value={search} onChange={event => { setSearch(event.target.value); setMatchIndex(0) }}
              onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); go(event.shiftKey ? -1 : 1) } }}
              style={{ width: 240, fontSize: 12, padding: '3px 6px', background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4 }} />
            <span data-editor-find-count style={{ color: 'var(--text-2)' }}>{search ? (matches.length ? `${current + 1} of ${matches.length}` : 'no matches') : ''}</span>
            <button type="button" aria-label="Previous match" onClick={() => go(-1)} style={{ fontSize: 12 }}>↑</button>
            <button type="button" aria-label="Next match" onClick={() => go(1)} style={{ fontSize: 12 }}>↓</button>
            <span style={{ flex: 1 }} />
            <button type="button" aria-label="Close find" onClick={() => setSearch(null)} style={{ fontSize: 12 }}>×</button>
          </div>
        )
      })() : null}
      {active?.conflict ? (
        <div role="alert" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 12px', background: 'var(--surface-3)', fontSize: 12 }}>
          <span style={{ flex: 1, color: 'var(--amber, #d29922)' }}>This file changed on disk after you opened it.</span>
          <button type="button" onClick={() => { void reload() }} style={{ fontSize: 12 }}>Reload from disk</button>
          <button type="button" onClick={() => { void save(true) }} style={{ fontSize: 12 }}>Overwrite with mine</button>
        </div>
      ) : null}
      {active ? (
        <CodeArea path={active.path} value={active.content} area={area} onChange={onEdit} onKeyDown={onKeyDown} onCaret={trackCursor} diagnostics={diagnostics}
          popup={completion ? (
            <div role="listbox" data-editor-completions style={{ minWidth: 260, maxWidth: 520, maxHeight: 240, overflow: 'auto', background: 'var(--surface-2)', border: '1px solid var(--border-2)', borderRadius: 6, boxShadow: '0 8px 24px var(--shadow, rgba(0,0,0,0.3))', fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}>
              {completion.items.slice(0, 50).map((item, index) => (
                <div key={`${item.label}:${index}`} role="option" aria-selected={index === completion.index} data-editor-completion={item.label}
                  onMouseDown={event => { event.preventDefault(); acceptCompletion(item) }}
                  style={{ display: 'flex', gap: 10, padding: '2px 8px', cursor: 'pointer', background: index === completion.index ? 'var(--surface-3)' : 'transparent' }}>
                  <span style={{ color: 'var(--text)' }}>{item.label}</span>
                  <span style={{ color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.detail}</span>
                </div>
              ))}
            </div>
          ) : hover ? (
            <pre data-editor-hover style={{ margin: 0, maxWidth: 560, maxHeight: 240, overflow: 'auto', padding: '6px 10px', background: 'var(--surface-2)', border: '1px solid var(--border-2)', borderRadius: 6, fontSize: 12, whiteSpace: 'pre-wrap', color: 'var(--text)' }}>{hover}</pre>
          ) : null} />
      ) : <div style={{ flex: 1, padding: 14, color: 'var(--text-2)' }}>{activePath ? 'Opening…' : 'Open a file to edit it.'}</div>}
      <div style={{ display: 'flex', gap: 12, padding: '4px 12px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-2)' }}>
        <span style={{ flex: 1, color: status?.tone === 'error' ? 'var(--red, #f85149)' : undefined }} role="status">{status?.text ?? (active ? active.path : cwd)}</span>
        {active && lspStatus ? <span data-editor-lsp={lspStatus.state} title={lspStatus.message ?? lspStatus.detail}>{lspStatus.state === 'ready' ? lspStatus.name : `${lspStatus.name} ${lspStatus.state}`}</span> : null}
        {active && diagnostics.length ? <span data-editor-diagnostics={diagnostics.length} style={{ color: diagnostics.some(d => d.severity === 1) ? 'var(--red, #f85149)' : 'var(--amber, #d29922)' }}>⚠ {plural(diagnostics.filter(d => d.severity === 1).length, 'error')} · {plural(diagnostics.filter(d => d.severity === 2).length, 'warning')} · F8</span> : null}
        {active ? <span>Ln {cursor.line}, Col {cursor.column} · {active.marks.lineEnding === '\r\n' ? 'CRLF' : 'LF'}{active.marks.byteOrderMark ? ' · BOM' : ''} · {dirty(active) ? 'unsaved' : 'saved'}</span> : null}
      </div>
    </div>
  )
  if (docked) return body
  return (
    <div role="dialog" aria-label="Editor" style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)' }}>
      <div style={{ width: 'min(1280px, calc(100vw - 24px))', height: 'calc(100vh - 32px)', border: '1px solid var(--border-2)', borderRadius: 10, overflow: 'hidden', boxShadow: '0 16px 48px var(--shadow, rgba(0,0,0,0.3))' }}>{body}</div>
    </div>
  )
}

export const module: PluginViewModule<WebPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'editor',
  views: { editor: Editor },
}
