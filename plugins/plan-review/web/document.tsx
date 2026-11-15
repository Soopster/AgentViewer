'use client'
import { memo, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@/components/ui/button'
import { planSourceOffsets, type PlanAnchor, type PlanAnnotation } from '@/lib/plugins/planReview'
type Node = { type: string; value?: string; tagName?: string; properties?: Record<string, unknown>; children?: Node[]; position?: { start: { offset?: number }; end: { offset?: number } } }
/** The renderer keeps source offsets on text spans; persistent anchors never contain DOM nodes. */
function anchoredText(text: string, anchors: PlanAnchor[]) {
  return () => (tree: Node) => {
    const visit = (node: Node) => {
      if (!node.children) return
      node.children = node.children.map(child => {
        if (child.type !== 'text' || !child.value) { visit(child); return child }
        const position = child.position ?? (node.children?.length === 1 ? node.position : undefined)
        const start = position?.start.offset, end = position?.end.offset
        if (start === undefined || end === undefined) return child
        const value = child.value, offsets = planSourceOffsets(text.slice(start, end), value, start)
        if (!offsets) return child
        const boundaries = new Set([0, value.length])
        for (const anchor of anchors) {
          const a = offsets.findIndex(offset => offset >= anchor.start), b = offsets.findIndex(offset => offset >= anchor.end)
          if (a >= 0) boundaries.add(a)
          if (b >= 0) boundaries.add(b)
        }
        const sorted = [...boundaries].sort((a, b) => a - b)
        const children = sorted.slice(0, -1).map((from, i): Node => {
          const to = sorted[i + 1], leaf: Node = { type: 'text', value: value.slice(from, to) }
          return anchors.some(anchor => offsets[from] < anchor.end && offsets[to] > anchor.start) ? { type: 'element', tagName: 'mark', properties: {}, children: [leaf] } : leaf
        })
        return { type: 'element', tagName: 'span', properties: { 'data-plan-text': true, 'data-plan-offsets': JSON.stringify(offsets) }, children }
      })
    }
    visit(tree)
  }
}
function lineRange(text: string, first: number, last: number) {
  const lines = text.split('\n'), start = lines.slice(0, first - 1).reduce((sum, line) => sum + line.length + 1, 0)
  return { start, end: Math.min(text.length, start + lines.slice(first - 1, last).join('\n').length) }
}
export const PlanDocument = memo(function PlanDocument({ text, notes, onSelect }: { text: string; notes: PlanAnnotation[]; onSelect: (start: number, end: number) => void }) {
  const [source, setSource] = useState(false), [first, setFirst] = useState(1), [last, setLast] = useState(1), [hint, setHint] = useState('')
  const container = useRef<HTMLDivElement>(null)
  const anchors = useMemo(() => notes.flatMap(note => note.anchor?.status === 'active' ? [note.anchor] : []).sort((a, b) => a.start - b.start), [notes])
  const plugins = useMemo(() => [anchoredText(text, anchors)], [text, anchors])
  const select = () => {
    const selection = window.getSelection(), root = container.current
    if (!selection || selection.isCollapsed || !root?.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return
    const range = selection.getRangeAt(0)
    if (source) {
      const pre = root.querySelector('pre')!
      if (!pre.contains(range.startContainer) || !pre.contains(range.endContainer)) return
      const prefix = range.cloneRange(); prefix.selectNodeContents(pre); prefix.setEnd(range.startContainer, range.startOffset)
      const start = prefix.toString().length; onSelect(start, start + range.toString().length); setHint(''); return
    }
    const spans = [...root.querySelectorAll('[data-plan-text]')].filter(span => range.intersectsNode(span))
    if (!spans.length) { setHint('Choose a line range or use Source to select this passage precisely.'); return }
    const boundary = (span: Element, end: boolean) => {
      const node = end ? range.endContainer : range.startContainer, offset = end ? range.endOffset : range.startOffset
      const prefix = document.createRange(); prefix.selectNodeContents(span)
      if (span.contains(node)) prefix.setEnd(node, offset)
      else if (!end) prefix.collapse(true)
      const offsets: number[] = JSON.parse(span.getAttribute('data-plan-offsets')!)
      return offsets[prefix.toString().length]
    }
    const start = boundary(spans[0], false), end = boundary(spans[spans.length - 1], true)
    if (Number.isInteger(start) && Number.isInteger(end) && end > start) { onSelect(start, end); setHint('') }
    else setHint('Choose a line range or use Source to select this passage precisely.')
  }
  const raw: React.ReactNode[] = []; let cursor = 0
  for (const anchor of anchors) { if (anchor.start < cursor) continue; raw.push(text.slice(cursor, anchor.start), <mark key={`${anchor.start}:${anchor.end}`}>{text.slice(anchor.start, anchor.end)}</mark>); cursor = anchor.end }
  raw.push(text.slice(cursor))
  return <section aria-label="Plan document" className="flex min-h-0 flex-col gap-3">
    <div className="flex flex-wrap items-center gap-2"><Button variant="outline" size="sm" onClick={() => setSource(!source)}>{source ? 'Rendered' : 'Source'}</Button>
      <label className="text-xs">From line <input aria-label="First plan line" className="w-16 rounded border bg-background p-1" type="number" min={1} max={text.split('\n').length} value={first} onChange={event => { const value = event.currentTarget.valueAsNumber; setFirst(Number.isFinite(value) ? Math.max(1, Math.min(text.split('\n').length, value)) : 1) }} /></label>
      <label className="text-xs">To line <input aria-label="Last plan line" className="w-16 rounded border bg-background p-1" type="number" min={first} max={text.split('\n').length} value={last} onChange={event => { const value = event.currentTarget.valueAsNumber; setLast(Number.isFinite(value) ? Math.max(1, Math.min(text.split('\n').length, value)) : 1) }} /></label>
      <Button variant="outline" size="sm" onClick={() => { const range = lineRange(text, first, Math.max(first, last)); onSelect(range.start, range.end) }}>Annotate lines</Button>
    </div>
    {hint ? <p role="status" className="text-xs">{hint}</p> : null}
    <div ref={container} onMouseUp={select} onKeyUp={event => { if (event.key === 'Shift') select() }} className="plan-review-document min-h-0 overflow-auto rounded border p-4 text-sm leading-relaxed">
      {source ? <pre className="whitespace-pre-wrap break-words font-mono text-xs">{raw}</pre> : <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={plugins}>{text}</ReactMarkdown>}
    </div>
  </section>
})
