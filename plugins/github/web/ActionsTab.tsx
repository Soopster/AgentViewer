'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { GithubRepoOverview, GithubRun, GithubRunDetail, GithubWorkflow } from '@/lib/github/types'
import { Message, Pre, Row, Split, Status, api, muted, q, stateDot, useAction, useRemote, when } from './shared'

const runState = (run: { status: string; conclusion: string }) => (run.status === 'completed' ? run.conclusion || 'completed' : run.status)

export function ActionsTab({ cwd, onAskAgent }: { cwd: string; onAskAgent: (text: string) => void }) {
  const [all, setAll] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const [dispatching, setDispatching] = useState(false)
  const runs = useRemote<{ branch: string; runs: GithubRun[] }>(`/api/github/runs?${q({ cwd, all: all ? 1 : undefined })}`)
  const detail = useRemote<{ run: GithubRunDetail }>(selected ? `/api/github/runs?${q({ cwd, id: selected })}` : null)
  const [log, setLog] = useState<{ text: string; truncated: boolean } | null>(null)
  const action = useAction(() => { runs.reload(); detail.reload() })
  const run = detail.data?.run

  // Poll while anything is running; the server caches for 10s so this is cheap.
  const active = runs.data?.runs.some((entry) => entry.status !== 'completed') ?? false
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => { runs.reload(); if (selected) detail.reload() }, 12_000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, selected])
  useEffect(() => { setLog(null); action.clear() }, [selected]) // eslint-disable-line react-hooks/exhaustive-deps

  const failedHint = useMemo(() => (run ? run.jobs.filter((job) => job.conclusion === 'failure').map((job) => job.name).join(', ') : ''), [run])
  const act = (kind: 'rerun-failed' | 'rerun-all' | 'cancel', done: string) => action.run(async () => { await api('/api/github/runs', { cwd, id: selected, action: kind }) }, done)
  const failed = run?.status === 'completed' && run.conclusion === 'failure'

  return (
    <Split
      list={(
        <>
          <div style={{ padding: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={muted}>{all ? 'All branches' : runs.data?.branch ? `Branch ${runs.data.branch}` : 'Current branch'}</span>
            <span style={{ flex: 1 }} />
            <Button size="sm" variant="ghost" onClick={() => setAll(!all)}>{all ? 'This branch' : 'All branches'}</Button>
            <Button size="sm" onClick={() => { setDispatching(true); setSelected(null) }}>Run workflow</Button>
          </div>
          <Status loading={runs.loading && !runs.data} error={runs.error}>
            {runs.data?.runs.length === 0 ? <div style={{ padding: 16, ...muted }}>No workflow runs.</div> : null}
            {runs.data?.runs.map((entry) => (
              <Row key={entry.id} selected={entry.id === selected} onClick={() => { setSelected(entry.id); setDispatching(false) }}>
                <div>{stateDot(runState(entry))} {entry.title}</div>
                <div style={muted}>{entry.workflow} · {entry.branch} · {runState(entry)} · {when(entry.updatedAt)}</div>
              </Row>
            ))}
          </Status>
        </>
      )}
      detail={dispatching ? <Dispatch cwd={cwd} branch={runs.data?.branch ?? ''} onDispatched={() => { setDispatching(false); runs.reload() }} />
        : !selected ? <div style={muted}>Select a run, or run a workflow.</div> : (
          <Status loading={detail.loading && !run} error={detail.error}>
            {run ? (
              <>
                <h3 style={{ margin: 0 }}>{run.title}</h3>
                <div style={{ ...muted, margin: '4px 0 8px' }}>{run.workflow} · {runState(run)} · <a href={run.url} target="_blank" rel="noreferrer">open on GitHub</a></div>
                <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                  {failed ? <Button size="sm" disabled={action.busy} onClick={() => void action.run(async () => { setLog((await api<{ log: { text: string; truncated: boolean } }>(`/api/github/runs?${q({ cwd, id: selected, log: 1 })}`)).log) }, 'Log loaded')}>Failed-step log</Button> : null}
                  {run.status === 'completed' ? <Button size="sm" variant="outline" disabled={action.busy} onClick={() => void act('rerun-all', 'Rerun started')}>Rerun all</Button> : null}
                  {failed ? <Button size="sm" variant="outline" disabled={action.busy} onClick={() => void act('rerun-failed', 'Rerun of failed jobs started')}>Rerun failed jobs</Button> : null}
                  {run.status !== 'completed' ? <Button size="sm" variant="outline" disabled={action.busy} onClick={() => void act('cancel', 'Cancel requested')}>Cancel</Button> : null}
                  {run.conclusion === 'failure' ? <Button size="sm" variant="outline" onClick={() => onAskAgent(`CI run "${run.title}" failed${failedHint ? ` (jobs: ${failedHint})` : ''}. ${run.url}\n${log ? `\nFailed-step log (tail):\n${log.text.slice(-6000)}` : ''}`)}>Ask agent to fix</Button> : null}
                </div>
                {run.jobs.map((job) => (
                  <div key={job.id} style={{ marginBottom: 6 }}>
                    <div>{stateDot(runState(job))} <a href={job.url} target="_blank" rel="noreferrer">{job.name}</a></div>
                    {job.conclusion === 'failure' ? job.steps.filter((step) => step.conclusion === 'failure').map((step) => <div key={step.name} style={{ ...muted, paddingLeft: 20 }}>✕ {step.name}</div>) : null}
                  </div>
                ))}
                <Message message={action.message} />
                {log ? <><div style={muted}>{log.truncated ? 'Showing the end of the log.' : ''}</div><pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, maxHeight: 360, overflow: 'auto' }}>{log.text}</pre></> : null}
              </>
            ) : null}
          </Status>
        )}
    />
  )
}

function Dispatch({ cwd, branch, onDispatched }: { cwd: string; branch: string; onDispatched: () => void }) {
  const workflows = useRemote<{ workflows: GithubWorkflow[] }>(`/api/github/workflows?${q({ cwd })}`)
  const repo = useRemote<{ repo: GithubRepoOverview }>(`/api/github/repo?${q({ cwd })}`)
  const [workflow, setWorkflow] = useState('')
  const [ref, setRef] = useState(branch)
  const [inputs, setInputs] = useState('')
  const action = useAction(onDispatched)
  const parsed = useMemo(() => Object.fromEntries(inputs.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => { const at = line.indexOf('='); return at > 0 ? [line.slice(0, at).trim(), line.slice(at + 1)] : [line, ''] })), [inputs])
  return (
    <>
      <h3 style={{ margin: '0 0 8px' }}>Run workflow</h3>
      <Status loading={workflows.loading && !workflows.data} error={workflows.error}>
        <select value={workflow} onChange={(event) => setWorkflow(event.target.value)} style={{ width: '100%', marginBottom: 6 }}>
          <option value="">Choose a workflow</option>
          {workflows.data?.workflows.filter((entry) => entry.state === 'active').map((entry) => <option key={entry.id} value={String(entry.id)}>{entry.name} ({entry.path})</option>)}
        </select>
        <select value={ref} onChange={(event) => setRef(event.target.value)} style={{ width: '100%', marginBottom: 6 }}>
          {[...new Set([branch, ...(repo.data?.repo.branches.map((entry) => entry.name) ?? [])].filter(Boolean))].map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <textarea value={inputs} onChange={(event) => setInputs(event.target.value)} rows={3} placeholder={'Inputs, one per line: name=value'} style={{ width: '100%' }} />
        <div style={muted}>Only workflows with a workflow_dispatch trigger can be run.</div>
        <Button size="sm" disabled={action.busy || !workflow} onClick={() => void action.run(async () => { await api('/api/github/workflows', { cwd, dispatch: { workflow, ref: ref || undefined, inputs: parsed } }) }, 'Workflow dispatched')}>Run</Button>
        <Message message={action.message} />
      </Status>
    </>
  )
}
