import React, { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import ContextComposer, { type ContextComposerHandle } from '../components/ContextComposer'
import ContextMessage from '../components/ContextMessage'
import { contextReference, createContextAttachment, projectComposerContext, readComposerContext } from '../lib/composerContext'
import type { SendAttachment } from '../lib/types'

function Fixture() {
  const [initial] = useState(() => createContextAttachment('terminal', 'Build output', 'Expected 2, got 3'))
  const [text, setText] = useState(`Fix ${contextReference(initial)} please`)
  const [attachments, setAttachments] = useState<SendAttachment[]>([initial])
  const [sent, setSent] = useState('')
  const [error, setError] = useState('')
  const [clipboard, setClipboard] = useState('')
  const [session, setSession] = useState(0)
  const editor = useRef<ContextComposerHandle>(null)
  const send = () => { try { setSent(projectComposerContext(editor.current!.value, attachments).text); setError('') } catch (e) { setError(String(e)) } }
  const decoded = readComposerContext(sent)
  return <main onPasteCapture={e => setClipboard(JSON.stringify(Array.from(e.clipboardData.types)) + " html=" + e.clipboardData.getData("text/html").slice(0, 300))} style={{ maxWidth: 850, padding: 24, margin: '0 auto' }}>
    <h1>Context composer interaction fixture</h1>
    <ContextComposer key={session} ref={editor} value={text} attachments={attachments} onAttachments={incoming => setAttachments(prev => [...prev, ...incoming])}
      onValueChange={setText} onCaretChange={() => {}} onPaste={() => {}} placeholder="Message the agent"
      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} style={{ minHeight: 90, padding: 12, border: '1px solid #888' }} />
    <button onMouseDown={e => e.preventDefault()} onClick={() => {
      const a = createContextAttachment('diff', 'app.ts L12', '-old\n+new')
      const handle = editor.current!
      const start = handle.selectionStart
      const token = contextReference(a)
      const next = handle.value.slice(0, start) + token + handle.value.slice(handle.selectionEnd)
      setAttachments(prev => [...prev, a]); setText(next); handle.value = next; handle.focus(); handle.setSelectionRange(start + token.length, start + token.length)
    }}>Insert diff at caret</button>
    <button onClick={send}>Send</button>
    <button onClick={() => { localStorage.setItem('context-fixture', JSON.stringify({ text, attachments })); setSession(n => n + 1) }}>Save and remount</button>
    <button onClick={() => { const saved = JSON.parse(localStorage.getItem('context-fixture')!); setText(saved.text); setAttachments(saved.attachments) }}>Restore saved draft</button>
    <button onClick={() => { setText(''); setAttachments([]); setSession(n => n + 1) }}>New draft</button>
    <pre id="clipboard">{clipboard}</pre><pre id="canonical">{text}</pre><pre id="error">{error}</pre>
    <ContextMessage text={decoded.text} records={decoded.records} />
  </main>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
