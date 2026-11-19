'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { GithubMergeMethod, GithubPrDetail, GithubPrSummary, GithubReviewVerdict } from '@/lib/github/types'
import { Message, Pill, Pre, Row, Section, Split, Status, api, green, muted, q, red, stateDot, useAction, useRemote, when } from './shared'

const decisionTone = (decision: string) => (decision === 'APPROVED' ? 'ok' : decision === 'CHANGES_REQUESTED' ? 'bad' : 'warn') as 'ok' | 'bad' | 'warn'

export function PullsTab({ cwd, onAskAgent }: { cwd: string; onAskAgent: (text: string) => void }) {
  const [state, setState] = useState<'open' | 'closed' | 'merged' | 'all'>('open')
  const [scope, setScope] = useState<'all' | 'mine' | 'review-requested' | 'assigned'>('all')
  const [search, setSearch] = useState('')
  const [applied, setApplied] = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  const list = useRemote<{ prs: GithubPrSummary[] }>(`/api/github/prs?${q({ cwd, state, scope, search: applied })}`)
  const detail = useRemote<{ pr: GithubPrDetail }>(selected ? `/api/github/prs?${q({ cwd, number: selected })}` : null)
  const refresh = () => { list.reload(); detail.reload() }

  return (
    <Split
      list={(
        <>
          <form onSubmit={(event) => { event.preventDefault(); setApplied(search) }} style={{ display: 'flex', gap: 6, padding: 8, flexWrap: 'wrap' }}>
            <select value={state} onChange={(event) => setState(event.target.value as typeof state)}><option value="open">Open</option><option value="merged">Merged</option><option value="closed">Closed</option><option value="all">All</option></select>
            <select value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}><option value="all">Everyone</option><option value="mine">Mine</option><option value="review-requested">Review requested</option><option value="assigned">Assigned</option></select>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" style={{ flex: 1, minWidth: 80 }} />
          </form>
          <Status loading={list.loading && !list.data} error={list.error}>
            {list.data?.prs.length === 0 ? <div style={{ padding: 16, ...muted }}>No pull requests.</div> : null}
            {list.data?.prs.map((pr) => (
              <Row key={pr.number} selected={pr.number === selected} onClick={() => setSelected(pr.number)}>
                <div>{pr.isDraft ? <Pill>draft</Pill> : null}{pr.title}</div>
                <div style={muted}>
                  #{pr.number} · {pr.author} · {pr.headRefName} → {pr.baseRefName} {pr.checks !== 'none' ? stateDot(pr.checks) : ''}
                  {pr.reviewDecision ? <> <Pill tone={decisionTone(pr.reviewDecision)}>{pr.reviewDecision.replace('_', ' ').toLowerCase()}</Pill></> : null}
                </div>
              </Row>
            ))}
          </Status>
        </>
      )}
      detail={!selected ? <div style={muted}>Select a pull request.</div> : (
        <Status loading={detail.loading && !detail.data} error={detail.error}>
          {detail.data ? <PrDetail cwd={cwd} pr={detail.data.pr} onChanged={refresh} onAskAgent={onAskAgent} /> : null}
        </Status>
      )}
    />
  )
}

function PrDetail({ cwd, pr, onChanged, onAskAgent }: { cwd: string; pr: GithubPrDetail; onChanged: () => void; onAskAgent: (text: string) => void }) {
  const action = useAction(onChanged)
  const [body, setBody] = useState('')
  const [method, setMethod] = useState<GithubMergeMethod>('squash')
  const [auto, setAuto] = useState(false)
  const [deleteBranch, setDeleteBranch] = useState(true)
  const [confirmMerge, setConfirmMerge] = useState(false)
  useEffect(() => { setBody(''); setConfirmMerge(false); action.clear() }, [pr.number]) // eslint-disable-line react-hooks/exhaustive-deps

  const send = (request: Record<string, unknown>, done: string) => action.run(async () => (await api<{ url: string }>('/api/github/pr-actions', { cwd, request })).url, done)
  const review = async (verdict: GithubReviewVerdict) => { if (await send({ action: 'review', number: pr.number, verdict, body }, 'Review submitted')) setBody('') }
  const open = pr.state === 'OPEN'
  const unresolved = pr.threads.filter((thread) => !thread.resolved)

  return (
    <>
      <h3 style={{ margin: 0 }}>#{pr.number} {pr.title}</h3>
      <div style={{ ...muted, margin: '4px 0 8px' }}>
        {pr.state.toLowerCase()}{pr.isDraft ? ' · draft' : ''} · {pr.author} · {pr.headRefName} → {pr.baseRefName} · <a href={pr.url} target="_blank" rel="noreferrer">open on GitHub</a>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        <Pill tone={pr.mergeable === 'MERGEABLE' ? 'ok' : pr.mergeable === 'CONFLICTING' ? 'bad' : 'warn'}>{pr.mergeable.toLowerCase() || 'mergeability unknown'}</Pill>
        {pr.mergeStateStatus === 'BEHIND' ? <Pill tone="warn">behind {pr.baseRefName}</Pill> : null}
        {pr.reviewDecision ? <Pill tone={decisionTone(pr.reviewDecision)}>{pr.reviewDecision.replace('_', ' ').toLowerCase()}</Pill> : null}
        <Pill>+{pr.additions} −{pr.deletions} · {pr.changedFiles} files</Pill>
        {pr.labels.map((label) => <Pill key={label}>{label}</Pill>)}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        <Button size="sm" onClick={() => onAskAgent(`Review pull request #${pr.number} (${pr.url}): ${pr.title}\n\n${pr.body.slice(0, 4000)}`)}>Ask agent to review</Button>
        {open && pr.mergeStateStatus === 'BEHIND' ? <Button size="sm" variant="outline" disabled={action.busy} onClick={() => void send({ action: 'update-branch', number: pr.number }, 'Branch updated')}>Update branch</Button> : null}
        {open ? <Button size="sm" variant="outline" disabled={action.busy} onClick={() => void send({ action: 'ready', number: pr.number, ready: pr.isDraft }, pr.isDraft ? 'Marked ready' : 'Marked draft')}>{pr.isDraft ? 'Ready for review' : 'Convert to draft'}</Button> : null}
        {open ? <Button size="sm" variant="outline" disabled={action.busy} onClick={() => void send({ action: 'checkout', number: pr.number }, 'Checked out')}>Checkout</Button> : null}
        {open ? <Button size="sm" variant="outline" disabled={action.busy} onClick={() => setConfirmMerge(!confirmMerge)}>Merge…</Button> : null}
        {open ? <Button size="sm" variant="ghost" disabled={action.busy} onClick={() => void send({ action: 'close', number: pr.number }, 'Closed')}>Close</Button> : <Button size="sm" variant="ghost" disabled={action.busy || pr.state === 'MERGED'} onClick={() => void send({ action: 'reopen', number: pr.number }, 'Reopened')}>Reopen</Button>}
      </div>
      {confirmMerge ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10, padding: 8, border: '1px solid var(--border-2)', borderRadius: 8 }}>
          <select value={method} onChange={(event) => setMethod(event.target.value as GithubMergeMethod)}><option value="squash">Squash</option><option value="merge">Merge commit</option><option value="rebase">Rebase</option></select>
          <label><input type="checkbox" checked={auto} onChange={(event) => setAuto(event.target.checked)} /> Auto-merge when checks pass</label>
          <label><input type="checkbox" checked={deleteBranch} onChange={(event) => setDeleteBranch(event.target.checked)} /> Delete branch</label>
          <Button size="sm" disabled={action.busy} onClick={() => void send({ action: 'merge', number: pr.number, method, auto, deleteBranch }, 'Merged')}>Confirm merge #{pr.number}</Button>
        </div>
      ) : null}
      <Message message={action.message} />

      {pr.body ? <Section title="Description"><Pre>{pr.body}</Pre></Section> : null}
      {pr.checkRuns.length > 0 ? (
        <Section title="Checks" count={pr.checkRuns.length}>
          {pr.checkRuns.map((check, index) => <div key={`${check.name}${index}`}>{stateDot(check.state)} {check.url ? <a href={check.url} target="_blank" rel="noreferrer">{check.name}</a> : check.name}</div>)}
        </Section>
      ) : null}
      {pr.reviewRequests.length > 0 ? <Section title="Review requested"><span>{pr.reviewRequests.join(', ')}</span></Section> : null}
      {pr.reviews.length > 0 ? (
        <Section title="Reviews" count={pr.reviews.length}>
          {pr.reviews.map((entry, index) => (
            <div key={index} style={{ marginBottom: 4 }}>
              <span style={{ color: entry.state === 'APPROVED' ? green : entry.state === 'CHANGES_REQUESTED' ? red : undefined }}>{entry.state.replace('_', ' ').toLowerCase()}</span> · {entry.author}{entry.body ? <Pre>{entry.body}</Pre> : null}
            </div>
          ))}
        </Section>
      ) : null}
      {pr.threads.length > 0 ? (
        <Section title="Review threads" count={unresolved.length}>
          {pr.threads.map((thread) => (
            <Row key={thread.id}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span style={{ flex: 1, opacity: thread.resolved ? 0.6 : 1 }}>{thread.resolved ? '✓ ' : '○ '}<code>{thread.path}{thread.line ? `:${thread.line}` : ''}</code>{thread.outdated ? <Pill>outdated</Pill> : null}</span>
                <Button size="sm" variant="ghost" disabled={action.busy} onClick={() => void send({ action: 'thread', threadId: thread.id, resolved: !thread.resolved }, thread.resolved ? 'Reopened thread' : 'Resolved thread')}>{thread.resolved ? 'Unresolve' : 'Resolve'}</Button>
              </div>
              <div style={muted}>{thread.author}{thread.replies ? ` · ${thread.replies} replies` : ''}</div>
              <Pre>{thread.body}</Pre>
            </Row>
          ))}
        </Section>
      ) : null}
      {pr.files.length > 0 ? (
        <Section title="Files" count={pr.files.length}>
          {pr.files.slice(0, 60).map((file) => <div key={file.path} style={{ fontSize: 13 }}><span style={{ color: green }}>+{file.additions}</span> <span style={{ color: red }}>−{file.deletions}</span> {file.path}</div>)}
          {pr.files.length > 60 ? <div style={muted}>…and {pr.files.length - 60} more</div> : null}
        </Section>
      ) : null}
      {pr.commits.length > 0 ? <Section title="Commits" count={pr.commits.length}>{pr.commits.map((commit) => <div key={commit.oid}><code>{commit.oid}</code> {commit.message}</div>)}</Section> : null}
      {pr.comments.length > 0 ? (
        <Section title="Discussion" count={pr.comments.length}>
          {pr.comments.map((entry) => <div key={entry.id} style={{ marginBottom: 8 }}><div style={muted}>{entry.author} · {when(entry.createdAt)}</div><Pre>{entry.body}</Pre></div>)}
        </Section>
      ) : null}
      {open || pr.state === 'MERGED' || pr.state === 'CLOSED' ? (
        <Section title="Comment or review">
          <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={3} style={{ width: '100%' }} placeholder="Message" />
          <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
            <Button size="sm" variant="outline" disabled={action.busy || !body.trim()} onClick={async () => { if (await send({ action: 'comment', number: pr.number, body }, 'Commented')) setBody('') }}>Comment</Button>
            {open ? <Button size="sm" disabled={action.busy} onClick={() => void review('approve')}>Approve</Button> : null}
            {open ? <Button size="sm" variant="outline" disabled={action.busy || !body.trim()} onClick={() => void review('comment')}>Review comment</Button> : null}
            {open ? <Button size="sm" variant="outline" disabled={action.busy || !body.trim()} onClick={() => void review('request-changes')}>Request changes</Button> : null}
          </div>
        </Section>
      ) : null}
    </>
  )
}
