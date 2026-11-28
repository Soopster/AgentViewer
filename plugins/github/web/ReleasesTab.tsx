'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { GithubRelease, GithubReleaseDetail, GithubRepoOverview } from '@/lib/github/types'
import { Message, Pill, Pre, Row, Split, Status, api, muted, q, useAction, useRemote, when } from './shared'

export function ReleasesTab({ cwd }: { cwd: string }) {
  const [selected, setSelected] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const list = useRemote<{ releases: GithubRelease[] }>(`/api/github/releases?${q({ cwd })}`)
  const detail = useRemote<{ release: GithubReleaseDetail }>(selected ? `/api/github/releases?${q({ cwd, tag: selected })}` : null)
  return (
    <Split
      list={(
        <>
          <div style={{ padding: 8, textAlign: 'right' }}><Button size="sm" onClick={() => { setCreating(true); setSelected(null) }}>New release</Button></div>
          <Status loading={list.loading && !list.data} error={list.error}>
            {list.data?.releases.length === 0 ? <div style={{ padding: 16, ...muted }}>No releases yet.</div> : null}
            {list.data?.releases.map((release) => (
              <Row key={release.tag} selected={release.tag === selected} onClick={() => { setSelected(release.tag); setCreating(false) }}>
                <div>{release.name}{release.isLatest ? <Pill tone="ok">latest</Pill> : null}{release.isDraft ? <Pill>draft</Pill> : null}{release.isPrerelease ? <Pill tone="warn">pre-release</Pill> : null}</div>
                <div style={muted}>{release.tag} · {when(release.publishedAt)}</div>
              </Row>
            ))}
          </Status>
        </>
      )}
      detail={creating ? <NewRelease cwd={cwd} onCreated={() => { setCreating(false); list.reload() }} />
        : !selected ? <div style={muted}>Select a release, or create one.</div> : (
          <Status loading={detail.loading && !detail.data} error={detail.error}>
            {detail.data ? (
              <>
                <h3 style={{ margin: 0 }}>{detail.data.release.name}</h3>
                <div style={{ ...muted, margin: '4px 0 8px' }}>{detail.data.release.tag} · {detail.data.release.author} · <a href={detail.data.release.url} target="_blank" rel="noreferrer">open on GitHub</a></div>
                <Pre>{detail.data.release.body || '(no notes)'}</Pre>
                {detail.data.release.assets.length > 0 ? <div style={{ marginTop: 10 }}><strong>Assets</strong>{detail.data.release.assets.map((asset) => <div key={asset.name}>{asset.name} <span style={muted}>{(asset.size / 1024).toFixed(0)} KB · {asset.downloads} downloads</span></div>)}</div> : null}
              </>
            ) : null}
          </Status>
        )}
    />
  )
}

function NewRelease({ cwd, onCreated }: { cwd: string; onCreated: () => void }) {
  const repo = useRemote<{ repo: GithubRepoOverview }>(`/api/github/repo?${q({ cwd })}`)
  const [tag, setTag] = useState('')
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [target, setTarget] = useState('')
  const [draft, setDraft] = useState(false)
  const [prerelease, setPrerelease] = useState(false)
  const action = useAction(onCreated)
  return (
    <>
      <h3 style={{ margin: '0 0 8px' }}>New release</h3>
      <input value={tag} onChange={(event) => setTag(event.target.value)} placeholder="Tag (e.g. v1.2.0) — created if it does not exist" style={{ width: '100%', marginBottom: 6 }} />
      <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Title (optional)" style={{ width: '100%', marginBottom: 6 }} />
      <select value={target} onChange={(event) => setTarget(event.target.value)} style={{ width: '100%', marginBottom: 6 }}>
        <option value="">Target: default branch</option>
        {repo.data?.repo.branches.map((branch) => <option key={branch.name} value={branch.name}>{branch.name}</option>)}
      </select>
      <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={8} placeholder="Release notes — leave empty to have GitHub generate them from merged PRs" style={{ width: '100%' }} />
      <label style={{ marginRight: 12 }}><input type="checkbox" checked={draft} onChange={(event) => setDraft(event.target.checked)} /> Draft</label>
      <label><input type="checkbox" checked={prerelease} onChange={(event) => setPrerelease(event.target.checked)} /> Pre-release</label>
      <div><Button size="sm" disabled={action.busy || !tag.trim()} onClick={() => void action.run(async () => (await api<{ url: string }>('/api/github/releases', { cwd, release: { tag, title, notes, target: target || undefined, draft, prerelease } })).url, 'Created')}>{draft ? 'Save draft' : 'Publish release'}</Button></div>
      <Message message={action.message} />
    </>
  )
}
