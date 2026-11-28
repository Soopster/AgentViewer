'use client'

// What's new on the Web: revisions and their highlights as the list, the files
// the selected change touched as the detail. A narrow panel shows one at a time.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { formatWhatsNewMarkdown, type WhatsNew, type WhatsNewKind } from '@/lib/whatsNew'
import { changeBarCells, reconcileWhatsNewSelection, splitWhatsNewPath, whatsNewDetail, whatsNewRows } from '@/lib/whatsNewView'
import type { PluginWhatsNewService } from '@/lib/plugins/whatsNew'

const PAGE = 14
/** Below this panel width the list and the detail take turns. */
const WIDE_MIN_PX = 720
const KIND_COLOR: Record<WhatsNewKind, string> = {
  feature: 'var(--accent)',
  improvement: 'var(--t-read, var(--accent))',
  fix: 'var(--amber, #d29922)',
  chore: 'var(--text-3, var(--text-2))',
}
const KIND_GLYPH: Record<WhatsNewKind, string> = { feature: '+', improvement: '↑', fix: '✓', chore: '·' }
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

export function WhatsNewView({ service, docked, onClose }: { service: PluginWhatsNewService; docked: boolean; onClose: () => void }) {
  const [limit, setLimit] = useState(PAGE)
  const [summary, setSummary] = useState<WhatsNew | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [showDetail, setShowDetail] = useState(false)
  const [copied, setCopied] = useState<'item' | 'all' | null>(null)
  const [rootRef, width] = useWidth<HTMLDivElement>()
  const detailRef = useRef<HTMLDivElement | null>(null)
  const serviceRef = useRef(service)
  serviceRef.current = service

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    serviceRef.current.read({ limit }, controller.signal)
      .then(next => { if (!controller.signal.aborted) setSummary(next) })
      .catch((err: unknown) => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Could not read the history') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [limit, reload])

  const rows = useMemo(() => (summary ? whatsNewRows(summary) : []), [summary])
  // A refresh keeps the selected row when it survives.
  const activeKey = reconcileWhatsNewSelection(rows, selectedKey)
  const detail = useMemo(() => (summary && activeKey ? whatsNewDetail(summary, activeKey) : null), [summary, activeKey])
  const canLoadMore = Boolean(summary?.truncated) && (summary?.revisions.length ?? 0) >= limit
  const wide = width === 0 || width >= WIDE_MIN_PX
  const largest = detail ? Math.max(...detail.files.map(file => file.added + file.removed), 1) : 1

  const select = useCallback((key: string, open = false) => {
    setSelectedKey(key)
    if (open) setShowDetail(true)
    detailRef.current?.scrollTo?.({ top: 0 })
  }, [])

  const copy = useCallback((kind: 'item' | 'all') => {
    const text = kind === 'item' ? detail?.markdown : summary ? formatWhatsNewMarkdown(summary) : ''
    if (!text) return
    void navigator.clipboard?.writeText(text).then(() => { setCopied(kind); window.setTimeout(() => setCopied(null), 1800) })
  }, [detail, summary])

  // A window shortcut only when this is the overlay: a docked panel must not claim the page's keys.
  useEffect(() => {
    if (docked) return undefined
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && /^(INPUT|TEXTAREA)$/.test(event.target.tagName)) return
      if (event.key === 'Escape') { if (!wide && showDetail) setShowDetail(false); else onClose() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [docked, onClose, wide, showDetail])

  const onListKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const down = event.key === 'ArrowDown' || event.key === 'j'
    const up = event.key === 'ArrowUp' || event.key === 'k'
    if (!down && !up) return
    event.preventDefault()
    const index = Math.max(rows.findIndex(row => row.key === activeKey), 0)
    const next = rows[Math.max(0, Math.min(rows.length - 1, index + (down ? 1 : -1)))]
    if (!next) return
    select(next.key)
    // Selection follows focus so the highlighted row is the one that has it.
    requestAnimationFrame(() => event.currentTarget.querySelector<HTMLElement>(`[data-row="${CSS.escape(next.key)}"]`)?.focus())
  }

  const list = (
    <div role="listbox" aria-label="Revisions and highlights" onKeyDown={onListKey}
      style={{ display: wide ? 'block' : showDetail ? 'none' : 'block', width: wide ? 'clamp(260px, 38%, 400px)' : '100%', flexShrink: 0, overflow: 'auto', borderRight: wide ? '1px solid var(--border)' : 'none' }}>
      {rows.map(row => {
        const selected = row.key === activeKey
        return (
          <button key={row.key} type="button" role="option" aria-selected={selected} data-row={row.key} tabIndex={selected ? 0 : -1}
            onClick={() => select(row.key, true)}
            style={{ display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', border: 'none', borderLeft: `3px solid ${selected ? 'var(--accent)' : 'transparent'}`, background: selected ? 'var(--surface-3)' : 'transparent', color: 'var(--text)', padding: row.type === 'revision' ? '7px 12px 7px 10px' : '5px 12px 5px 22px', marginTop: row.type === 'revision' ? 4 : 0 }}>
            <div style={{ display: 'flex', gap: 6, fontWeight: row.type === 'revision' ? 600 : 400, color: row.type === 'revision' ? 'var(--accent)' : 'var(--text)', fontSize: 13 }}>
              {row.kind ? <span aria-hidden style={{ color: KIND_COLOR[row.kind], width: 10, flexShrink: 0 }}>{KIND_GLYPH[row.kind]}</span> : null}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.label}>{row.label}</span>
            </div>
            <div style={{ fontSize: 11, color: muted, paddingLeft: row.kind ? 16 : 0 }}>{row.meta}</div>
          </button>
        )
      })}
      {canLoadMore ? <button type="button" onClick={() => setLimit(value => value + PAGE)} style={{ margin: 10, fontSize: 12 }}>Older revisions</button> : null}
    </div>
  )

  const files = detail ? (
    <div role="table" aria-label="Files changed" style={{ fontSize: 12, fontFamily: 'var(--font-mono, ui-monospace, monospace)' }}>
      {detail.files.map(file => {
        const { dir, name } = splitWhatsNewPath(file.path)
        const bar = changeBarCells(file, largest, 10)
        return (
          <div role="row" key={file.path} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '2px 0' }}>
            <span role="cell" title={file.path} style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <span style={{ color: 'var(--text)' }}>{name}</span>
              {dir ? <span style={{ color: muted }}> {dir}</span> : null}
            </span>
            <span role="cell" aria-label={`${file.added} added, ${file.removed} removed`} style={{ flexShrink: 0, display: 'flex', gap: 8 }}>
              <span aria-hidden style={{ letterSpacing: -1 }}>
                <span style={{ color: 'var(--green, #3fb950)' }}>{'■'.repeat(bar.add)}</span>
                <span style={{ color: 'var(--red, #f85149)' }}>{'■'.repeat(bar.remove)}</span>
              </span>
              <span style={{ color: 'var(--green, #3fb950)', minWidth: 36, textAlign: 'right' }}>+{file.added}</span>
              <span style={{ color: 'var(--red, #f85149)', minWidth: 36, textAlign: 'right' }}>−{file.removed}</span>
            </span>
          </div>
        )
      })}
      {detail.hiddenFiles > 0 ? <div style={{ color: muted, fontStyle: 'italic', padding: '2px 0' }}>and {detail.hiddenFiles} more file{detail.hiddenFiles === 1 ? '' : 's'}</div> : null}
    </div>
  ) : null

  const detailPane = (
    <div style={{ display: wide || showDetail ? 'flex' : 'none', flex: 1, minWidth: 0, flexDirection: 'column' }}>
      {!detail ? (
        <div style={{ padding: 16, color: 'var(--text-2)' }}>
          {error ? '' : loading ? 'Reading the git history…' : rows.length === 0 ? 'No commits to summarize in this repository.' : 'Select a revision or highlight to see the files it changed.'}
        </div>
      ) : (
        <>
          <div style={{ flexShrink: 0, padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
            {!wide ? <button type="button" onClick={() => setShowDetail(false)} style={{ fontSize: 12, marginBottom: 6 }}>← All revisions</button> : null}
            <div style={{ fontSize: 15, fontWeight: 600, color: detail.kind ? KIND_COLOR[detail.kind] : 'var(--accent)' }}>{detail.title}</div>
            <div style={{ fontSize: 12, color: 'var(--text-2)' }}>{detail.subtitle}</div>
            {detail.note ? <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>{detail.note}</div> : null}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, fontSize: 12 }}>
              <span style={{ color: 'var(--text-2)' }}>Files changed · {detail.files.length + detail.hiddenFiles}</span>
              <span style={{ color: 'var(--green, #3fb950)' }}>+{detail.added}</span>
              <span style={{ color: 'var(--red, #f85149)' }}>−{detail.removed}</span>
              <span style={{ flex: 1 }} />
              <button type="button" onClick={() => copy('item')} style={{ fontSize: 12 }}>{copied === 'item' ? 'Copied' : 'Copy as markdown'}</button>
            </div>
          </div>
          <div ref={detailRef} style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '8px 16px' }}>
            {detail.files.length === 0 ? <div style={{ color: 'var(--text-2)' }}>No files changed (lockfiles are not counted).</div> : files}
          </div>
        </>
      )}
    </div>
  )

  const body = (
    <div ref={rootRef} data-plugin-view="whats-new" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--surface)', color: 'var(--text)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ flex: 1, fontSize: 12, color: error ? 'var(--red, #f85149)' : 'var(--text-2)' }} role={error ? 'alert' : undefined}>
          {error ?? (summary ? `${summary.revisions.length} ${summary.grouping === 'release' ? 'releases' : 'days'} · ${summary.scanned} commits read${summary.truncated ? ' · older history not shown' : ''}${loading ? ' · reading…' : ''}` : loading ? 'Reading…' : '')}
        </span>
        <button type="button" onClick={() => copy('all')} disabled={!summary} style={{ fontSize: 12 }}>{copied === 'all' ? 'Copied' : 'Copy all'}</button>
        <button type="button" onClick={() => setReload(value => value + 1)} style={{ fontSize: 12 }}>Refresh</button>
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
    <div role="dialog" aria-label="What's new" onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)' }}>
      <div onClick={event => event.stopPropagation()}
        style={{ width: 'min(1040px, calc(100vw - 32px))', height: 'min(720px, calc(100vh - 48px))', border: '1px solid var(--border-2)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 16px 48px var(--shadow, rgba(0,0,0,0.3))' }}>
        {body}
      </div>
    </div>
  )
}
