'use client'

// The pull request this conversation is about, above the composer: where it
// stands, and the one thing worth doing to it next — resolve, fix, answer the
// review, mark ready, or merge. Work that needs judgement goes to the agent as a
// prompt in the composer; it is never sent without the person pressing send.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ExternalLink, RotateCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { buildPrHandoffPrompt, PR_ACTION_LABELS, resolvePrNextAction, summarizePrStatus } from '@/lib/github/prWork'
import { githubRepoArgument } from '@/lib/github/links'
import { findSessionPullRequest } from '@/lib/github/sessionPr'
import type { GithubMergeMethod, GithubPrDetail } from '@/lib/github/types'
import type { ThreadedMessage } from '@/lib/threading'
import type { LinkedPullRequest, Session } from '@/lib/types'
import { GITHUB_TONE_COLORS } from './GithubActivityCard'
import { githubStateLook } from './GithubLink'

const PENDING_POLL_MS = 30_000
const IDLE_POLL_MS = 120_000
const MONO = "'IBM Plex Mono', monospace"

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const body = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`)
  return body
}

const post = <T,>(url: string, body: unknown) => request<T>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

function postInbox(session: Session, action: 'auto-link-pr' | 'unlink-pr', linkedPr?: LinkedPullRequest) {
  return post(`/api/sessions/${encodeURIComponent(session.sessionId)}/inbox`, { action, provider: session.provider, providerInstanceId: session.providerInstanceId, linkedPr })
}

/** The linked pull request, else the one the transcript shows being opened (which is then linked). */
function useSessionPullRequest(session: Session, messages: readonly ThreadedMessage[]) {
  const [removed, setRemoved] = useState<{ session: string; url: string } | null>(null)
  const offered = useRef(new Set<string>())
  const created = useMemo(() => findSessionPullRequest(messages), [messages])
  const cwd = session.cwd
  const linked = session.inbox?.linkedPr
  const declined = session.inbox?.declinedPrUrls
  const candidate: LinkedPullRequest | undefined = linked ?? (created && cwd && !declined?.includes(created.url) ? { ...created, cwd } : undefined)
  const shown = candidate && !(removed?.session === session.sessionId && removed.url === candidate.url) ? candidate : undefined

  useEffect(() => {
    if (linked || !shown || session.isPending) return
    const key = `${session.sessionId} ${shown.url}`
    if (offered.current.has(key)) return
    offered.current.add(key)
    void postInbox(session, 'auto-link-pr', shown).catch(() => offered.current.delete(key))
  }, [linked, shown, session])

  const unlink = useCallback(() => {
    if (!shown) return
    setRemoved({ session: session.sessionId, url: shown.url })
    void postInbox(session, 'unlink-pr').catch(() => setRemoved(null))
  }, [shown, session])
  return { pr: shown, unlink }
}

export function SessionPrBar({ session, messages, onAskAgent, onOpenReview }: {
  session: Session
  messages: readonly ThreadedMessage[]
  onAskAgent: (prompt: string) => void
  onOpenReview?: () => void
}) {
  const { pr, unlink } = useSessionPullRequest(session, messages)
  if (!pr) return null
  return <PrBar key={pr.url || `${pr.repo}#${pr.number}`} pr={pr} cwd={pr.cwd ?? session.cwd ?? ''} onAskAgent={onAskAgent} onOpenReview={onOpenReview} onUnlink={unlink} />
}

function PrBar({ pr, cwd, onAskAgent, onOpenReview, onUnlink }: { pr: LinkedPullRequest; cwd: string; onAskAgent: (prompt: string) => void; onOpenReview?: () => void; onUnlink: () => void }) {
  const [detail, setDetail] = useState<GithubPrDetail | null>(null)
  const [problem, setProblem] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [method, setMethod] = useState<GithubMergeMethod>('squash')
  const [busy, setBusy] = useState(false)
  const [version, setVersion] = useState(0)
  // Always named: `gh pr view 12` alone would answer for the checkout's repository, which may not be this one's.
  const repo = githubRepoArgument(pr.url, pr.repo)
  const pending = !!detail?.checkRuns.some(check => check.state === 'pending')
  const finished = detail?.state === 'MERGED' || detail?.state === 'CLOSED'

  useEffect(() => {
    if (!cwd) return
    let live = true
    const read = () => {
      if (document.visibilityState === 'hidden') return
      request<{ pr: GithubPrDetail }>(`/api/github/prs?cwd=${encodeURIComponent(cwd)}&number=${pr.number}&repo=${encodeURIComponent(repo)}`)
        .then(body => { if (live) { setDetail(body.pr); setProblem('') } })
        .catch((error: Error) => { if (live) setProblem(error.message) })
    }
    read()
    if (finished) return () => { live = false }
    const timer = setInterval(read, pending ? PENDING_POLL_MS : IDLE_POLL_MS)
    document.addEventListener('visibilitychange', read)
    return () => { live = false; clearInterval(timer); document.removeEventListener('visibilitychange', read) }
  }, [cwd, pr.number, repo, pending, finished, version])

  const look = githubStateLook('pr', detail?.state ?? pr.state, detail?.isDraft)
  const status = detail ? summarizePrStatus(detail) : null
  const next = detail ? resolvePrNextAction(detail) : null
  if (confirming && next !== 'merge') setConfirming(false)

  const act = async (body: Record<string, unknown>) => {
    setBusy(true); setProblem('')
    try {
      await post('/api/github/pr-actions', { cwd, request: body })
      setConfirming(false)
      setVersion(value => value + 1)
    } catch (error) { setProblem((error as Error).message) } finally { setBusy(false) }
  }
  const run = () => {
    if (!detail || !next) return
    if (next === 'merge') { setConfirming(true); return }
    if (next === 'ready') { void act({ action: 'ready', number: detail.number, ready: true, repo }); return }
    onAskAgent(buildPrHandoffPrompt(next, detail))
  }

  const checks = detail ? [...detail.checkRuns].sort((a, b) => Number(b.state === 'failure') - Number(a.state === 'failure')) : []
  return (
    <div data-session-pr={pr.number} style={{ flexShrink: 0, borderTop: '1px solid var(--border)', background: 'var(--surface-2)', fontSize: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: look.color, fontFamily: MONO }} title={`${look.label} · ${pr.repo}#${pr.number}`}>
          <look.Icon aria-label={look.label} size={14} />#{pr.number}
        </span>
        <button
          type="button" onClick={onOpenReview} disabled={!onOpenReview} title={onOpenReview ? 'Review this pull request' : undefined}
          style={{ border: 0, background: 'none', padding: 0, cursor: onOpenReview ? 'pointer' : 'default', color: 'var(--text)', fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, maxWidth: '40ch' }}
        >
          {detail?.title ?? `${pr.repo}#${pr.number}`}
        </button>
        {status ? (
          <button type="button" onClick={() => setExpanded(value => !value)} aria-expanded={expanded} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: 0, background: 'none', padding: 0, cursor: 'pointer', fontFamily: MONO, fontSize: 11, color: 'var(--text-3)' }}>
            <span aria-hidden style={{ width: 7, height: 7, borderRadius: 999, background: GITHUB_TONE_COLORS[status.tone] }} />
            {status.parts.join(' · ')}
            <ChevronDown aria-hidden size={12} style={{ transform: expanded ? 'rotate(180deg)' : undefined }} />
          </button>
        ) : null}
        {problem ? <span role="status" style={{ color: 'var(--red)', fontFamily: MONO, fontSize: 11 }}>{problem}</span> : null}
        <span style={{ flex: 1 }} />
        {confirming && detail ? (
          <>
            <span style={{ color: 'var(--text-2)' }}>Merge {repo}#{detail.number} into {detail.baseRefName}?</span>
            <select aria-label="Merge method" value={method} onChange={event => setMethod(event.target.value as GithubMergeMethod)} style={{ background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border-2)', borderRadius: 4, fontSize: 12 }}>
              <option value="squash">Squash</option><option value="merge">Merge commit</option><option value="rebase">Rebase</option>
            </select>
            <Button size="sm" disabled={busy} onClick={() => void act({ action: 'merge', number: detail.number, method, repo })}>{busy ? 'Merging…' : 'Confirm merge'}</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>Cancel</Button>
          </>
        ) : next ? (
          <Button size="sm" variant="secondary" disabled={busy} onClick={run} title={next === 'ready' || next === 'merge' ? undefined : 'Puts a prompt for the agent in the composer'}>
            {PR_ACTION_LABELS[next]}
          </Button>
        ) : null}
        <button type="button" aria-label="Refresh pull request" title="Refresh (GitHub reads are cached for 30s)" onClick={() => setVersion(value => value + 1)} style={ICON_BUTTON}><RotateCw size={12} /></button>
        {pr.url ? <a href={pr.url} target="_blank" rel="noreferrer" aria-label="Open on GitHub" title="Open on GitHub" style={ICON_BUTTON}><ExternalLink size={12} /></a> : null}
        <button type="button" aria-label="Unlink pull request from this session" title="Unlink from this session" onClick={onUnlink} style={ICON_BUTTON}><X size={12} /></button>
      </div>
      {expanded && detail ? (
        <div style={{ padding: '2px 12px 8px', display: 'grid', gap: 3, maxHeight: 180, overflow: 'auto', fontFamily: MONO, fontSize: 11, color: 'var(--text-3)' }}>
          <span>{detail.headRefName} → {detail.baseRefName} · <span style={{ color: 'var(--green)' }}>+{detail.additions}</span> <span style={{ color: 'var(--red)' }}>−{detail.deletions}</span> · {detail.changedFiles} files</span>
          {checks.map((check, index) => (
            <span key={`${check.name}-${index}`} style={{ color: check.state === 'failure' ? 'var(--red)' : check.state === 'pending' ? 'var(--yellow)' : undefined }}>
              {check.state === 'failure' ? '✕' : check.state === 'pending' ? '●' : check.state === 'success' ? '✓' : '○'}{' '}
              {check.url ? <a href={check.url} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>{check.name}</a> : check.name}
            </span>
          ))}
          {detail.threads.filter(thread => !thread.resolved && !thread.outdated).map(thread => (
            <span key={thread.id} style={{ color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {thread.path}{thread.line ? `:${thread.line}` : ''} · {thread.author}: {thread.body.split('\n')[0]}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

const ICON_BUTTON: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', border: 0, background: 'none', padding: 3, cursor: 'pointer', color: 'var(--text-3)' }
