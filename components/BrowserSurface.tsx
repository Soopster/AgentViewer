'use client'

import { ArrowLeft, ArrowRight, ExternalLink, Globe2, RotateCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

/**
 * Browser surface for the right panel: an iframe with a URL bar, aimed at the
 * dev server the agent is working on.
 *
 * An iframe is the only thing a web build can host, so history is tracked here
 * rather than read back from the frame — cross-origin frames expose neither
 * their location nor their history length. Sites that send `X-Frame-Options`
 * or a framing CSP render blank; the "open externally" affordance is the escape
 * hatch, and the hint below the bar says so rather than leaving a mystery void.
 */

const LOCAL_PRESETS = ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:8080']

/** Bare hosts, ports and paths all become something loadable. */
function normalizeBrowserUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (/^\d{2,5}$/.test(trimmed)) return `http://localhost:${trimmed}`
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed
  if (trimmed.startsWith('/')) return `http://localhost:3000${trimmed}`
  return `http://${trimmed}`
}

export default function BrowserSurface({
  url,
  onUrlChange,
}: {
  url: string | null
  onUrlChange: (url: string) => void
}) {
  const [draft, setDraft] = useState(url ?? '')
  const [history, setHistory] = useState<string[]>(url ? [url] : [])
  const [historyIndex, setHistoryIndex] = useState(url ? 0 : -1)
  const [reloadKey, setReloadKey] = useState(0)

  const current = historyIndex >= 0 ? history[historyIndex] ?? null : null

  useEffect(() => {
    setDraft(current ?? '')
  }, [current])

  // State updaters must stay pure (StrictMode double-invokes them), so the next
  // history slice is computed up front rather than inside the updater.
  const navigate = useCallback((raw: string) => {
    const next = normalizeBrowserUrl(raw)
    if (!next) return
    const kept = history.slice(0, historyIndex + 1)
    const nextHistory = kept[kept.length - 1] === next ? kept : [...kept, next]
    setHistory(nextHistory)
    setHistoryIndex(nextHistory.length - 1)
    onUrlChange(next)
  }, [history, historyIndex, onUrlChange])

  const go = useCallback((delta: number) => {
    const next = historyIndex + delta
    const target = history[next]
    if (!target) return
    setHistoryIndex(next)
    onUrlChange(target)
  }, [history, historyIndex, onUrlChange])

  const controlStyle = useMemo<React.CSSProperties>(() => ({
    display: 'inline-grid',
    placeItems: 'center',
    width: 28,
    height: 28,
    flexShrink: 0,
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: 'var(--surface-2)',
    color: 'var(--text-2)',
    cursor: 'pointer',
  }), [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1, background: 'var(--bg)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 10px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface)',
          flexShrink: 0,
        }}
      >
        <button type="button" style={{ ...controlStyle, opacity: historyIndex > 0 ? 1 : 0.4 }} onClick={() => go(-1)} title="Back" aria-label="Back" disabled={historyIndex <= 0}>
          <ArrowLeft size={14} aria-hidden />
        </button>
        <button type="button" style={{ ...controlStyle, opacity: historyIndex < history.length - 1 ? 1 : 0.4 }} onClick={() => go(1)} title="Forward" aria-label="Forward" disabled={historyIndex >= history.length - 1}>
          <ArrowRight size={14} aria-hidden />
        </button>
        <button type="button" style={{ ...controlStyle, opacity: current ? 1 : 0.4 }} onClick={() => setReloadKey((key) => key + 1)} title="Reload" aria-label="Reload" disabled={!current}>
          <RotateCw size={13} aria-hidden />
        </button>
        <form
          onSubmit={(event) => { event.preventDefault(); navigate(draft) }}
          style={{ display: 'flex', flex: 1, minWidth: 0 }}
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="localhost:3000, a port, or a URL"
            aria-label="Address"
            spellCheck={false}
            style={{
              flex: 1,
              minWidth: 0,
              height: 28,
              padding: '0 10px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--surface-2)',
              color: 'var(--text)',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 12,
              outline: 'none',
            }}
          />
        </form>
        <a
          href={current ?? '#'}
          target="_blank"
          rel="noreferrer"
          title="Open in a new tab"
          aria-label="Open in a new tab"
          style={{ ...controlStyle, opacity: current ? 1 : 0.4, pointerEvents: current ? 'auto' : 'none', textDecoration: 'none' }}
        >
          <ExternalLink size={13} aria-hidden />
        </a>
      </div>

      {current ? (
        <iframe
          key={`${current}#${reloadKey}`}
          src={current}
          title="Browser surface"
          sandbox="allow-scripts allow-forms allow-popups allow-modals"
          style={{ flex: 1, minHeight: 0, width: '100%', border: 0, background: '#fff' }}
        />
      ) : (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 14,
            padding: 24,
            color: 'var(--text-3)',
          }}
        >
          <Globe2 size={26} aria-hidden />
          <div style={{ fontSize: 12, textAlign: 'center', maxWidth: 320, lineHeight: 1.6 }}>
            Point this at the app you are working on. Pages that refuse to be framed
            will stay blank — open those in a new tab instead.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
            {LOCAL_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => navigate(preset)}
                className="av-hover-control"
                style={{
                  height: 26,
                  padding: '0 10px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--surface-2)',
                  color: 'var(--text-2)',
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                {preset.replace('http://', '')}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
