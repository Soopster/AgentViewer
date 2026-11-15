'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatWhatsNewMarkdown, whatsNewKindLabel, whatsNewRevisionStats, type WhatsNew, type WhatsNewKind } from '@/lib/whatsNew'
import type { PluginWhatsNewService } from '@/lib/plugins/whatsNew'

const PAGE = 14
const KIND_COLOR: Record<WhatsNewKind, string> = {
  feature: 'var(--accent)',
  improvement: 'var(--t-read, var(--accent))',
  fix: 'var(--amber, #d29922)',
  chore: 'var(--text-3, var(--text-2))',
}

/** Highlights per revision, the same selection the TUI shows and both copy as markdown. */
export function WhatsNewView({ service, docked, onClose }: { service: PluginWhatsNewService; docked: boolean; onClose: () => void }) {
  const [limit, setLimit] = useState(PAGE)
  const [summary, setSummary] = useState<WhatsNew | null>(null)
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
    serviceRef.current.read({ limit }, controller.signal)
      .then(next => { if (!controller.signal.aborted) setSummary(next) })
      .catch((err: unknown) => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Could not read the history') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [limit, reload])

  const markdown = useMemo(() => (summary ? formatWhatsNewMarkdown(summary) : ''), [summary])
  const canLoadMore = Boolean(summary?.truncated) && (summary?.revisions.length ?? 0) >= limit
  const copy = useCallback(() => {
    if (!markdown) return
    void navigator.clipboard?.writeText(markdown).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1800) })
  }, [markdown])

  useEffect(() => {
    if (docked) return undefined
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && /^(INPUT|TEXTAREA)$/.test(event.target.tagName)) return
      if (event.key === 'Escape') onClose()
      else if (event.key === 'c') copy()
      else if (event.key === 'r') setReload(value => value + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [docked, onClose, copy])

  const body = (
    <div data-plugin-view="whats-new" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--surface)', color: 'var(--text)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ flex: 1, fontSize: 12, color: 'var(--text-2)' }}>
          {loading ? 'Reading…' : summary ? `${summary.revisions.length} ${summary.grouping === 'release' ? 'releases' : 'days'} · ${summary.scanned} commits read` : ''}
        </span>
        <button type="button" onClick={copy} disabled={!markdown} style={{ fontSize: 12 }}>{copied ? 'Copied' : 'Copy markdown'}</button>
        <button type="button" onClick={() => setReload(value => value + 1)} style={{ fontSize: 12 }}>Refresh</button>
        {!docked ? <button type="button" aria-label="Close" onClick={onClose} style={{ fontSize: 12 }}>✕</button> : null}
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '10px 16px', fontSize: 13, lineHeight: 1.55 }}>
        {error ? <div role="alert" style={{ color: 'var(--red, #f85149)' }}>{error}</div>
          : !summary ? <div style={{ color: 'var(--text-2)' }}>Reading the git history…</div>
          : summary.revisions.length === 0 ? <div style={{ color: 'var(--text-2)' }}>No commits to summarize.</div>
          : summary.revisions.map(revision => (
            <section key={revision.id} style={{ marginBottom: 18 }}>
              <div style={{ color: 'var(--accent)', fontWeight: 600, fontSize: 15 }}>{revision.title}</div>
              <div style={{ color: 'var(--text-3, var(--text-2))', fontSize: 12, marginBottom: 4 }}>{whatsNewRevisionStats(revision)}</div>
              {revision.highlights.length === 0 ? <div style={{ color: 'var(--text-2)', fontStyle: 'italic' }}>Maintenance only.</div> : null}
              {revision.highlights.map(highlight => (
                <div key={highlight.sha} style={{ padding: '3px 0 3px 12px', borderLeft: `2px solid ${KIND_COLOR[highlight.kind]}` }}>
                  <div>
                    <span style={{ color: KIND_COLOR[highlight.kind], fontWeight: 600, fontSize: 11, textTransform: 'uppercase', marginRight: 6 }}>{whatsNewKindLabel(highlight.kind)}</span>
                    {highlight.subject}
                    {highlight.area ? <span style={{ color: 'var(--text-3, var(--text-2))', fontSize: 12 }}> · {highlight.area}</span> : null}
                  </div>
                  {highlight.detail ? <div style={{ color: 'var(--text-2)', fontSize: 12 }}>{highlight.detail}</div> : null}
                </div>
              ))}
              {revision.others > 0 && revision.highlights.length > 0 ? <div style={{ color: 'var(--text-3, var(--text-2))', fontStyle: 'italic', paddingLeft: 12 }}>and {revision.others} other change{revision.others === 1 ? '' : 's'}</div> : null}
            </section>
          ))}
        {canLoadMore ? <button type="button" onClick={() => setLimit(value => value + PAGE)} style={{ fontSize: 12 }}>Older revisions</button> : null}
      </div>
    </div>
  )
  if (docked) return body
  return (
    <div role="dialog" aria-label="What's new" onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)' }}>
      <div onClick={event => event.stopPropagation()}
        style={{ width: 'min(860px, calc(100vw - 32px))', height: 'min(720px, calc(100vh - 48px))', border: '1px solid var(--border-2)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 16px 48px var(--shadow, rgba(0,0,0,0.3))' }}>
        {body}
      </div>
    </div>
  )
}
