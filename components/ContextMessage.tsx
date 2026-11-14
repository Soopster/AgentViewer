'use client'

import { useMemo, useState } from 'react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CONTEXT_CLIPBOARD_TYPE, createContextAttachment, encodeContextText, type ComposerContextRecord } from '@/lib/composerContext'

export default function ContextMessage({ text, records }: { text: string; records: ComposerContextRecord[] }) {
  const [selected, setSelected] = useState<string | null>(null)
  const [copyNotice, setCopyNotice] = useState('')
  const byId = useMemo(() => new Map(records.map(r => [r.id, r])), [records])
  const inspected = selected ? byId.get(selected) : null
  return <div className="av-context-message">
    <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={url => /^av-context:\/\/[a-zA-Z0-9_-]{1,160}$/.test(url) ? url : defaultUrlTransform(url)} components={{
      a: ({ href, children }) => {
        if (href?.startsWith('av-context://')) {
          const id = href.slice('av-context://'.length)
          return <button type="button" className="av-context-chip" data-unavailable={!byId.has(id)} onClick={() => setSelected(id)}>{children}</button>
        }
        return <a href={href} target="_blank" rel="noreferrer">{children}</a>
      },
    }}>{text}</ReactMarkdown>
    {selected && <div className="av-context-details" role="region" aria-label="Context details">
      <button type="button" onClick={() => setSelected(null)}>Close</button>
      <strong>{inspected?.label || 'Context unavailable'}</strong>
      {inspected?.path && <div>{inspected.path}</div>}
      <pre>{inspected?.text || (!inspected ? 'The context for this reference is no longer available.' : '')}</pre>
    </div>}
    <button type="button" className="av-context-copy" onClick={async () => {
      // Image bytes are owned by the provider's attachment channel, not this
      // transcript envelope. Keep such references unresolved on text-only copy.
      const attachments = records.filter(r => r.kind !== 'image' || r.path).map(r => ({ ...createContextAttachment(r.kind, r.label, r.text, r.path), id: r.id }))
      const plain = encodeContextText(text, records)
      try {
        await navigator.clipboard.write([new ClipboardItem({
          'text/plain': new Blob([plain], { type: 'text/plain' }),
          [`web ${CONTEXT_CLIPBOARD_TYPE}`]: new Blob([JSON.stringify({ version: 1, text, attachments })], { type: CONTEXT_CLIPBOARD_TYPE }),
        })])
        setCopyNotice('Copied with context')
      } catch {
        try { await navigator.clipboard.writeText(plain); setCopyNotice('Copied with context') }
        catch { setCopyNotice('Clipboard unavailable. Select and copy the message instead.') }
      }
    }}>Copy with context</button>
    {copyNotice && <span role="status" className="av-context-copy">{copyNotice}</span>}
  </div>
}
