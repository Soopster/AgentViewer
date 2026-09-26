'use client'

import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type Ref, type KeyboardEvent, type ClipboardEvent } from 'react'
import { CONTEXT_CLIPBOARD_TYPE, contextRecord, contextReferences, encodeContextText, readComposerContext, restoreContextAttachments, readableContextText } from '@/lib/composerContext'
import type { SendAttachment } from '@/lib/types'

export type ContextComposerHandle = {
  value: string
  readonly selectionStart: number
  readonly selectionEnd: number
  readonly scrollHeight: number
  readonly style: CSSStyleDeclaration
  focus: () => void
  setSelectionRange: (start: number, end: number) => void
}

function nodeText(node: Node): string {
  if (node.nodeType === 3) return node.textContent || ''
  if (node instanceof HTMLElement) {
    if (node.dataset.contextToken) return node.dataset.contextToken
    if (node.tagName === 'BR') return '\n'
  }
  return Array.from(node.childNodes, nodeText).join('')
}

function offsetAt(root: Node, target: Node, offset: number): number {
  let total = 0
  let found = false
  function walk(node: Node) {
    if (found) return
    if (node === target) {
      total += node.nodeType === 3 ? offset : Array.from(node.childNodes).slice(0, offset).reduce((n, child) => n + nodeText(child).length, 0)
      found = true
    } else if (node.contains(target)) Array.from(node.childNodes).forEach(walk)
    else total += nodeText(node).length
  }
  walk(root)
  return total
}

function pointAt(root: Node, offset: number): [Node, number] {
  let remaining = offset
  for (let i = 0; i < root.childNodes.length; i++) {
    const child = root.childNodes[i]
    const length = nodeText(child).length
    if (remaining <= length) {
      if (child.nodeType === 3) return [child, remaining]
      if (child instanceof HTMLElement && (child.dataset.contextToken || child.tagName === 'BR')) return [root, i + (remaining > 0 ? 1 : 0)]
      return pointAt(child, remaining)
    }
    remaining -= length
  }
  return [root, root.childNodes.length]
}

type Props = {
  ref?: Ref<ContextComposerHandle>
  value: string
  attachments: SendAttachment[]
  onAttachments: (attachments: SendAttachment[]) => void
  onValueChange: (value: string, cursor: number) => void
  onCaretChange: (value: string, cursor: number) => void
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
  onPaste: (event: ClipboardEvent<HTMLDivElement>) => void
  onFocus?: () => void
  onBlur?: () => void
  onCompositionStart?: () => void
  onCompositionEnd?: () => void
  placeholder: string
  className?: string
  style?: CSSProperties
}

/** The DOM owns typing/IME; React only reconciles external draft changes and chip decorations. */
export default function ContextComposer({ ref, value, attachments, onAttachments, onValueChange, onCaretChange, onKeyDown, onPaste, ...props }: Props) {
  const root = useRef<HTMLDivElement>(null)
  const caret = useRef({ start: value.length, end: value.length })
  const composing = useRef(false)
  const history = useRef<string[]>([value])
  const historyIndex = useRef(0)
  const [inspected, setInspected] = useState<string | null>(null)
  const attachmentRef = useRef(attachments)
  useLayoutEffect(() => { attachmentRef.current = attachments }, [attachments])

  function selection() {
    const selected = window.getSelection()
    if (root.current && selected?.anchorNode && selected.focusNode && root.current.contains(selected.anchorNode) && root.current.contains(selected.focusNode)) {
      const a = offsetAt(root.current, selected.anchorNode, selected.anchorOffset)
      const b = offsetAt(root.current, selected.focusNode, selected.focusOffset)
      caret.current = { start: Math.min(a, b), end: Math.max(a, b) }
    }
    return caret.current
  }
  function select(start: number, end: number) {
    caret.current = { start, end }
    if (!root.current) return
    const range = document.createRange()
    range.setStart(...pointAt(root.current, start))
    range.setEnd(...pointAt(root.current, end))
    const selected = window.getSelection()
    selected?.removeAllRanges()
    selected?.addRange(range)
  }
  useEffect(() => {
    const capture = () => { selection() }
    document.addEventListener('selectionchange', capture)
    return () => document.removeEventListener('selectionchange', capture)
  }, [])
  function paint(text: string) {
    const element = root.current
    if (!element || composing.current) return
    const active = document.activeElement === element
    const saved = selection()
    const fragment = document.createDocumentFragment()
    let cursor = 0
    const byId = new Map(attachmentRef.current.map(a => [a.id, a]))
    for (const token of contextReferences(text)) {
      fragment.append(document.createTextNode(text.slice(cursor, token.start)))
      const chip = document.createElement('span')
      chip.contentEditable = 'false'
      chip.dataset.contextToken = token.raw
      chip.dataset.contextId = token.id
      chip.className = 'av-context-chip'
      const record = byId.get(token.id)
      chip.dataset.unavailable = String(!record)
      chip.textContent = token.label
      chip.title = record ? `${record.contextKind}: ${record.path || record.text || token.label}` : 'Context unavailable — remove or attach again'
      chip.setAttribute('role', 'button')
      chip.tabIndex = 0
      chip.setAttribute('aria-label', `Inspect ${token.label}${record ? '' : ' (unavailable)'}`)
      fragment.append(chip)
      cursor = token.end
    }
    fragment.append(document.createTextNode(text.slice(cursor)))
    element.replaceChildren(fragment)
    if (active) select(Math.min(saved.start, text.length), Math.min(saved.end, text.length))
  }
  function publish(text: string, cursor: number, remember = true) {
    if (remember && history.current[historyIndex.current] !== text) {
      history.current = [...history.current.slice(0, historyIndex.current + 1), text].slice(-100)
      historyIndex.current = history.current.length - 1
    }
    onValueChange(text, cursor)
  }
  function replaceSelection(text: string) {
    const selected = selection()
    const old = nodeText(root.current!)
    const next = old.slice(0, selected.start) + text + old.slice(selected.end)
    paint(next)
    select(selected.start + text.length, selected.start + text.length)
    publish(next, selected.start + text.length)
  }
  useImperativeHandle(ref, () => ({
    get value() { return root.current ? nodeText(root.current) : value },
    set value(next: string) { paint(next) },
    get selectionStart() { return selection().start },
    get selectionEnd() { return selection().end },
    get scrollHeight() { return root.current?.scrollHeight || 66 },
    get style() { return root.current!.style },
    focus() { root.current?.focus() },
    setSelectionRange: select,
  }))
  useLayoutEffect(() => {
    if (composing.current) return
    paint(value)
    if (history.current[historyIndex.current] !== value) {
      history.current = [...history.current.slice(0, historyIndex.current + 1), value].slice(-100)
      historyIndex.current = history.current.length - 1
    }
  }, [value, attachments]) // DOM synchronization, not derived React state.

  const inspectedAttachment = attachments.find(a => a.id === inspected)
  function copy(event: ClipboardEvent<HTMLDivElement>, cut: boolean) {
    const { start, end } = selection()
    if (start === end) return
    const text = nodeText(root.current!).slice(start, end)
    const ids = new Set(contextReferences(text).map(r => r.id))
    event.preventDefault()
    const records = attachments.filter(a => ids.has(a.id!)).flatMap(a => { const r = contextRecord(a); return r ? [r] : [] })
    event.clipboardData.setData('text/plain', encodeContextText(text, records))
    const payload = JSON.stringify({ version: 1, text, attachments: attachments.filter(a => ids.has(a.id!)) })
    event.clipboardData.setData(CONTEXT_CLIPBOARD_TYPE, payload)
    // OS clipboards can discard custom MIME types between browser windows.
    // Standard HTML carries the same versioned fragment without active markup.
    const fragment = document.createElement('span')
    fragment.dataset.avContext = payload
    fragment.textContent = readableContextText(text)
    event.clipboardData.setData('text/html', fragment.outerHTML)
    if (cut) replaceSelection('')
  }
  return <>
    <div {...props} ref={root} role="textbox" aria-label="Message" aria-multiline="true" contentEditable suppressContentEditableWarning
      data-placeholder={props.placeholder} className={`${props.className || ''} av-context-editor`}
      onBlur={() => { selection(); props.onBlur?.() }}
      onCompositionStart={() => { composing.current = true; props.onCompositionStart?.() }}
      onCompositionEnd={() => { composing.current = false; props.onCompositionEnd?.(); const text = nodeText(root.current!); publish(text, selection().end) }}
      onInput={() => { if (!composing.current) { const text = nodeText(root.current!); publish(text, selection().end) } }}
      onKeyUp={() => onCaretChange(nodeText(root.current!), selection().end)}
      onMouseUp={() => onCaretChange(nodeText(root.current!), selection().end)}
      onClick={event => { const chip = (event.target as HTMLElement).closest<HTMLElement>('[data-context-id]'); if (chip) setInspected(chip.dataset.contextId!) }}
      onCopy={event => copy(event, false)} onCut={event => copy(event, true)}
      onPaste={event => {
        const html = event.clipboardData.getData('text/html')
        const htmlPayload = html && html.length <= 16_000_000
          ? new DOMParser().parseFromString(html, 'text/html').querySelector<HTMLElement>('[data-av-context]')?.dataset.avContext : undefined
        const plain = readComposerContext(event.clipboardData.getData('text/plain'))
        const plainPayload = plain.records.length ? JSON.stringify({ version: 1, text: plain.text, attachments: restoreContextAttachments(plain.records) }) : undefined
        const raw = event.clipboardData.getData(CONTEXT_CLIPBOARD_TYPE) || htmlPayload || plainPayload
        if (raw && raw.length <= 16_000_000) {
          try {
            const fragment = JSON.parse(raw)
            if (fragment.version === 1 && typeof fragment.text === 'string' && Array.isArray(fragment.attachments) && fragment.attachments.length <= 100) {
              const incoming = (fragment.attachments as SendAttachment[]).filter(a => a && contextRecord(a))
              let text = fragment.text
              const imported = incoming.map(a => {
                const id = crypto.randomUUID()
                text = text.replaceAll(`av-context://${a.id})`, `av-context://${id})`)
                return { ...a, id }
              })
              event.preventDefault()
              onAttachments(imported)
              replaceSelection(text)
              return
            }
          } catch { /* Fall back to plain text. */ }
        }
        onPaste(event)
        if (!event.defaultPrevented) { event.preventDefault(); replaceSelection(event.clipboardData.getData('text/plain')) }
      }}
      onKeyDown={event => {
        if (composing.current || event.nativeEvent.isComposing) return
        const chip = (event.target as HTMLElement).closest<HTMLElement>('[data-context-id]')
        if (chip && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setInspected(chip.dataset.contextId!); return }
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
          event.preventDefault()
          historyIndex.current = Math.max(0, Math.min(history.current.length - 1, historyIndex.current + (event.shiftKey ? 1 : -1)))
          const text = history.current[historyIndex.current]
          paint(text); select(text.length, text.length); publish(text, text.length, false); return
        }
        onKeyDown(event)
        if (event.defaultPrevented) return
        if (event.key === 'Enter') { event.preventDefault(); replaceSelection('\n'); return }
        if (event.key === 'Backspace' || event.key === 'Delete') {
          const selected = selection()
          if (selected.start !== selected.end) return
          const token = contextReferences(nodeText(root.current!)).find(r => event.key === 'Backspace' ? r.end === selected.start : r.start === selected.start)
          if (token) { event.preventDefault(); select(token.start, token.end); replaceSelection('') }
        }
      }} />
    {inspected && <div className="av-context-details" role="region" aria-label="Context details">
      <button type="button" onClick={() => setInspected(null)} aria-label="Close context details">Close</button>
      <strong>{inspectedAttachment?.displayName || 'Context unavailable'}</strong>
      {inspectedAttachment?.path && <div>{inspectedAttachment.path}</div>}
      {inspectedAttachment?.data && inspectedAttachment.mimeType?.startsWith('image/') && <img alt={inspectedAttachment.displayName || 'Attached image'} src={`data:${inspectedAttachment.mimeType};base64,${inspectedAttachment.data}`} />}
      <pre>{inspectedAttachment?.text || (!inspectedAttachment ? 'Remove this reference or attach its context again.' : '')}</pre>
    </div>}
  </>
}
