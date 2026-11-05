'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { GithubIssueDetail, GithubIssueSummary, GithubRepoOverview } from '@/lib/github/types'
import { Message, Pill, Pre, Row, Section, Split, Status, api, muted, q, useAction, useRemote, when } from './shared'

export function IssuesTab({ cwd, onAskAgent }: { cwd: string; onAskAgent: (text: string) => void }) {
  const [state, setState] = useState<'open' | 'closed' | 'all'>('open')
  const [assignee, setAssignee] = useState('')
  const [search, setSearch] = useState('')
  const [applied, setApplied] = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const list = useRemote<{ issues: GithubIssueSummary[] }>(`/api/github/issues?${q({ cwd, state, search: applied, assignee: assignee || undefined })}`)
  const detail = useRemote<{ issue: GithubIssueDetail }>(selected ? `/api/github/issues?${q({ cwd, number: selected })}` : null)
  const repo = useRemote<{ repo: GithubRepoOverview }>(`/api/github/repo?${q({ cwd })}`)
  const refresh = () => { list.reload(); detail.reload() }

  return (
    <Split
      list={(
        <>
          <form onSubmit={(event) => { event.preventDefault(); setApplied(search) }} style={{ display: 'flex', gap: 6, padding: 8, flexWrap: 'wrap' }}>
            <select value={state} onChange={(event) => setState(event.target.value as typeof state)}><option value="open">Open</option><option value="closed">Closed</option><option value="all">All</option></select>
            <select value={assignee} onChange={(event) => setAssignee(event.target.value)}><option value="">Anyone</option><option value="@me">Assigned to me</option></select>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" style={{ flex: 1, minWidth: 80 }} />
            <Button size="sm" type="button" onClick={() => { setCreating(true); setSelected(null) }}>New</Button>
          </form>
          <Status loading={list.loading && !list.data} error={list.error}>
            {list.data?.issues.length === 0 ? <div style={{ padding: 16, ...muted }}>No issues.</div> : null}
            {list.data?.issues.map((entry) => (
              <Row key={entry.number} selected={entry.number === selected} onClick={() => { setSelected(entry.number); setCreating(false) }}>
                <div>{entry.title}</div>
                <div style={muted}>#{entry.number} · {entry.author} · {entry.comments} comments{entry.assignees.length ? ` · @${entry.assignees.join(', @')}` : ''}{entry.labels.length ? ` · ${entry.labels.join(', ')}` : ''}</div>
              </Row>
            ))}
          </Status>
        </>
      )}
      detail={creating ? <NewIssue cwd={cwd} labels={repo.data?.repo.labels.map((label) => label.name) ?? []} onCreated={() => { setCreating(false); list.reload() }} />
        : !selected ? <div style={muted}>Select an issue, or create one.</div> : (
          <Status loading={detail.loading && !detail.data} error={detail.error}>
            {detail.data ? <IssueDetail cwd={cwd} issue={detail.data.issue} repo={repo.data?.repo ?? null} onChanged={refresh} onAskAgent={onAskAgent} /> : null}
          </Status>
        )}
    />
  )
}

function NewIssue({ cwd, labels, onCreated }: { cwd: string; labels: string[]; onCreated: () => void }) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [chosen, setChosen] = useState<string[]>([])
  const [mine, setMine] = useState(false)
  const action = useAction(onCreated)
  return (
    <>
      <h3 style={{ margin: '0 0 8px' }}>New issue</h3>
      <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Title" style={{ width: '100%', marginBottom: 6 }} />
      <textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="Description" rows={8} style={{ width: '100%' }} />
      <div style={{ margin: '6px 0' }}>
        {labels.map((label) => (
          <label key={label} style={{ marginRight: 10, whiteSpace: 'nowrap' }}><input type="checkbox" checked={chosen.includes(label)} onChange={(event) => setChosen(event.target.checked ? [...chosen, label] : chosen.filter((entry) => entry !== label))} /> {label}</label>
        ))}
      </div>
      <label style={{ display: 'block', marginBottom: 6 }}><input type="checkbox" checked={mine} onChange={(event) => setMine(event.target.checked)} /> Assign to me</label>
      <Button size="sm" disabled={action.busy || !title.trim()} onClick={() => void action.run(async () => (await api<{ url: string }>('/api/github/issues', { cwd, mutation: { action: 'create', title, body, labels: chosen, assignees: mine ? ['@me'] : [] } })).url, 'Created')}>Create issue</Button>
      <Message message={action.message} />
    </>
  )
}

function IssueDetail({ cwd, issue, repo, onChanged, onAskAgent }: { cwd: string; issue: GithubIssueDetail; repo: GithubRepoOverview | null; onChanged: () => void; onAskAgent: (text: string) => void }) {
  const action = useAction(onChanged)
  const [comment, setComment] = useState('')
  const [addLabel, setAddLabel] = useState('')
  useEffect(() => { setComment(''); action.clear() }, [issue.number]) // eslint-disable-line react-hooks/exhaustive-deps
  const mutate = (mutation: Record<string, unknown>, done: string) => action.run(async () => (await api<{ url: string }>('/api/github/issues', { cwd, mutation })).url, done)
  const open = issue.state === 'OPEN'
  const unassigned = repo?.collaborators.filter((login) => !issue.assignees.includes(login)) ?? []

  return (
    <>
      <h3 style={{ margin: 0 }}>#{issue.number} {issue.title}</h3>
      <div style={{ ...muted, margin: '4px 0 8px' }}>{issue.state.toLowerCase()} · {issue.author} · <a href={issue.url} target="_blank" rel="noreferrer">open on GitHub</a></div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        <Button size="sm" onClick={() => onAskAgent(`Work on issue #${issue.number}: ${issue.title}\n\n${issue.body}`)}>Start session from issue</Button>
        {open ? <Button size="sm" variant="outline" disabled={action.busy} onClick={() => void mutate({ action: 'close', number: issue.number }, 'Closed')}>Close</Button>
          : <Button size="sm" variant="outline" disabled={action.busy} onClick={() => void mutate({ action: 'reopen', number: issue.number }, 'Reopened')}>Reopen</Button>}
        {open ? <Button size="sm" variant="ghost" disabled={action.busy} onClick={() => void mutate({ action: 'close', number: issue.number, reason: 'not planned' }, 'Closed as not planned')}>Close as not planned</Button> : null}
      </div>
      <div style={{ marginBottom: 8 }}>
        <span style={muted}>Labels: </span>
        {issue.labels.map((label) => <Pill key={label}>{label} <a role="button" onClick={() => void mutate({ action: 'edit', number: issue.number, removeLabels: [label] }, 'Label removed')} style={{ cursor: 'pointer' }}>×</a></Pill>)}
        <select value={addLabel} onChange={(event) => setAddLabel(event.target.value)}>
          <option value="">+ label</option>
          {repo?.labels.filter((label) => !issue.labels.includes(label.name)).map((label) => <option key={label.name} value={label.name}>{label.name}</option>)}
        </select>
        {addLabel ? <Button size="sm" variant="ghost" disabled={action.busy} onClick={async () => { if (await mutate({ action: 'edit', number: issue.number, addLabels: [addLabel] }, 'Label added')) setAddLabel('') }}>Add</Button> : null}
      </div>
      <div style={{ marginBottom: 10 }}>
        <span style={muted}>Assignees: </span>
        {issue.assignees.length === 0 ? <span style={muted}>none </span> : null}
        {issue.assignees.map((login) => <Pill key={login}>@{login} <a role="button" onClick={() => void mutate({ action: 'edit', number: issue.number, removeAssignees: [login] }, 'Unassigned')} style={{ cursor: 'pointer' }}>×</a></Pill>)}
        <Button size="sm" variant="ghost" disabled={action.busy} onClick={() => void mutate({ action: 'edit', number: issue.number, addAssignees: ['@me'] }, 'Assigned to you')}>Assign to me</Button>
        {unassigned.length > 0 ? (
          <select value="" onChange={(event) => event.target.value && void mutate({ action: 'edit', number: issue.number, addAssignees: [event.target.value] }, 'Assigned')}>
            <option value="">+ assignee</option>{unassigned.map((login) => <option key={login} value={login}>{login}</option>)}
          </select>
        ) : null}
      </div>
      <Pre>{issue.body || '(no description)'}</Pre>
      {issue.thread.map((entry) => (
        <div key={entry.id} style={{ borderTop: '1px solid var(--border-2)', marginTop: 10, paddingTop: 8 }}>
          <div style={muted}>{entry.author} · {when(entry.createdAt)}</div><Pre>{entry.body}</Pre>
        </div>
      ))}
      <Section title="Add a comment">
        <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={3} style={{ width: '100%' }} />
        <Button size="sm" disabled={action.busy || !comment.trim()} onClick={async () => { if (await mutate({ action: 'comment', number: issue.number, body: comment }, 'Commented')) setComment('') }}>Comment</Button>
      </Section>
      <Message message={action.message} />
    </>
  )
}
