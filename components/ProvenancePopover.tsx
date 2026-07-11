'use client'

// Code provenance — "git blame for agents". Two linked views over the
// file_edits index (lib/provenance.ts):
// - Session view: every file the session wrote and how many of its current
//   lines still trace back to that session.
// - Blame view: one file's lines grouped into segments by the (session, turn)
//   that wrote them, with the prompt, model, and git commit alongside — each
//   segment jumps straight into the transcript at that turn.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ExternalLink, FileSearch, GitCommitHorizontal, RefreshCw, X } from 'lucide-react'
import type { AgentProvider } from '@/lib/types'
import type { ProvenanceBlameResult, ProvenanceSegment, SessionProvenanceResult } from '@/lib/provenance'

type Props = {
  open: boolean
  onClose: () => void
  /** Session whose written files show in the default view (blame-only when absent). */
  session?: { sessionId: string; provider?: AgentProvider } | null
  /** Base dir for resolving relative file input in the blame view. */
  cwd?: string | null
  onOpenSession: (target: { sessionId: string; provider: AgentProvider; uuid: string }) => void
}

const PROVIDER_META: Record<AgentProvider, { label: string; color: string }> = {
  claude: { label: 'Claude', color: '#d97757' },
  codex: { label: 'Codex', color: '#10a37f' },
  opencode: { label: 'OpenCode', color: '#f59e0b' },
  copilot: { label: 'Copilot', color: '#8b5cf6' },
  pi: { label: 'Pi', color: '#ec4899' },
}

// Distinguishes sessions within the same provider in the blame gutter.
const SESSION_PALETTE = ['var(--cyan)', 'var(--violet)', 'var(--green)', 'var(--amber, #fbbf24)', '#ec4899', '#f87171', '#38bdf8', '#a3e635']

const MONO = "'IBM Plex Mono', monospace"
const SANS = "'IBM Plex Sans', sans-serif"
const DISPLAY = "'Oxanium', sans-serif"
const SEGMENT_PREVIEW_LINES = 12

function timeAgo(value: number | null | undefined): string {
  if (value == null) return ''
  const ms = Date.now() - value
  if (ms < 60_000) return 'just now'
  const m = Math.floor(ms / 60_000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function shortModel(model: string | null): string | null {
  if (!model) return null
  return model.replace(/^claude-/, '').replace(/-\d{8}$/, '')
}

type GapInfo = {
  start: number
  end: number
  commitLabel: string | null
}

type BlameRow =
  | { kind: 'segment'; segment: ProvenanceSegment }
  | { kind: 'gap'; gap: GapInfo }

/** Interleave attributed segments with collapsed unattributed gaps. */
function buildBlameRows(blame: ProvenanceBlameResult): BlameRow[] {
  const rows: BlameRow[] = []
  let cursor = 0
  const pushGap = (start: number, end: number) => {
    if (end < start) return
    // Dominant commit over the gap, for "who did write this then" context.
    const coverage = new Map<string, { lines: number; label: string }>()
    for (const commit of blame.commitSegments) {
      const overlapStart = Math.max(commit.start, start)
      const overlapEnd = Math.min(commit.end, end)
      if (overlapEnd < overlapStart) continue
      const key = commit.sha
      const lines = overlapEnd - overlapStart + 1
      const existing = coverage.get(key)
      if (existing) existing.lines += lines
      else coverage.set(key, { lines, label: `${commit.author}${commit.summary ? ` — ${commit.summary}` : ''}` })
    }
    const dominant = [...coverage.values()].sort((a, b) => b.lines - a.lines)[0] ?? null
    rows.push({ kind: 'gap', gap: { start, end, commitLabel: dominant?.label ?? null } })
  }
  for (const segment of blame.segments) {
    pushGap(cursor, segment.start - 1)
    rows.push({ kind: 'segment', segment })
    cursor = segment.end + 1
  }
  pushGap(cursor, blame.totalLines - 1)
  return rows
}

function commitForRange(blame: ProvenanceBlameResult, start: number, end: number): string | null {
  const coverage = new Map<string, { lines: number; label: string }>()
  for (const commit of blame.commitSegments) {
    const overlapStart = Math.max(commit.start, start)
    const overlapEnd = Math.min(commit.end, end)
    if (overlapEnd < overlapStart) continue
    const lines = overlapEnd - overlapStart + 1
    const existing = coverage.get(commit.sha)
    if (existing) existing.lines += lines
    else coverage.set(commit.sha, { lines, label: `${commit.sha.slice(0, 7)} ${commit.summary}`.trim() })
  }
  return [...coverage.values()].sort((a, b) => b.lines - a.lines)[0]?.label ?? null
}

export default function ProvenancePopover({ open, onClose, session, cwd, onOpenSession }: Props) {
  const [view, setView] = useState<'session' | 'blame'>('session')
  const [sessionData, setSessionData] = useState<SessionProvenanceResult | null>(null)
  const [blameData, setBlameData] = useState<ProvenanceBlameResult | null>(null)
  const [fileInput, setFileInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedSegments, setExpandedSegments] = useState<Set<number>>(new Set())

  const loadSession = useCallback(() => {
    if (!session?.sessionId) return
    setLoading(true)
    setError(null)
    const provider = session.provider ?? 'claude'
    fetch(`/api/sessions/${encodeURIComponent(session.sessionId)}/provenance?provider=${provider}`)
      .then((r) => r.json())
      .then((data) => {
        if (data?.error) setError(String(data.error))
        else setSessionData(data as SessionProvenanceResult)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load provenance'))
      .finally(() => setLoading(false))
  }, [session?.sessionId, session?.provider])

  const loadBlame = useCallback((file: string) => {
    const trimmed = file.trim()
    if (!trimmed) return
    setLoading(true)
    setError(null)
    setView('blame')
    setExpandedSegments(new Set())
    const params = new URLSearchParams({ file: trimmed })
    if (cwd) params.set('cwd', cwd)
    fetch(`/api/provenance/blame?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        if (data?.error) {
          setError(String(data.error))
          setBlameData(null)
        } else {
          setBlameData(data as ProvenanceBlameResult)
          setFileInput(trimmed)
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load blame'))
      .finally(() => setLoading(false))
  }, [cwd])

  useEffect(() => {
    if (!open) return
    setError(null)
    setBlameData(null)
    setExpandedSegments(new Set())
    if (session?.sessionId) {
      setView('session')
      setSessionData(null)
      loadSession()
    } else {
      setView('blame')
    }
  }, [open, session?.sessionId, loadSession])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  const sessionColors = useMemo(() => {
    const colors = new Map<string, string>()
    if (!blameData) return colors
    for (const segment of blameData.segments) {
      if (!colors.has(segment.edit.sessionKey)) {
        colors.set(segment.edit.sessionKey, SESSION_PALETTE[colors.size % SESSION_PALETTE.length])
      }
    }
    return colors
  }, [blameData])

  const blameRows = useMemo(() => (blameData ? buildBlameRows(blameData) : []), [blameData])

  const handleOpenTurn = useCallback((segment: ProvenanceSegment) => {
    onOpenSession({
      sessionId: segment.edit.sessionId,
      provider: segment.edit.provider,
      uuid: segment.edit.messageUuid,
    })
    onClose()
  }, [onOpenSession, onClose])

  if (!open) return null

  const showBack = view === 'blame' && Boolean(session?.sessionId)

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '48px 8px 8px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(880px, calc(100vw - 16px))',
          maxHeight: 'calc(100vh - 64px)',
          background: 'var(--surface)',
          border: '1px solid var(--border-2)',
          borderRadius: 12,
          boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '14px 16px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface-2)',
            flexShrink: 0,
          }}
        >
          {showBack ? (
            <button
              type="button"
              onClick={() => { setView('session'); setError(null) }}
              title="Back to session files"
              style={iconButtonStyle}
            >
              <ArrowLeft size={15} />
            </button>
          ) : (
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 9,
                display: 'grid',
                placeItems: 'center',
                background: 'color-mix(in srgb, var(--cyan) 18%, var(--surface-3))',
                color: 'var(--cyan)',
                border: '1px solid color-mix(in srgb, var(--cyan) 34%, var(--border))',
                flexShrink: 0,
              }}
            >
              <FileSearch size={18} />
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: DISPLAY, fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>
              Code provenance
            </div>
            <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {view === 'blame' && blameData
                ? `${blameData.relPath ?? blameData.file} · ${blameData.attributedLines}/${blameData.totalLines} lines from agent turns · ${blameData.editsConsidered} edits indexed`
                : 'Which conversation wrote this code — agent blame over the session index'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => (view === 'session' ? loadSession() : blameData && loadBlame(blameData.file))}
            title="Refresh"
            style={iconButtonStyle}
          >
            <RefreshCw size={15} className={loading ? 'av-spin' : undefined} />
          </button>
          <button type="button" onClick={onClose} title="Close" style={iconButtonStyle}>
            <X size={16} />
          </button>
        </div>

        {view === 'blame' && (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              loadBlame(fileInput)
            }}
            style={{ display: 'flex', gap: 8, padding: '10px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}
          >
            <input
              value={fileInput}
              onChange={(event) => setFileInput(event.target.value)}
              placeholder={cwd ? `File path (absolute, or relative to ${cwd})` : 'Absolute file path'}
              spellCheck={false}
              style={{
                flex: 1,
                fontFamily: MONO,
                fontSize: 12,
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--surface-2)',
                color: 'var(--text)',
                outline: 'none',
              }}
            />
            <button
              type="submit"
              style={{
                fontFamily: SANS,
                fontSize: 12,
                fontWeight: 600,
                padding: '8px 14px',
                borderRadius: 8,
                border: '1px solid color-mix(in srgb, var(--cyan) 40%, var(--border))',
                background: 'color-mix(in srgb, var(--cyan) 14%, var(--surface-3))',
                color: 'var(--cyan)',
                cursor: 'pointer',
              }}
            >
              Blame
            </button>
          </form>
        )}

        <div style={{ overflowY: 'auto', padding: 10 }}>
          {error && (
            <div style={{ padding: '12px 14px', color: 'var(--red, #f87171)', fontFamily: MONO, fontSize: 12 }}>
              {error}
            </div>
          )}

          {view === 'session' && !error && (
            <SessionFilesView
              data={sessionData}
              loading={loading}
              onBlameFile={(path) => loadBlame(path)}
            />
          )}

          {view === 'blame' && !error && !blameData && !loading && (
            <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-3)' }}>
              <FileSearch size={28} style={{ opacity: 0.5, marginBottom: 10 }} />
              <div style={{ fontFamily: SANS, fontSize: 14, color: 'var(--text-2)' }}>
                Enter a file path to see which agent sessions wrote its lines.
              </div>
            </div>
          )}

          {view === 'blame' && !error && blameData && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {blameData.truncated && (
                <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--amber, #fbbf24)', padding: '4px 6px' }}>
                  File truncated to the first {blameData.totalLines.toLocaleString()} lines.
                </div>
              )}
              {blameRows.map((row, index) => {
                if (row.kind === 'gap') {
                  const { gap } = row
                  return (
                    <div
                      key={`gap-${gap.start}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '5px 12px',
                        fontFamily: MONO,
                        fontSize: 11,
                        color: 'var(--text-3)',
                      }}
                    >
                      <span style={{ flexShrink: 0 }}>
                        L{gap.start + 1}–{gap.end + 1}
                      </span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {gap.end - gap.start + 1} lines not from indexed agent edits
                        {gap.commitLabel ? ` · git: ${gap.commitLabel}` : ''}
                      </span>
                    </div>
                  )
                }
                const { segment } = row
                const color = sessionColors.get(segment.edit.sessionKey) ?? 'var(--cyan)'
                const provider = PROVIDER_META[segment.edit.provider] ?? { label: segment.edit.provider, color: 'var(--cyan)' }
                const lineCount = segment.end - segment.start + 1
                const expanded = expandedSegments.has(index)
                const visibleLines = expanded ? lineCount : Math.min(lineCount, SEGMENT_PREVIEW_LINES)
                const commitLabel = commitForRange(blameData, segment.start, segment.end)
                const model = shortModel(segment.edit.model)
                return (
                  <div
                    key={`seg-${segment.start}-${segment.edit.id}`}
                    style={{
                      borderRadius: 10,
                      border: `1px solid color-mix(in srgb, ${color} 30%, var(--border))`,
                      background: `color-mix(in srgb, ${color} 4%, var(--surface-2))`,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '8px 12px',
                        borderBottom: '1px solid color-mix(in srgb, ' + color + ' 18%, var(--border))',
                        flexWrap: 'wrap',
                      }}
                    >
                      <span
                        style={{
                          fontSize: 10,
                          fontFamily: MONO,
                          padding: '2px 7px',
                          borderRadius: 999,
                          color: provider.color,
                          background: `color-mix(in srgb, ${provider.color} 14%, transparent)`,
                          border: `1px solid color-mix(in srgb, ${provider.color} 34%, transparent)`,
                          flexShrink: 0,
                        }}
                      >
                        {provider.label}
                      </span>
                      <span
                        style={{
                          fontFamily: SANS,
                          fontSize: 12.5,
                          fontWeight: 600,
                          color: 'var(--text)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          flex: 1,
                          minWidth: 120,
                        }}
                        title={segment.edit.sessionTitle ?? segment.edit.sessionId}
                      >
                        {segment.edit.sessionTitle || segment.edit.sessionId}
                      </span>
                      <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--text-3)', flexShrink: 0 }}>
                        L{segment.start + 1}–{segment.end + 1} · {segment.edit.tool}
                        {model ? ` · ${model}` : ''}
                        {segment.edit.timestampMs ? ` · ${timeAgo(segment.edit.timestampMs)}` : ''}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleOpenTurn(segment)}
                        title="Open this turn in the transcript"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                          fontFamily: SANS,
                          fontSize: 11,
                          fontWeight: 600,
                          padding: '4px 10px',
                          borderRadius: 7,
                          border: `1px solid color-mix(in srgb, ${color} 40%, var(--border))`,
                          background: `color-mix(in srgb, ${color} 14%, var(--surface-3))`,
                          color,
                          cursor: 'pointer',
                          flexShrink: 0,
                        }}
                      >
                        <ExternalLink size={11} />
                        Open turn
                      </button>
                    </div>
                    {segment.edit.prompt && (
                      <div
                        style={{
                          fontFamily: SANS,
                          fontSize: 11.5,
                          color: 'var(--text-2)',
                          padding: '6px 12px',
                          borderBottom: `1px solid color-mix(in srgb, ${color} 12%, var(--border))`,
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                        title={segment.edit.prompt}
                      >
                        <span style={{ color: 'var(--text-3)', fontFamily: MONO, fontSize: 10 }}>PROMPT </span>
                        {segment.edit.prompt}
                      </div>
                    )}
                    <pre
                      style={{
                        margin: 0,
                        padding: '8px 0',
                        fontFamily: MONO,
                        fontSize: 11.5,
                        lineHeight: 1.5,
                        overflowX: 'auto',
                        background: 'var(--surface)',
                      }}
                    >
                      {blameData.lines.slice(segment.start, segment.start + visibleLines).map((line, offset) => (
                        <div key={segment.start + offset} style={{ display: 'flex', whiteSpace: 'pre' }}>
                          <span
                            style={{
                              flexShrink: 0,
                              width: 52,
                              textAlign: 'right',
                              paddingRight: 10,
                              color: 'var(--text-3)',
                              userSelect: 'none',
                              borderRight: `2px solid ${color}`,
                              marginRight: 10,
                            }}
                          >
                            {segment.start + offset + 1}
                          </span>
                          <span style={{ color: 'var(--text-2)' }}>{line || ' '}</span>
                        </div>
                      ))}
                    </pre>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '5px 12px',
                        borderTop: `1px solid color-mix(in srgb, ${color} 12%, var(--border))`,
                      }}
                    >
                      {lineCount > SEGMENT_PREVIEW_LINES && (
                        <button
                          type="button"
                          onClick={() => setExpandedSegments((prev) => {
                            const next = new Set(prev)
                            if (next.has(index)) next.delete(index)
                            else next.add(index)
                            return next
                          })}
                          style={{
                            fontFamily: MONO,
                            fontSize: 10.5,
                            color: 'var(--text-2)',
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            padding: 0,
                          }}
                        >
                          {expanded ? 'Collapse' : `Show all ${lineCount} lines`}
                        </button>
                      )}
                      {commitLabel && (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                            fontFamily: MONO,
                            fontSize: 10.5,
                            color: 'var(--text-3)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={commitLabel}
                        >
                          <GitCommitHorizontal size={12} />
                          {commitLabel}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SessionFilesView({
  data,
  loading,
  onBlameFile,
}: {
  data: SessionProvenanceResult | null
  loading: boolean
  onBlameFile: (path: string) => void
}) {
  if (!data) {
    return (
      <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-3)', fontFamily: SANS, fontSize: 14 }}>
        {loading ? 'Scanning session edits…' : 'No provenance data.'}
      </div>
    )
  }
  if (data.files.length === 0) {
    return (
      <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-3)' }}>
        <FileSearch size={28} style={{ opacity: 0.5, marginBottom: 10 }} />
        <div style={{ fontFamily: SANS, fontSize: 14, color: 'var(--text-2)' }}>
          No file edits recorded for this session yet.
        </div>
        <div style={{ fontFamily: MONO, fontSize: 11, marginTop: 6 }}>
          The index fills in as sessions are opened or via search index rebuild.
        </div>
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {data.filesTruncated && (
        <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--amber, #fbbf24)', padding: '4px 8px' }}>
          Showing the first {data.files.length} files.
        </div>
      )}
      {data.files.map((file) => {
        const surviving = file.linesSurviving
        const total = file.totalFileLines
        const share = surviving != null && total ? Math.min(surviving / Math.max(total, 1), 1) : 0
        return (
          <div
            key={file.filePath}
            onClick={() => file.exists && file.resolvedPath && onBlameFile(file.resolvedPath)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '9px 12px',
              borderRadius: 8,
              cursor: file.exists ? 'pointer' : 'default',
              opacity: file.exists ? 1 : 0.55,
            }}
            className={file.exists ? 'av-bookmark-row' : undefined}
            title={file.exists ? 'Open agent blame for this file' : 'File no longer exists at its recorded path'}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: MONO, fontSize: 12.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {file.filePath}
              </div>
              <div style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--text-3)', marginTop: 2 }}>
                {file.edits} {file.edits === 1 ? 'edit' : 'edits'} · {file.tools.join(', ')}
                {file.lastEditAt ? ` · ${timeAgo(file.lastEditAt)}` : ''}
                {!file.exists ? ' · missing' : ''}
              </div>
            </div>
            {file.exists && surviving != null && total != null && (
              <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 90, height: 5, borderRadius: 999, background: 'var(--surface-3)', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.round(share * 100)}%`, height: '100%', background: 'var(--cyan)' }} />
                </div>
                <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-2)', minWidth: 88, textAlign: 'right' }}>
                  {surviving}/{total} lines live
                </span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

const iconButtonStyle = {
  display: 'grid',
  placeItems: 'center',
  width: 30,
  height: 30,
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--surface-3)',
  color: 'var(--text-2)',
  cursor: 'pointer',
  flexShrink: 0,
} as const
