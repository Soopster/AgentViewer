'use client'

import dynamic from 'next/dynamic'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowRight, Check, FileCode2, GitBranch, RefreshCw, Terminal } from 'lucide-react'
import type { GitReviewData, GitReviewFile } from '@/lib/gitProvider'
import type { Session } from '@/lib/types'
import type { ThreadedMessage, ToolThread } from '@/lib/threading'
import type { DiffOptions } from './MessageItem'
import type { PierreDiffStyle } from './PierreDiffView'
import { cn } from '@/lib/utils'

const PierrePatchDiffView = dynamic(() => import('./PierreDiffView').then((mod) => mod.PierrePatchDiffView), {
  ssr: false,
  loading: () => (
    <pre style={{ margin: 0, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)', padding: 12 }}>
      Loading diff…
    </pre>
  ),
})

type ReviewEvidenceKind = 'edit' | 'command' | 'test' | 'error'

type ReviewEvidence = {
  id: string
  kind: ReviewEvidenceKind
  messageId: string
  path?: string
  label: string
  detail: string
  timestamp?: string
}

type ReviewAnalysis = {
  editsByPath: Map<string, ReviewEvidence[]>
  commands: ReviewEvidence[]
  tests: ReviewEvidence[]
  errors: ReviewEvidence[]
}

type Props = {
  session: Session
  messages: ThreadedMessage[]
  diffStyle: PierreDiffStyle
  diffOptions: DiffOptions
  onJumpToMessage: (messageId: string) => void
  onClose: () => void
}

const TEST_COMMAND_RE = /\b(npm|pnpm|bun|yarn)\s+(run\s+)?(test|build|lint|typecheck|tui:check)\b|\bnpx\s+tsc\b|\btsc\s+--noEmit\b|\bgo\s+test\b|\bcargo\s+test\b|\bpytest\b|\bvitest\b|\bjest\b/i

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function basename(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path
}

function compactNumber(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k` : String(value)
}

function evidenceTone(kind: ReviewEvidenceKind): string {
  if (kind === 'error') return 'var(--red)'
  if (kind === 'test') return 'var(--green)'
  if (kind === 'edit') return 'var(--cyan)'
  return 'var(--text-3)'
}

function collectToolEvidence(message: ThreadedMessage, thread: ToolThread, index: number): ReviewEvidence[] {
  const { toolUse, result } = thread
  const input = toolUse.input ?? {}
  const idBase = `${message.uuid}:${toolUse.id || index}`
  const out: ReviewEvidence[] = []

  const pushEdit = (path: string, label: string, detail: string) => {
    if (!path) return
    out.push({ id: `${idBase}:edit:${out.length}`, kind: 'edit', messageId: message.uuid, path, label, detail, timestamp: message.timestamp })
  }

  if (toolUse.name === 'Edit') {
    pushEdit(textValue(input.file_path), 'Edit', textValue(input.old_string) || textValue(input.new_string) ? 'single replacement' : 'file edit')
  } else if (toolUse.name === 'MultiEdit') {
    pushEdit(textValue(input.file_path), 'MultiEdit', `${arrayValue(input.edits).length} edit${arrayValue(input.edits).length === 1 ? '' : 's'}`)
  } else if (toolUse.name === 'Write') {
    const content = textValue(input.content)
    pushEdit(textValue(input.file_path), 'Write', content ? `${content.split('\n').length} line${content.split('\n').length === 1 ? '' : 's'}` : 'file write')
  } else if (toolUse.name === 'FileChange') {
    for (const change of arrayValue(input.changes)) {
      if (!change || typeof change !== 'object') continue
      const record = change as { path?: unknown; kind?: unknown; diff?: unknown }
      pushEdit(textValue(record.path), 'FileChange', textValue(record.kind) || (textValue(record.diff) ? 'diff updated' : 'file change'))
    }
  } else if (toolUse.name === 'Bash') {
    const command = textValue(input.command)
    if (command) {
      out.push({
        id: `${idBase}:command`,
        kind: TEST_COMMAND_RE.test(command) ? 'test' : 'command',
        messageId: message.uuid,
        label: TEST_COMMAND_RE.test(command) ? 'Verification' : 'Command',
        detail: command,
        timestamp: message.timestamp,
      })
    }
  }

  if (result?.is_error) {
    out.push({
      id: `${idBase}:error`,
      kind: 'error',
      messageId: message.uuid,
      path: out.find((item) => item.path)?.path,
      label: `${toolUse.name} failed`,
      detail: typeof result.content === 'string' ? result.content.slice(0, 220) : 'tool error',
      timestamp: message.timestamp,
    })
  }

  return out
}

function analyzeMessages(messages: ThreadedMessage[]): ReviewAnalysis {
  const editsByPath = new Map<string, ReviewEvidence[]>()
  const commands: ReviewEvidence[] = []
  const tests: ReviewEvidence[] = []
  const errors: ReviewEvidence[] = []

  messages.forEach((message) => {
    message.blocks.forEach((block, index) => {
      if (block.type !== 'tool_thread') return
      for (const evidence of collectToolEvidence(message, block, index)) {
        if (evidence.path) {
          const bucket = editsByPath.get(evidence.path) ?? []
          bucket.push(evidence)
          editsByPath.set(evidence.path, bucket)
        }
        if (evidence.kind === 'command') commands.push(evidence)
        if (evidence.kind === 'test') tests.push(evidence)
        if (evidence.kind === 'error') errors.push(evidence)
      }
    })
  })

  return { editsByPath, commands, tests, errors }
}

async function fetchReview(cwd: string): Promise<GitReviewData> {
  const res = await fetch('/api/git', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd, action: 'review' }),
  })
  const body = await res.json() as { review?: GitReviewData; error?: string }
  if (!res.ok || !body.review) throw new Error(body.error ?? 'Failed to load review')
  return body.review
}

function statusColor(file: GitReviewFile): string {
  if (file.status === 'conflict') return 'var(--red)'
  if (file.untracked || file.status === 'added') return 'var(--green)'
  if (file.status === 'deleted') return 'var(--red)'
  if (file.status === 'renamed') return 'var(--violet)'
  return 'var(--cyan)'
}

function healthChecks(review: GitReviewData | null, analysis: ReviewAnalysis) {
  if (!review) return []
  return [
    {
      key: 'files',
      ok: review.files.length > 0,
      label: review.files.length > 0 ? `${review.files.length} changed` : 'clean',
    },
    {
      key: 'tests',
      ok: analysis.tests.length > 0 || review.files.length === 0,
      label: analysis.tests.length > 0 ? `${analysis.tests.length} verification` : 'no verification',
    },
    {
      key: 'errors',
      ok: analysis.errors.length === 0,
      label: analysis.errors.length === 0 ? 'no tool errors' : `${analysis.errors.length} tool errors`,
    },
  ]
}

function remotePushStatus(review: GitReviewData): { label: string; tone: string } {
  if (!review.upstream) return { label: 'no upstream', tone: 'var(--amber)' }
  if (review.ahead > 0 && review.behind > 0) return { label: `diverged ↑${review.ahead} ↓${review.behind}`, tone: 'var(--amber)' }
  if (review.ahead > 0) return { label: `unpushed ↑${review.ahead}`, tone: 'var(--amber)' }
  if (review.behind > 0) return { label: `behind ↓${review.behind}`, tone: 'var(--red)' }
  return { label: 'pushed', tone: 'var(--green)' }
}

const EvidenceList = memo(function EvidenceList({
  title,
  items,
  empty,
  onJumpToMessage,
}: {
  title: string
  items: ReviewEvidence[]
  empty: string
  onJumpToMessage: (messageId: string) => void
}) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        {title}
      </div>
      {items.length === 0 ? (
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: 'var(--text-3)', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)' }}>
          {empty}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.slice(0, 12).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onJumpToMessage(item.messageId)}
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr auto',
                alignItems: 'center',
                gap: 10,
                textAlign: 'left',
                padding: '9px 10px',
                border: '1px solid var(--border)',
                borderRadius: 6,
                background: 'var(--surface)',
                color: 'var(--text)',
                cursor: 'pointer',
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: 999, background: evidenceTone(item.kind), boxShadow: `0 0 14px ${evidenceTone(item.kind)}` }} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: evidenceTone(item.kind), letterSpacing: '0.04em' }}>
                  {item.label}
                </span>
                <span style={{ display: 'block', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.detail}
                </span>
              </span>
              <ArrowRight size={14} style={{ color: 'var(--text-3)' }} />
            </button>
          ))}
        </div>
      )}
    </section>
  )
})

export default function DiffReviewMode({ session, messages, diffStyle, diffOptions, onJumpToMessage, onClose }: Props) {
  const [review, setReview] = useState<GitReviewData | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadReview = useCallback(async () => {
    if (!session.cwd) return
    setLoading(true)
    setError(null)
    try {
      const next = await fetchReview(session.cwd)
      setReview(next)
      setSelectedPath((current) => current && next.files.some((file) => file.path === current) ? current : next.files[0]?.path ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load review')
    } finally {
      setLoading(false)
    }
  }, [session.cwd])

  useEffect(() => {
    void loadReview()
  }, [loadReview])

  const analysis = useMemo(() => analyzeMessages(messages), [messages])
  const selectedFile = review?.files.find((file) => file.path === selectedPath) ?? review?.files[0] ?? null
  const selectedEvidence = selectedFile ? analysis.editsByPath.get(selectedFile.path) ?? [] : []
  const checks = useMemo(() => healthChecks(review, analysis), [analysis, review])
  const totals = useMemo(() => {
    if (!review) return { additions: 0, deletions: 0, staged: 0, unstaged: 0, untracked: 0 }
    return review.files.reduce((acc, file) => {
      acc.additions += file.additions
      acc.deletions += file.deletions
      if (file.staged) acc.staged += 1
      if (file.unstaged) acc.unstaged += 1
      if (file.untracked) acc.untracked += 1
      return acc
    }, { additions: 0, deletions: 0, staged: 0, unstaged: 0, untracked: 0 })
  }, [review])
  const pushStatus = review ? remotePushStatus(review) : null
  const repoFacts = review ? [
    { label: 'branch', value: review.branch, tone: 'var(--cyan)' },
    { label: 'dirty files', value: String(review.status.length), tone: review.status.length > 0 ? 'var(--amber)' : 'var(--green)' },
    { label: 'untracked', value: String(totals.untracked), tone: totals.untracked > 0 ? 'var(--green)' : 'var(--text-3)' },
    { label: 'commits created', value: review.upstream ? String(review.ahead) : 'unknown', tone: review.ahead > 0 ? 'var(--amber)' : 'var(--text-3)' },
    { label: 'test status', value: analysis.tests.length > 0 ? 'seen' : 'not seen', tone: analysis.tests.length > 0 ? 'var(--green)' : 'var(--amber)' },
    { label: 'remote', value: pushStatus?.label ?? 'unknown', tone: pushStatus?.tone ?? 'var(--text-3)' },
  ] : []

  if (!session.cwd) {
    return (
      <div style={{ flex: 1, minHeight: 0, display: 'grid', placeItems: 'center', padding: 32, color: 'var(--text-3)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>
        No workspace path for this session.
      </div>
    )
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 14, padding: '22px 28px 28px', overflow: 'hidden' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <div style={{ width: 34, height: 34, borderRadius: 7, border: '1px solid color-mix(in srgb, var(--cyan) 35%, var(--border))', display: 'grid', placeItems: 'center', background: 'color-mix(in srgb, var(--cyan) 9%, var(--surface))', color: 'var(--cyan)' }}>
            <FileCode2 size={18} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: "'Oxanium', monospace", fontSize: 16, fontWeight: 650, color: 'var(--text)', letterSpacing: '0.02em' }}>
              Diff Review
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)' }}>
              <GitBranch size={12} />
              <span style={{ color: 'var(--text-2)' }}>{review?.branch ?? 'HEAD'}</span>
              {review?.upstream && <span>↑{review.ahead} ↓{review.behind}</span>}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.cwd}</span>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" onClick={loadReview} disabled={loading} title="Refresh review" style={{ height: 30, width: 30, display: 'grid', placeItems: 'center', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', color: 'var(--text-2)', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}>
            <RefreshCw size={15} className={loading ? 'av-spin' : undefined} />
          </button>
          <button type="button" onClick={onClose} style={{ height: 30, padding: '0 11px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', color: 'var(--text-2)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: '0.06em', cursor: 'pointer' }}>
            TRANSCRIPT
          </button>
        </div>
      </header>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {checks.map((check) => (
          <span key={check.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 24, padding: '0 9px', borderRadius: 999, border: `1px solid color-mix(in srgb, ${check.ok ? 'var(--green)' : 'var(--amber)'} 30%, var(--border))`, color: check.ok ? 'var(--green)' : 'var(--amber)', background: `color-mix(in srgb, ${check.ok ? 'var(--green)' : 'var(--amber)'} 8%, var(--surface))`, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.05em' }}>
            {check.ok ? <Check size={12} /> : <AlertTriangle size={12} />}
            {check.label}
          </span>
        ))}
        {review && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 24, padding: '0 9px', borderRadius: 999, border: '1px solid var(--border)', color: 'var(--text-2)', background: 'var(--surface)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.05em' }}>
            +{compactNumber(totals.additions)} -{compactNumber(totals.deletions)} · {totals.staged} staged · {totals.unstaged} unstaged · {totals.untracked} new
          </span>
        )}
      </div>

      {review && (
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
          {repoFacts.map((fact) => (
            <div key={fact.label} style={{ minWidth: 0, padding: '9px 10px', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--surface-2)' }}>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: 'var(--text-3)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
                {fact.label}
              </div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: fact.tone, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={fact.value}>
                {fact.value}
              </div>
            </div>
          ))}
        </section>
      )}

      {error && (
        <div style={{ border: '1px solid color-mix(in srgb, var(--red) 35%, var(--border))', borderRadius: 7, padding: '10px 12px', color: 'var(--red)', background: 'color-mix(in srgb, var(--red) 8%, var(--surface))', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>
          {error}
        </div>
      )}

      <div className="av-diff-review-grid" style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(250px, 320px) minmax(0, 1fr)', gap: 14 }}>
        <aside style={{ minHeight: 0, display: 'flex', flexDirection: 'column', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)', overflow: 'hidden' }}>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.08em' }}>
            FILES {review ? `· ${review.files.length}` : ''}
          </div>
          <div style={{ overflow: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {loading && !review ? (
              <div style={{ padding: 12, color: 'var(--text-3)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>Loading…</div>
            ) : review?.files.length === 0 ? (
              <div style={{ padding: 12, color: 'var(--text-3)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>Working tree clean.</div>
            ) : (
              review?.files.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  aria-pressed={selectedFile?.path === file.path}
                  onClick={() => setSelectedPath(file.path)}
                  className={cn(selectedFile?.path === file.path && 'av-active')}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto',
                    gap: 8,
                    alignItems: 'center',
                    padding: '9px 10px',
                    border: `1px solid ${selectedFile?.path === file.path ? 'color-mix(in srgb, var(--cyan) 45%, var(--border))' : 'var(--border)'}`,
                    borderRadius: 6,
                    background: selectedFile?.path === file.path ? 'color-mix(in srgb, var(--cyan) 9%, var(--surface))' : 'var(--surface)',
                    color: 'var(--text)',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: 'var(--text)' }}>
                      {basename(file.path)}
                    </span>
                    <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--text-3)' }}>
                      {file.path}
                    </span>
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10 }}>
                    <span style={{ color: statusColor(file), textTransform: 'uppercase' }}>{file.status}</span>
                    <span><span style={{ color: 'var(--green)' }}>+{file.additions}</span> <span style={{ color: 'var(--red)' }}>-{file.deletions}</span></span>
                  </span>
                </button>
              ))
            )}
            {review && review.omittedFiles > 0 && (
              <div style={{ padding: '6px 8px', color: 'var(--amber)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>
                {review.omittedFiles} files omitted
              </div>
            )}
          </div>
        </aside>

        <main className="av-diff-review-main" style={{ minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(260px, 340px)', gap: 14 }}>
          <section style={{ minHeight: 0, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {selectedFile?.path ?? 'No file selected'}
                </div>
                {selectedFile && (
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: statusColor(selectedFile), letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                    {selectedFile.status} · {selectedFile.staged ? 'staged' : 'unstaged'}{selectedFile.untracked ? ' · untracked' : ''}
                  </div>
                )}
              </div>
              {selectedFile && (
                <div style={{ flexShrink: 0, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>
                  <span style={{ color: 'var(--green)' }}>+{selectedFile.additions}</span>{' '}
                  <span style={{ color: 'var(--red)' }}>-{selectedFile.deletions}</span>
                </div>
              )}
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              {selectedFile ? (
                <PierrePatchDiffView
                  patch={selectedFile.patch}
                  maxHeight={null}
                  presentation={{ ...diffOptions, diffStyle }}
                />
              ) : (
                <div style={{ padding: 18, color: 'var(--text-3)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>
                  Select a file.
                </div>
              )}
            </div>
          </section>

          <aside style={{ minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <EvidenceList title="File Evidence" items={selectedEvidence} empty="No edit tools linked to this file." onJumpToMessage={onJumpToMessage} />
            <EvidenceList title="Verification" items={analysis.tests} empty="No verification commands found." onJumpToMessage={onJumpToMessage} />
            <EvidenceList title="Tool Errors" items={analysis.errors} empty="No tool errors found." onJumpToMessage={onJumpToMessage} />
            <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                Recent Commits
              </div>
              {review?.commits.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {review.commits.slice(0, 6).map((commit) => {
                    const [hash = '', ...rest] = commit.split(' ')
                    return (
                      <div key={commit} style={{ padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)' }}>
                        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: review.upstream && review.ahead > 0 ? 'var(--amber)' : 'var(--text-3)', marginBottom: 3 }}>
                          {hash}
                        </div>
                        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={rest.join(' ')}>
                          {rest.join(' ')}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: 'var(--text-3)', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)' }}>
                  No recent commits found.
                </div>
              )}
            </section>
            <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                <Terminal size={12} />
                Recent Commands
              </div>
              <EvidenceList title="" items={analysis.commands.slice(-6).reverse()} empty="No shell commands found." onJumpToMessage={onJumpToMessage} />
            </section>
          </aside>
        </main>
      </div>
    </div>
  )
}
