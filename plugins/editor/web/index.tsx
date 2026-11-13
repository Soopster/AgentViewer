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

/** Every match of `needle` in `text`, case-insensitive. */
export function findMatches(text: string, needle: string): number[] {
  if (!needle) return []
  const haystack = text.toLowerCase(), target = needle.toLowerCase(), out: number[] = []
  for (let at = haystack.indexOf(target); at >= 0 && out.length < 10_000; at = haystack.indexOf(target, at + Math.max(target.length, 1))) out.push(at)
  return out
}

/** The buffer: a line gutter, highlighted text, and the textarea that edits it, scrolled together. */
function CodeArea({ path, value, area, onChange, onKeyDown, onCaret }: {
  path: string; value: string; area: React.RefObject<HTMLTextAreaElement | null>
  onChange: (value: string) => void; onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void; onCaret: (target: HTMLTextAreaElement) => void
}) {
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
  }
  // Tokens describe the text they were made from; until a fresh pass lands, the layer shows plain text.
  const tokens = highlight?.source === value ? highlight.result.lines : null
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', background: 'var(--surface)' }}>
      <div ref={gutter} aria-hidden style={{ ...CODE_TEXT, padding: '10px 8px 10px 12px', color: 'var(--text-3)', textAlign: 'right', overflow: 'hidden', userSelect: 'none', borderRight: '1px solid var(--border)', minWidth: 44 }}>
        {Array.from({ length: lineCount }, (_, index) => <div key={index}>{index + 1}</div>)}
      </div>
      <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
        <pre ref={layer} aria-hidden data-editor-highlight={tokens ? 'on' : 'off'} style={{ ...CODE_TEXT, position: 'absolute', inset: 0, overflow: 'hidden', color: (tokens && highlight?.result.foreground) || 'var(--text)', pointerEvents: 'none' }}>
          {tokens ? tokens.map((line, row) => <div key={row}>{line.length ? line.map((token, index) => <span key={index} style={{ color: token.color, fontStyle: token.fontStyle === 1 ? 'italic' : undefined }}>{token.content}</span>) : ' '}</div>) : value + '\n'}
        </pre>
        <textarea ref={area} aria-label={`Editing ${path}`} data-editor-buffer={path} spellCheck={false} value={value} wrap="off"
          onChange={event => { onChange(event.target.value); onCaret(event.target) }} onKeyDown={onKeyDown} onKeyUp={event => onCaret(event.currentTarget)} onClick={event => onCaret(event.currentTarget)} onScroll={sync}
          style={{ ...CODE_TEXT, position: 'absolute', inset: 0, width: '100%', height: '100%', resize: 'none', outline: 'none', background: 'transparent', color: 'transparent', caretColor: 'var(--text)', overflow: 'auto' }} />
      </div>
    </div>
  )
}

type Buffer = { path: string; content: string; saved: string; sha256: string; marks: EditorFileEncodingMarks; conflict?: boolean }
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

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
  const area = useRef<HTMLTextAreaElement>(null)
  const active = activePath ? buffers[activePath] : undefined
  const dirty = (buffer?: Buffer) => !!buffer && buffer.content !== buffer.saved
  // A status line describes the buffer it was about; switching buffers clears it.
  useEffect(() => { setStatus(null) }, [activePath])

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
    if (activePath === path) setActivePath(remaining.at(-1) ?? null)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey
      if (mod && event.key.toLowerCase() === 's') { event.preventDefault(); void save() }
      else if (mod && event.key.toLowerCase() === 'p') { event.preventDefault(); setFinding(true) }
      else if (mod && event.key.toLowerCase() === 'f') { event.preventDefault(); setSearch(current => current ?? ''); window.setTimeout(() => findInput.current?.select(), 0) }
      else if (event.key === 'Escape') { if (search !== null) { setSearch(null); area.current?.focus() } else if (finding) setFinding(false); else if (!docked) closeEditor() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save, finding, search, docked, closeEditor])
  useEffect(() => { if (!activePath && openPaths.length === 0) setFinding(true) }, [activePath, openPaths.length])

  const onEdit = (value: string) => { if (active) setBuffers(current => ({ ...current, [active.path]: { ...active, content: value } })) }
  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
        <CodeArea path={active.path} value={active.content} area={area} onChange={onEdit} onKeyDown={onKeyDown} onCaret={trackCursor} />
      ) : <div style={{ flex: 1, padding: 14, color: 'var(--text-2)' }}>{activePath ? 'Opening…' : 'Open a file to edit it.'}</div>}
      <div style={{ display: 'flex', gap: 12, padding: '4px 12px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-2)' }}>
        <span style={{ flex: 1, color: status?.tone === 'error' ? 'var(--red, #f85149)' : undefined }} role="status">{status?.text ?? (active ? active.path : cwd)}</span>
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
