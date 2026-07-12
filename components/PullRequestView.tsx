'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SelectedLineRange } from '@pierre/diffs'
import { Check, ChevronLeft, ExternalLink, GitPullRequest, MessageSquare, RefreshCw, Send, X, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { PierrePatchDiffView } from '@/components/PierreDiffView'
import type { PullRequestMutation, PullRequestWorkspace } from '@/lib/githubPr'

type Props = {
  open: boolean
  cwd: string
  onClose: () => void
  onAskAgent: (prompt: string) => void
}

async function loadWorkspace(cwd: string, number?: number, mutation?: PullRequestMutation): Promise<PullRequestWorkspace> {
  const response = await fetch('/api/github/pr', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd, number, mutation }),
  })
  const result = await response.json() as { workspace?: PullRequestWorkspace; error?: string }
  if (!response.ok || !result.workspace) throw new Error(result.error || 'Unable to load pull requests.')
  return result.workspace
}

function buildAgentQuestion(workspace: PullRequestWorkspace, question: string): string {
  const pr = workspace.selected
  if (!pr) return question
  const files = pr.files.map((file) => `${file.filename} (+${file.additions} -${file.deletions})`).join('\n')
  return `Review GitHub PR #${pr.number}: ${pr.title}\n${pr.url}\nBase: ${pr.baseRefName} ← ${pr.headRefName}\n\nChanged files:\n${files}\n\nQuestion: ${question}`
}

export default function PullRequestView({ open, cwd, onClose, onAskAgent }: Props) {
  const [workspace, setWorkspace] = useState<PullRequestWorkspace | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState(0)
  const [selectedLines, setSelectedLines] = useState<SelectedLineRange | null>(null)
  const [comment, setComment] = useState('')
  const [question, setQuestion] = useState('')
  const [busyAction, setBusyAction] = useState<string | null>(null)

  const refresh = useCallback(async (number?: number) => {
    setLoading(true); setError(null)
    try {
      const next = await loadWorkspace(cwd, number)
      setWorkspace(next); setSelectedFile(0); setSelectedLines(null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setLoading(false) }
  }, [cwd])

  useEffect(() => { if (open) void refresh() }, [open, refresh])
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, open])

  const pr = workspace?.selected ?? null
  const file = pr?.files[selectedFile] ?? null
  const discussion = useMemo(() => {
    if (!pr) return []
    return [
      ...pr.reviews.map((review) => ({ id: `review-${review.id}`, author: review.author, body: review.body, meta: review.state, createdAt: review.submittedAt })),
      ...pr.comments.map((item) => ({ id: `comment-${item.id}`, author: item.author, body: item.body, meta: item.path ? `${item.path}${item.line ? `:${item.line}` : ''}` : 'comment', createdAt: item.createdAt })),
    ].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }, [pr])

  const mutate = useCallback(async (mutation: PullRequestMutation, label: string) => {
    if (!workspace?.repo || !pr) return
    setBusyAction(label); setError(null)
    try {
      setWorkspace(await loadWorkspace(cwd, pr.number, mutation))
      setComment(''); setSelectedLines(null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusyAction(null) }
  }, [cwd, pr, workspace?.repo])

  if (!open) return null
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="pr-view-title" style={{ position: 'fixed', inset: 0, zIndex: 80, display: 'flex', flexDirection: 'column', background: 'var(--bg)', color: 'var(--text)' }}>
      <header style={{ minHeight: 58, display: 'flex', alignItems: 'center', gap: 12, padding: '8px 14px', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close pull request view"><ChevronLeft /></Button>
        <GitPullRequest style={{ color: 'var(--violet)' }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div id="pr-view-title" style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pr ? `#${pr.number} ${pr.title}` : 'Pull requests'}</div>
          <div style={{ color: 'var(--text-3)', fontSize: 12 }}>{workspace?.repo ?? cwd}{pr ? ` · ${pr.headRefName} → ${pr.baseRefName}` : ''}</div>
        </div>
        {pr?.url ? <Button variant="outline" size="sm" asChild><a href={pr.url} target="_blank" rel="noreferrer"><ExternalLink data-icon="inline-start" />GitHub</a></Button> : null}
        <Button variant="outline" size="icon" onClick={() => void refresh(pr?.number)} disabled={loading} aria-label="Refresh pull request"><RefreshCw /></Button>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close"><X /></Button>
      </header>

      {error || workspace?.error ? <div style={{ padding: '8px 14px', color: 'var(--red)', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>{error || workspace?.error}</div> : null}
      <div style={{ display: 'grid', gridTemplateColumns: '260px minmax(0, 1fr) 340px', minHeight: 0, flex: 1 }}>
        <aside style={{ overflow: 'auto', borderRight: '1px solid var(--border)', background: 'var(--surface)' }}>
          <div style={{ padding: '12px 12px 6px', color: 'var(--text-3)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>Open pull requests</div>
          {workspace?.pullRequests.map((item) => (
            <button key={item.number} type="button" onClick={() => void refresh(item.number)} style={{ width: '100%', padding: '10px 12px', border: 0, borderLeft: item.number === pr?.number ? '3px solid var(--violet)' : '3px solid transparent', background: item.number === pr?.number ? 'var(--surface-3)' : 'transparent', color: 'var(--text)', textAlign: 'left', cursor: 'pointer' }}>
              <div style={{ fontSize: 12, fontWeight: 650 }}>#{item.number} {item.title}</div>
              <div style={{ marginTop: 3, color: 'var(--text-3)', fontSize: 10 }}>{item.author.login} · {item.isDraft ? 'draft' : item.state.toLowerCase()}</div>
            </button>
          ))}
          {!loading && workspace?.pullRequests.length === 0 ? <div style={{ padding: 16, color: 'var(--text-3)', fontSize: 12 }}>No open pull requests.</div> : null}
        </aside>

        <main style={{ display: 'flex', minWidth: 0, minHeight: 0, flexDirection: 'column', background: 'var(--surface)' }}>
          {pr ? (
            <>
              <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>
                <div style={{ display: 'flex', gap: 14, color: 'var(--text-2)', fontSize: 12 }}>
                  <span style={{ color: 'var(--green)' }}>+{pr.additions}</span><span style={{ color: 'var(--red)' }}>−{pr.deletions}</span><span>{pr.changedFiles} files</span><span>{pr.reviewDecision || 'Review pending'}</span><span>{pr.mergeable}</span>
                </div>
                {pr.body ? <div style={{ marginTop: 8, color: 'var(--text-2)', fontSize: 12, whiteSpace: 'pre-wrap', maxHeight: 82, overflow: 'auto' }}>{pr.body}</div> : null}
              </div>
              <div style={{ display: 'flex', overflowX: 'auto', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
                {pr.files.map((item, index) => <button key={item.filename} type="button" onClick={() => { setSelectedFile(index); setSelectedLines(null) }} style={{ flex: '0 0 auto', padding: '8px 11px', border: 0, borderBottom: index === selectedFile ? '2px solid var(--cyan)' : '2px solid transparent', background: index === selectedFile ? 'var(--surface-2)' : 'transparent', color: index === selectedFile ? 'var(--text)' : 'var(--text-3)', cursor: 'pointer', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>{item.filename} <span style={{ color: 'var(--green)' }}>+{item.additions}</span> <span style={{ color: 'var(--red)' }}>-{item.deletions}</span></button>)}
              </div>
              <div style={{ minHeight: 0, flex: 1, overflow: 'auto' }}>
                {file ? <PierrePatchDiffView patch={file.patch} maxHeight={null} selectedLines={selectedLines} onSelectedLinesChange={setSelectedLines} onGutterUtilityClick={setSelectedLines} /> : null}
              </div>
            </>
          ) : <div style={{ margin: 'auto', color: 'var(--text-3)' }}>{loading ? 'Loading pull requests…' : 'Select an open pull request.'}</div>}
        </main>

        <aside style={{ display: 'flex', minHeight: 0, flexDirection: 'column', borderLeft: '1px solid var(--border)', background: 'var(--surface-2)' }}>
          <div style={{ minHeight: 0, flex: 1, overflow: 'auto', padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10, fontWeight: 700 }}><MessageSquare size={15} /> Discussion</div>
            {discussion.map((item) => <article key={item.id} style={{ marginBottom: 10, padding: 10, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)' }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, color: 'var(--text-3)', fontSize: 10 }}><strong style={{ color: 'var(--text-2)' }}>{item.author}</strong><span>{item.meta}</span></div><div style={{ marginTop: 6, fontSize: 12, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{item.body || '(no review message)'}</div></article>)}
            {pr && discussion.length === 0 ? <div style={{ color: 'var(--text-3)', fontSize: 12 }}>No discussion yet.</div> : null}
          </div>
          {pr ? <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderTop: '1px solid var(--border)' }}>
            <div style={{ color: 'var(--text-3)', fontSize: 11 }}>{selectedLines && file ? `Inline comment on ${file.filename}:${selectedLines.start}${selectedLines.end !== selectedLines.start ? `-${selectedLines.end}` : ''}` : 'Comment on the pull request'}</div>
            <Textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Leave a review comment…" rows={3} />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Button size="sm" disabled={!comment.trim() || !!busyAction} onClick={() => {
                if (selectedLines && file) {
                  const side = (selectedLines.endSide ?? selectedLines.side) === 'deletions' ? 'LEFT' : 'RIGHT'
                  void mutate({ action: 'inline-comment', number: pr.number, body: comment, commitId: pr.headRefOid, path: file.filename, line: selectedLines.end, side, ...(selectedLines.start !== selectedLines.end ? { startLine: selectedLines.start, startSide: side } : {}) }, 'comment')
                } else void mutate({ action: 'comment', number: pr.number, body: comment }, 'comment')
              }}><Send data-icon="inline-start" />{busyAction === 'comment' ? 'Posting…' : 'Comment'}</Button>
              <Button size="sm" variant="outline" disabled={!!busyAction} onClick={() => void mutate({ action: 'review', number: pr.number, body: comment, verdict: 'approve' }, 'approve')}><Check data-icon="inline-start" />Approve</Button>
              <Button size="sm" variant="outline" disabled={!!busyAction} onClick={() => void mutate({ action: 'review', number: pr.number, body: comment, verdict: 'request-changes' }, 'request')}><XCircle data-icon="inline-start" />Request changes</Button>
            </div>
            <Textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask the active agent about this PR…" rows={2} />
            <Button size="sm" variant="secondary" disabled={!question.trim()} onClick={() => { onAskAgent(buildAgentQuestion(workspace!, question.trim())); setQuestion(''); onClose() }}>Ask agent</Button>
          </div> : null}
        </aside>
      </div>
    </div>
  )
}
