'use client'

// What's new in Agent Viewer on the Web: features by date as the list, how to
// use the selected one as the detail. A narrow panel shows one at a time.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { FEATURE_AREAS, featureGuideMarkdown, featureGuideRows, featureMarkdown, featureNewAfter, filterFeatures, formatFeatureDate, sortedFeatures, type FeatureArea, type FeatureGuideEntry } from '@/lib/featureGuide'

const WIDE_MIN_PX = 720
const muted = 'var(--text-3, var(--text-2))'

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const node = ref.current
    if (!node) return undefined
    const observer = new ResizeObserver(entries => setWidth(Math.round(entries[0]?.contentRect.width ?? 0)))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

function Steps({ title, items, bullet = '›' }: { title: string; items: readonly string[]; bullet?: string }) {
  if (items.length === 0) return null
  return (
    <section style={{ marginTop: 16 }}>
      <div style={{ fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: muted, marginBottom: 6 }}>{title}</div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
        {items.map((item, index) => (
          <li key={index} style={{ display: 'flex', gap: 8, fontSize: 13, lineHeight: 1.5 }}>
            <span aria-hidden style={{ color: 'var(--accent)', flexShrink: 0 }}>{bullet}</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function FeatureGuideView({ docked, onClose, entries }: { docked: boolean; onClose: () => void; entries?: readonly FeatureGuideEntry[] }) {
  const all = useMemo(() => sortedFeatures(entries), [entries])
  const newAfter = useMemo(() => featureNewAfter(all), [all])
  const [query, setQuery] = useState('')
  const [area, setArea] = useState<FeatureArea | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [showDetail, setShowDetail] = useState(false)
  const [copied, setCopied] = useState<'item' | 'all' | null>(null)
  const [rootRef, width] = useWidth<HTMLDivElement>()
  const detailRef = useRef<HTMLDivElement | null>(null)

  const shown = useMemo(() => filterFeatures(all, query, area), [all, query, area])
  const rows = useMemo(() => featureGuideRows(shown, newAfter), [shown, newAfter])
  const featureRows = useMemo(() => rows.filter(row => row.type === 'feature'), [rows])
  const activeKey = featureRows.some(row => row.key === selectedKey) ? selectedKey : featureRows[0]?.key ?? null
  const active = featureRows.find(row => row.key === activeKey)
  const entry = active?.type === 'feature' ? active.entry : null
  const newCount = featureRows.filter(row => row.type === 'feature' && row.isNew).length
  const wide = width === 0 || width >= WIDE_MIN_PX

  const select = useCallback((key: string, open = false) => {
    setSelectedKey(key)
    if (open) setShowDetail(true)
    detailRef.current?.scrollTo?.({ top: 0 })
  }, [])

  const copy = useCallback((kind: 'item' | 'all') => {
    const text = kind === 'item' ? (entry ? featureMarkdown(entry) : '') : featureGuideMarkdown(shown)
    if (!text) return
    void navigator.clipboard?.writeText(text).then(() => { setCopied(kind); window.setTimeout(() => setCopied(null), 1800) })
  }, [entry, shown])

  // A window shortcut only when this is the overlay: a docked panel must not claim the page's keys.
  useEffect(() => {
    if (docked) return undefined
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (event.target instanceof HTMLInputElement && event.target.value) return
      if (!wide && showDetail) setShowDetail(false)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [docked, onClose, wide, showDetail])

  const onListKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const down = event.key === 'ArrowDown' || event.key === 'j'
    const up = event.key === 'ArrowUp' || event.key === 'k'
    if (!down && !up) return
    event.preventDefault()
    const index = Math.max(featureRows.findIndex(row => row.key === activeKey), 0)
    const next = featureRows[Math.max(0, Math.min(featureRows.length - 1, index + (down ? 1 : -1)))]
    if (!next) return
    select(next.key)
    const list = event.currentTarget
    requestAnimationFrame(() => list.querySelector<HTMLElement>(`[data-row="${CSS.escape(next.key)}"]`)?.focus())
  }

  const list = (
    <div role="listbox" aria-label="Features" onKeyDown={onListKey}
      style={{ display: wide ? 'block' : showDetail ? 'none' : 'block', width: wide ? 'clamp(260px, 38%, 380px)' : '100%', flexShrink: 0, overflow: 'auto', borderRight: wide ? '1px solid var(--border)' : 'none', paddingBottom: 8 }}>
      {featureRows.length === 0 ? <div style={{ padding: 16, color: 'var(--text-2)', fontSize: 13 }}>No feature matches that search.</div> : null}
      {rows.map(row => {
        if (row.type === 'date') {
          return <div key={row.key} role="presentation" style={{ padding: '12px 12px 4px', fontSize: 11, fontWeight: 600, letterSpacing: 0.4, color: 'var(--accent)' }}>{row.label}</div>
        }
        const selected = row.key === activeKey
        return (
          <button key={row.key} type="button" role="option" aria-selected={selected} data-row={row.key} tabIndex={selected ? 0 : -1}
            onClick={() => select(row.key, true)}
            style={{ display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', border: 'none', borderLeft: `3px solid ${selected ? 'var(--accent)' : 'transparent'}`, background: selected ? 'var(--surface-3)' : 'transparent', color: 'var(--text)', padding: '6px 12px 6px 14px' }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', fontSize: 13 }}>
              <span style={{ flex: 1, minWidth: 0 }}>{row.entry.title}</span>
              {row.isNew ? <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 4, padding: '0 4px', flexShrink: 0 }}>NEW</span> : null}
            </div>
            <div style={{ fontSize: 11, color: muted }}>{row.entry.area}</div>
          </button>
        )
      })}
    </div>
  )

  const detailPane = (
    <div ref={detailRef} style={{ display: wide || showDetail ? 'block' : 'none', flex: 1, minWidth: 0, overflow: 'auto', padding: '14px 20px 20px' }}>
      {!entry ? (
        <div style={{ color: 'var(--text-2)' }}>Select a feature to see how to use it.</div>
      ) : (
        <article>
          {!wide ? <button type="button" onClick={() => setShowDetail(false)} style={{ fontSize: 12, marginBottom: 10 }}>← All features</button> : null}
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{entry.title}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4, fontSize: 12, color: muted }}>
            <span>{entry.area} · {formatFeatureDate(entry.added)}{entry.plugin ? ` · plugin: ${entry.plugin}` : ''}</span>
            <span style={{ flex: 1 }} />
            <button type="button" onClick={() => copy('item')} style={{ fontSize: 12 }}>{copied === 'item' ? 'Copied' : 'Copy as markdown'}</button>
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.6, margin: '14px 0 0' }}>{entry.summary}</p>
          {entry.web.length === 0
            ? <p style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 16 }}>This one is in the terminal app only (<code>npx agent-viewer</code>).</p>
            : <Steps title="How to use it here" items={entry.web} />}
          <Steps title="In the terminal app" items={entry.tui} />
          <Steps title="Good to know" items={entry.notes ?? []} bullet="·" />
        </article>
      )}
    </div>
  )

  const body = (
    <div ref={rootRef} data-plugin-view="feature-guide" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--surface)', color: 'var(--text)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>What&apos;s new in Agent Viewer</span>
        <span style={{ fontSize: 12, color: muted }}>{all.length} features{newCount ? ` · ${newCount} new this week` : ''}</span>
        <span style={{ flex: 1 }} />
        <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search features" aria-label="Search features"
          style={{ fontSize: 12, padding: '4px 8px', width: 180, background: 'var(--surface-2, var(--surface))', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6 }} />
        <select value={area ?? ''} onChange={event => setArea((event.target.value || null) as FeatureArea | null)} aria-label="Area" style={{ fontSize: 12 }}>
          <option value="">All areas</option>
          {FEATURE_AREAS.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
        <button type="button" onClick={() => copy('all')} style={{ fontSize: 12 }}>{copied === 'all' ? 'Copied' : 'Copy all'}</button>
        {!docked ? <button type="button" aria-label="Close" onClick={onClose} style={{ fontSize: 12 }}>✕</button> : null}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {list}
        {detailPane}
      </div>
    </div>
  )
  if (docked) return body
  return (
    <div role="dialog" aria-label="What's new in Agent Viewer" onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)' }}>
      <div onClick={event => event.stopPropagation()}
        style={{ width: 'min(1040px, calc(100vw - 32px))', height: 'min(720px, calc(100vh - 48px))', border: '1px solid var(--border-2)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 16px 48px var(--shadow, rgba(0,0,0,0.3))' }}>
        {body}
      </div>
    </div>
  )
}
