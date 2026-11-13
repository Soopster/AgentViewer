'use client'

// Web entry for Session insights: its own chunk, loaded on first open. The
// same three surfaces as the TUI, over the same derivations — files touched
// from the index's recorded edits, tool timing per turn, and faceted search
// over the session index.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { PLUGIN_API_VERSION, type PluginViewModule } from '@/lib/plugins/types'
import type { WebPluginView, WebPluginViewProps } from '@/components/shell/pluginTypes'
import { timedTurnsFromMessages } from '@/lib/plugins/sessionInsights'
import type { PersistedSearchResult } from '@/lib/session-index/types'
import { fmtDuration } from '@/lib/analytics'
import { relativeTo, touchedTurnsFromProvenance, type TouchedTurn } from '../tui/changed-files/model'
import { DATE_FACETS, EMPTY_FACETS, PROVIDER_FACETS, searchParamsFor, type DateFacetId, type ProviderFacet, type SearchFacets } from '../tui/index-search/model'

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

function Frame({ id, title, subtitle, docked, close, children }: { id: string; title: string; subtitle?: string; docked: boolean; close: () => void; children: ReactNode }) {
  useEffect(() => {
    if (docked) return undefined
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [docked, close])
  const body = (
    <div data-plugin-view={id} style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--surface)', color: 'var(--text)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontWeight: 600 }}>{title}</span>
        <span style={{ flex: 1, minWidth: 0, color: 'var(--text-2)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subtitle}</span>
        {!docked ? <button type="button" aria-label="Close" onClick={close} style={{ fontSize: 12 }}>✕</button> : null}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '10px 14px', fontSize: 13 }}>{children}</div>
    </div>
  )
  if (docked) return body
  return (
    <div role="dialog" aria-label={title} onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)' }}>
      <div onClick={event => event.stopPropagation()} style={{ width: 'min(900px, calc(100vw - 32px))', height: 'min(720px, calc(100vh - 48px))', border: '1px solid var(--border-2)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 16px 48px var(--shadow, rgba(0,0,0,0.3))' }}>{body}</div>
    </div>
  )
}

const Muted = ({ children }: { children: ReactNode }) => <div style={{ color: 'var(--text-2)' }}>{children}</div>

function ChangedFiles({ services, placement, close }: WebPluginViewProps) {
  const session = services.session?.session ?? null
  const insights = services['session-insights']
  const [turns, setTurns] = useState<TouchedTurn[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setTurns(null)
    if (!session || !insights) return undefined
    const controller = new AbortController()
    insights.provenance({ provider: session.provider ?? 'claude', sessionId: session.sessionId }, controller.signal)
      .then(({ summary, edits }) => { if (!controller.signal.aborted) setTurns(touchedTurnsFromProvenance(edits, summary)) })
      .catch(cause => { if (!controller.signal.aborted) setError(message(cause)) })
    return () => controller.abort()
  }, [insights, session?.provider, session?.sessionId])
  const cwd = typeof session?.cwd === 'string' ? session.cwd : undefined
  const fileCount = turns?.reduce((sum, turn) => sum + turn.files.length, 0) ?? 0
  return (
    <Frame id="changed-files" title="Files touched" subtitle={turns ? `${turns.length} turns · ${fileCount} file edits` : undefined} docked={placement !== 'overlay'} close={close}>
      {!session ? <Muted>Select a session.</Muted>
        : error ? <div role="status" style={{ color: 'var(--red, #f85149)' }}>{error}</div>
        : turns === null ? <Muted>Reading the index…</Muted>
        : turns.length === 0 ? <Muted>The index has no edits recorded for this session yet.</Muted>
        : turns.map(turn => (
          <div key={turn.key} data-changed-turn={turn.key} style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 8, fontWeight: 600 }}>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{turn.title}</span>
              <span style={{ color: 'var(--green, #3fb950)', fontWeight: 400 }}>+{turn.added}</span>
            </div>
            {turn.files.map(file => (
              <div key={file.path} data-changed-file={file.path} style={{ display: 'flex', gap: 10, padding: '2px 0 2px 12px', fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{relativeTo(cwd, file.path)}</span>
                <span style={{ color: 'var(--green, #3fb950)' }}>+{file.added}</span>
                <span style={{ color: 'var(--text-2)', minWidth: 56, textAlign: 'right' }} title="lines of this file still attributed to the session">{file.surviving == null ? '' : file.surviving === 0 ? 'gone' : `✓${file.surviving}`}</span>
              </div>
            ))}
          </div>
        ))}
    </Frame>
  )
}

function ToolTiming({ services, placement, close }: WebPluginViewProps) {
  const transcript = services['session-transcript'] ?? null
  const turns = useMemo(() => timedTurnsFromMessages(transcript?.rawMessages ?? []), [transcript?.rawMessages])
  const slowest = turns.reduce((max, turn) => Math.max(max, turn.maxMs), 0)
  return (
    <Frame id="tool-timing" title="Tool timing" subtitle={turns.length ? `${turns.length} turns · slowest call ${fmtDuration(slowest)}` : undefined} docked={placement !== 'overlay'} close={close}>
      {!transcript ? <Muted>Select a session.</Muted>
        : turns.length === 0 ? <Muted>No timed tool calls in this session.</Muted>
        : turns.map(turn => (
          <div key={turn.key} data-timing-turn={turn.key} style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 8, fontWeight: 600 }}>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{turn.title}</span>
              <span style={{ color: 'var(--text-2)', fontWeight: 400 }}>{fmtDuration(turn.totalMs)}</span>
            </div>
            {turn.calls.map((call, index) => (
              <div key={index} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 160px 64px', gap: 10, alignItems: 'center', padding: '2px 0 2px 12px', fontSize: 12 }}>
                <span style={{ fontFamily: 'var(--font-mono, monospace)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{call.label}</span>
                <span style={{ height: 6, borderRadius: 3, background: 'var(--surface-3)', overflow: 'hidden' }}>
                  <span style={{ display: 'block', height: '100%', width: `${Math.max(2, (call.durationMs / Math.max(slowest, 1)) * 100)}%`, background: call.durationMs >= 10_000 ? 'var(--amber, #d29922)' : 'var(--cyan, #39c5cf)' }} />
                </span>
                <span style={{ textAlign: 'right', color: 'var(--text-2)' }}>{fmtDuration(call.durationMs)}</span>
              </div>
            ))}
          </div>
        ))}
    </Frame>
  )
}

function IndexSearch({ services, placement, close }: WebPluginViewProps) {
  const insights = services['session-insights']!
  const navigation = services['session-navigation']
  const [facets, setFacets] = useState<SearchFacets>(EMPTY_FACETS)
  const [results, setResults] = useState<PersistedSearchResult[]>([])
  const [status, setStatus] = useState<'idle' | 'searching' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  useEffect(() => {
    const params = searchParamsFor(facets, Date.now())
    const mine = ++generation.current
    if (!params) { setResults([]); setStatus('idle'); return undefined }
    setStatus('searching')
    const controller = new AbortController()
    // Debounced; only the newest answer is kept.
    const timer = window.setTimeout(() => {
      insights.search(params, controller.signal)
        .then(response => { if (mine === generation.current) { setResults(response.results); setStatus('idle') } })
        .catch(cause => { if (mine === generation.current && !controller.signal.aborted) { setError(message(cause)); setStatus('error') } })
    }, 200)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [insights, facets])
  const open = (result: PersistedSearchResult) => {
    if (!navigation) return
    const record = result.session
    const prefix = record.key.slice(0, Math.max(record.key.length - record.sessionId.length - 1, 0))
    navigation.open({ provider: record.provider, sessionId: record.sessionId, ...(prefix && prefix !== record.provider ? { providerInstanceId: prefix } : {}) }, result.matches[0]?.uuid)
    if (placement === 'overlay') close()
  }
  const field = { fontSize: 13, padding: '4px 8px', background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6 }
  return (
    <Frame id="index-search" title="Search the session index" subtitle={status === 'searching' ? 'searching…' : facets.query.trim() ? `${results.length} sessions` : undefined} docked={placement !== 'overlay'} close={close}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <input autoFocus aria-label="Search" placeholder="Search prompts, replies, tool output…" value={facets.query} onChange={event => setFacets({ ...facets, query: event.target.value })} style={{ ...field, flex: 1, minWidth: 220 }} />
        <select aria-label="Provider" value={facets.provider} onChange={event => setFacets({ ...facets, provider: event.target.value as ProviderFacet })} style={field}>
          {PROVIDER_FACETS.map(provider => <option key={provider} value={provider}>{provider === 'all' ? 'all providers' : provider}</option>)}
        </select>
        <select aria-label="When" value={facets.date} onChange={event => setFacets({ ...facets, date: event.target.value as DateFacetId })} style={field}>
          {DATE_FACETS.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}><input type="checkbox" checked={facets.hasError} onChange={event => setFacets({ ...facets, hasError: event.target.checked })} />with errors</label>
        <input aria-label="Touched file" placeholder="touched file…" value={facets.touchedFile} onChange={event => setFacets({ ...facets, touchedFile: event.target.value })} style={{ ...field, width: 160 }} />
      </div>
      {status === 'error' ? <div role="status" style={{ color: 'var(--red, #f85149)' }}>{error}</div>
        : !facets.query.trim() ? <Muted>Type to search every indexed session.</Muted>
        : results.length === 0 && status === 'idle' ? <Muted>No session matches.</Muted>
        : results.map(result => (
          <button key={result.session.key} type="button" data-search-result={result.session.sessionId} disabled={!navigation} onClick={() => open(result)}
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px', border: 'none', borderBottom: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', cursor: navigation ? 'pointer' : 'default' }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <span style={{ flex: 1, minWidth: 0, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{result.session.customTitle || result.session.title || result.session.firstPrompt || result.session.sessionId}</span>
              <span style={{ fontSize: 11, color: 'var(--text-2)' }}>{result.session.provider}{result.session.cwd ? ` · ${result.session.cwd.split('/').filter(Boolean).pop()}` : ''}</span>
            </div>
            {result.matches[0] ? <div style={{ fontSize: 12, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{result.matches[0].snippet}</div> : null}
          </button>
        ))}
    </Frame>
  )
}

export const module: PluginViewModule<WebPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'session-insights',
  views: { 'changed-files': ChangedFiles, 'tool-timing': ToolTiming, 'index-search': IndexSearch },
}
