'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DAILY_SUMMARY_RANGES, dailySummaryLineTone, formatDailySummaryMarkdown, type DailySummary, type DailySummaryRange } from '@/lib/dailySummary'
import type { PluginDailySummaryService } from '@/lib/plugins/dailySummary'

const RANGE_LABELS: Record<DailySummaryRange, string> = { today: 'Today', yesterday: 'Yesterday', week: 'This week' }
const RANGE_KEYS: Record<string, DailySummaryRange> = { t: 'today', y: 'yesterday', w: 'week' }
const TONE_STYLE: Record<ReturnType<typeof dailySummaryLineTone>, React.CSSProperties> = {
  title: { color: 'var(--accent)', fontWeight: 600, fontSize: 15 },
  repo: { color: 'var(--t-read, var(--accent))', fontWeight: 600, marginTop: 10 },
  waiting: { color: 'var(--amber, #d29922)', fontWeight: 600 },
  heading: { color: 'var(--text-2)', fontWeight: 600, marginTop: 4 },
  prompt: { color: 'var(--text-2)', paddingLeft: 18 },
  item: { color: 'var(--text)' },
  note: { color: 'var(--text-3, var(--text-2))', fontStyle: 'italic' },
  plain: { color: 'var(--text-2)' },
}

export const STATUS_UPDATE_PROMPT = "Turn this record of my agents' work into a short status update: what got done, what is in progress, and what is blocked on me. Keep it factual and do not invent work that is not listed."

/** The same document the TUI shows and copies: one line per markdown line, coloured by role. */
export function DailySummaryView({ service, docked, onClose, onDraft }: {
  service: PluginDailySummaryService
  docked: boolean
  onClose: () => void
  onDraft?: (text: string) => void
}) {
  const [range, setRange] = useState<DailySummaryRange>('today')
  const [summary, setSummary] = useState<DailySummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  const [copied, setCopied] = useState(false)
  const serviceRef = useRef(service)
  serviceRef.current = service

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    serviceRef.current.read(range, controller.signal)
      .then(next => { if (!controller.signal.aborted) setSummary(next) })
      .catch((err: unknown) => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Could not read the summary') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [range, reload])

  const markdown = useMemo(() => (summary ? formatDailySummaryMarkdown(summary) : ''), [summary])
  const copy = useCallback(() => {
    if (!markdown) return
    void navigator.clipboard?.writeText(markdown).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1800) })
  }, [markdown])

  useEffect(() => {
    if (docked) return undefined
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && /^(INPUT|TEXTAREA)$/.test(event.target.tagName)) return
      if (event.key === 'Escape') { onClose(); return }
      const direct = RANGE_KEYS[event.key]
      if (direct) setRange(direct)
      else if (event.key === 'c') copy()
      else if (event.key === 'r') setReload(value => value + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [docked, onClose, copy])

  const body = (
    <div data-plugin-view="daily-summary" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--surface)', color: 'var(--text)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
        {DAILY_SUMMARY_RANGES.map(entry => (
          <button key={entry} type="button" onClick={() => setRange(entry)} aria-pressed={entry === range}
            style={{ fontSize: 12, padding: '3px 10px', borderRadius: 999, cursor: 'pointer', border: '1px solid var(--border)', background: entry === range ? 'var(--surface-3)' : 'transparent', color: entry === range ? 'var(--text)' : 'var(--text-2)', fontWeight: entry === range ? 600 : 400, borderColor: entry === range ? 'var(--border-2)' : 'var(--border)' }}>
            {RANGE_LABELS[entry]}
          </button>
        ))}
        <span style={{ flex: 1, fontSize: 12, color: 'var(--text-2)' }}>{loading ? 'Reading…' : ''}</span>
        <button type="button" onClick={copy} disabled={!markdown} style={{ fontSize: 12 }}>{copied ? 'Copied' : 'Copy markdown'}</button>
        {onDraft ? <button type="button" disabled={!markdown} onClick={() => onDraft(`${STATUS_UPDATE_PROMPT}\n\n${markdown}`)} style={{ fontSize: 12 }}>Draft status update</button> : null}
        <button type="button" onClick={() => setReload(value => value + 1)} style={{ fontSize: 12 }}>Refresh</button>
        {!docked ? <button type="button" aria-label="Close" onClick={onClose} style={{ fontSize: 12 }}>✕</button> : null}
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '10px 16px', fontSize: 13, lineHeight: 1.55 }}>
        {error ? <div role="alert" style={{ color: 'var(--red, #f85149)' }}>{error}</div>
          : !summary ? <div style={{ color: 'var(--text-2)' }}>Reading sessions, commits and pull requests…</div>
          : markdown.replace(/\n$/, '').split('\n').map((line, index) => (
            <div key={index} style={{ ...TONE_STYLE[dailySummaryLineTone(line)], minHeight: '1em', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {line.replace(/^#+ /, '').replace(/^\*\*(.*)\*\*$/, '$1').replace(/^_(.*)_$/, '$1').replace(/^\s*- /, '• ')}
            </div>
          ))}
      </div>
    </div>
  )
  if (docked) return body
  return (
    <div role="dialog" aria-label="Daily summary" onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)' }}>
      <div onClick={event => event.stopPropagation()}
        style={{ width: 'min(860px, calc(100vw - 32px))', height: 'min(720px, calc(100vh - 48px))', border: '1px solid var(--border-2)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 16px 48px var(--shadow, rgba(0,0,0,0.3))' }}>
        {body}
      </div>
    </div>
  )
}
