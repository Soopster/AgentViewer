'use client'

import { useEffect, useMemo, useState } from 'react'
import { WorkflowPanel } from './WorkflowPanel'
import { ConflictEditor } from './ConflictEditor'
import type { WorkspaceSnapshot } from '@/lib/git/workspaceTypes'
import { PatchSelection } from './PatchSelection'
import { GitBranch, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useDiffComments } from '@/components/diffComments'
import { PierrePatchDiffView, type PierreAnnotationMetadata, type PierreDiffAnnotation } from '@/components/shell/sdkDiff'
import { useGitWorkspace } from '@/lib/git/useGitWorkspace'
import { webWorkspaceTransport } from '@/lib/git/webWorkspaceTransport'
import { filesForSide } from '@/lib/git/workspaceTypes'
import { isDocked, type SurfaceVariant } from '@/components/shell/sdk'

type Inspection = { kind: 'branch' | 'remote-branch' | 'commit' | 'stash'; ref: string; label: string; selector?: string }
function readDraft(cwd: string) { try { return localStorage.getItem(`git-commit-v1:${cwd}`) ?? '' } catch { return '' } }
export function GitWorkspace({ cwd, variant, onClose, onReview }: { cwd: string; variant?: SurfaceVariant; onClose: () => void; onReview: () => void }) {
  const workspace = useGitWorkspace(cwd, webWorkspaceTransport)
  const { snapshot, preview, selected, busy, commitPreview } = workspace
  const [message, setMessage] = useState(() => readDraft(cwd))
  const [amend, setAmend] = useState(false)
  const [inspection, setInspection] = useState<Inspection | null>(null)
  const [content, setContent] = useState('')
  const [remoteBranches, setRemoteBranches] = useState(false)
  const branchList = remoteBranches ? snapshot?.remoteBranches.map(branch => branch.name) ?? [] : snapshot?.branches ?? []
  const [split, setSplit] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [workflowTarget, setWorkflowTarget] = useState<{ snapshot: WorkspaceSnapshot; context: Inspection | null; path: string | null; initialChoice?: string } | null>(null)
  const [conflictPath, setConflictPath] = useState<string | null>(null)
  const openActions = () => { if (snapshot) { setConflictPath(null); setWorkflowTarget({ snapshot, context: inspection, path: workspace.path }) } }
  // A merge, rebase, pull or stash pop that stopped on conflicts: resolve each file, then continue or abort.
  const conflictedPaths = snapshot?.files.filter(file => file.conflict).map(file => file.path) ?? []
  const openOperation = (initialChoice: 'operation-continue' | 'operation-abort') => { if (snapshot) { setConflictPath(null); setWorkflowTarget({ snapshot, context: null, path: null, initialChoice }) } }
  // Accept / reject beside each hunk of the diff on screen: accept stages it (or unstages it,
  // on the staged side), reject discards it from the working tree. Anchored under the hunk's
  // last changed row, on the side of the file that row belongs to.
  const rows = workspace.rows
  const [armedDiscard, setArmedDiscard] = useState<number | null>(null)
  const canDiscard = workspace.side === 'unstaged' && snapshot?.files.some(file => file.path === workspace.path && file.x !== '?' && !file.conflict) === true
  const hunkRows = useMemo(() => {
    const byHunk = new Map<number, number[]>()
    for (const row of rows) if (row.changed) byHunk.set(row.hunk, [...(byHunk.get(row.hunk) ?? []), row.index])
    return byHunk
  }, [rows])
  const hunkAnnotations = useMemo(() => {
    const annotations: PierreDiffAnnotation[] = []
    for (const [hunk, indices] of hunkRows) {
      const row = rows[indices[indices.length - 1]!]
      const added = row?.text.startsWith('+')
      const lineNumber = added ? row?.newLine : row?.oldLine
      if (lineNumber == null) continue
      annotations.push({ side: added ? 'additions' : 'deletions', lineNumber, metadata: { noteId: `hunk:${hunk}`, text: '', rangeLabel: '', kind: 'thread' } })
    }
    return annotations
  }, [rows, hunkRows])
  // Line comments on the diff on screen (threads, replies, resolve), beside the hunk actions.
  const comments = useDiffComments(workspace.path ?? '')
  const pathComments = useMemo(() => comments.lineAnnotations.filter(annotation => annotation.metadata.filePath === workspace.path), [comments.lineAnnotations, workspace.path])
  const diffAnnotations = useMemo(() => [...hunkAnnotations, ...pathComments], [hunkAnnotations, pathComments])
  const renderHunkActions = (annotation: PierreDiffAnnotation) => {
    const hunk = Number(annotation.metadata.noteId.slice('hunk:'.length))
    const indices = hunkRows.get(hunk)
    if (!indices) return null
    const armed = armedDiscard === hunk
    return <div className="git-hunk-actions" role="group" aria-label={`Hunk ${hunk + 1} actions`}>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => { setArmedDiscard(null); void workspace.actOnLines('patch', indices) }}>{workspace.side === 'staged' ? 'Unstage hunk' : 'Accept · stage hunk'}</Button>
      {canDiscard ? <Button size="sm" variant={armed ? 'destructive' : 'ghost'} disabled={busy} onClick={() => { if (armed) { setArmedDiscard(null); void workspace.actOnLines('discard', indices) } else setArmedDiscard(hunk) }}>{armed ? 'Confirm discard' : 'Reject · discard hunk'}</Button> : null}
      {armed ? <span className="git-hunk-hint">Restores the file text from the index; this cannot be undone.</span> : null}
    </div>
  }
  const closeAction = () => { setWorkflowTarget(null); setConflictPath(null); setInspection(null) }
  const stagedCount = filesForSide(snapshot?.files ?? [], 'staged').length
  useEffect(() => { try { localStorage.setItem(`git-commit-v1:${cwd}`, message) } catch {} }, [cwd, message])
  useEffect(() => {
    let live = true
    setContent('Loading…')
    if (inspection) void webWorkspaceTransport.inspect(cwd, inspection.kind, inspection.ref).then(value => { if (live) setContent(value || 'No differences from HEAD.') }).catch(error => { if (live) setContent(String(error)) })
    return () => { live = false }
  }, [cwd, inspection])
  const docked = isDocked(variant)
  return <div className={docked ? 'git-workspace-host docked' : 'git-workspace-host'} onClick={docked || busy ? undefined : onClose}>
    <section className="git-workspace" aria-label="Git workspace" onClick={event => event.stopPropagation()} onKeyDown={event => {
      event.stopPropagation()
      if (event.key === 'Escape' && !busy) { if (workflowTarget || conflictPath) closeAction(); else if (commitPreview) workspace.closeCommit(); else onClose() }
    }}>
      <header className="git-workspace-header">
        <GitBranch size={18} /><strong>Git workspace</strong><span className="git-workspace-path" title={snapshot?.root ?? cwd}>{snapshot?.root ?? cwd}</span>
        <Button variant="outline" size="sm" disabled={busy || !snapshot} onClick={openActions}>Git actions</Button>
        <Button variant="outline" size="sm" onClick={onReview} disabled={busy}>Review changes</Button>
        <Button variant="ghost" size="icon" aria-label="Refresh Git workspace" disabled={busy} onClick={() => void workspace.refresh()}><RefreshCw /></Button>
        <Button variant="ghost" size="icon" aria-label="Close Git workspace" disabled={busy} onClick={onClose}><X /></Button>
      </header>
      <div className="git-workspace-body">
        <aside className="git-workspace-sidebar" aria-label="Repository overview">
          <section className="git-workspace-section">
            <h3>1 · Status</h3><strong>{snapshot?.branch ?? 'Loading repository…'}</strong>
            <span>{snapshot?.upstream ?? 'No upstream'} · ↑{snapshot?.ahead ?? 0} ↓{snapshot?.behind ?? 0}</span>
            {snapshot?.operation ? <div role="status" className="git-operation-banner">
              <p>{snapshot.operation} in progress · {conflictedPaths.length > 0 ? `${conflictedPaths.length} conflicted file${conflictedPaths.length === 1 ? '' : 's'} to resolve` : 'all conflicts resolved'}</p>
              <div className="git-workspace-actions">
                {conflictedPaths.length > 0
                  ? <Button size="sm" disabled={busy} onClick={() => { setWorkflowTarget(null); setConflictPath(conflictedPaths[0]!) }}>Resolve next conflict</Button>
                  : snapshot.operation !== 'bisect' ? <Button size="sm" disabled={busy} onClick={() => openOperation('operation-continue')}>Continue {snapshot.operation}</Button> : null}
                {snapshot.operation !== 'bisect' ? <Button size="sm" variant="outline" disabled={busy} onClick={() => openOperation('operation-abort')}>Abort {snapshot.operation}</Button> : null}
              </div>
            </div> : null}
          </section>
          <section className="git-workspace-section files">
            <h3>2 · Changes <span>{snapshot?.files.length ?? 0}</span></h3>
            <div className="git-workspace-actions">
              {(['unstaged', 'staged'] as const).map(side => <Button key={side} variant={workspace.side === side ? 'secondary' : 'ghost'} size="sm" aria-pressed={workspace.side === side} disabled={busy} onClick={() => { workspace.setSide(side); setInspection(null) }}>{side === 'staged' ? 'Staged' : 'Unstaged'} {filesForSide(snapshot?.files ?? [], side).length}</Button>)}
            </div>
            <div className="git-workspace-list">
              {workspace.files.map(file => <button type="button" key={file.path} className="git-workspace-file" aria-current={!inspection && workspace.path === file.path ? 'true' : undefined} onClick={() => { workspace.setPath(file.path); setInspection(null) }} disabled={busy}>
                <code>{file.x}{file.y}</code><span title={file.path}>{file.path}</span>{file.conflict ? <span>conflict</span> : null}
              </button>)}
              {snapshot && workspace.files.length === 0 ? <p className="git-workspace-empty">No {workspace.side} changes</p> : null}
            </div>
            <div className="git-workspace-actions"><Button variant="outline" size="sm" disabled={busy || workspace.files.length === 0} onClick={() => void workspace.stageFiles(workspace.files.map(file => file.path))}>{workspace.side === 'staged' ? 'Unstage all' : 'Stage all'}</Button></div>
          </section>
          <section className="git-workspace-section"><h3>3 · Branches</h3><div className="git-workspace-actions"><Button variant="ghost" size="sm" onClick={() => setRemoteBranches(value => !value)}>{remoteBranches ? "Show local" : "Show remotes"}</Button></div><div className="git-workspace-list compact">{branchList.map(branch => <button type="button" key={branch} aria-current={inspection?.ref === branch ? 'true' : undefined} onClick={() => setInspection({ kind: remoteBranches ? 'remote-branch' : 'branch', ref: branch, label: branch })}>{branch === snapshot?.branch ? '● ' : ''}{branch}</button>)}</div></section>
          <section className="git-workspace-section"><h3>4 · Commits</h3><div className="git-workspace-list compact">{snapshot?.commits.map(commit => <button type="button" key={commit.sha} aria-current={inspection?.ref === commit.sha ? 'true' : undefined} onClick={() => setInspection({ kind: 'commit', ref: commit.sha, label: commit.subject })}><code>{commit.sha.slice(0, 7)}</code> {commit.subject}</button>)}</div></section>
          <section className="git-workspace-section"><h3>5 · Stashes</h3><div className="git-workspace-list compact">{snapshot?.stashes.map(stash => <button type="button" key={stash.sha + stash.label} onClick={() => setInspection({ kind: 'stash', ref: stash.sha, label: stash.label, selector: stash.selector })}>{stash.label}</button>)}{snapshot && snapshot.stashes.length === 0 ? <span className="git-workspace-empty">No stashes</span> : null}</div></section>
        </aside>
        <main className="git-workspace-detail">
          {workflowTarget ? <WorkflowPanel {...workflowTarget} busy={busy} error={workspace.error} onRun={workspace.workflow} onClose={closeAction} /> : conflictPath ? <ConflictEditor key={conflictPath} cwd={cwd} path={conflictPath} transport={webWorkspaceTransport} busy={busy} error={workspace.error} onRun={workspace.workflow} onClose={closeAction} /> : <>
          <div className="git-workspace-detail-header"><strong>{commitPreview ? `${amend ? 'Amend HEAD' : 'Commit'} · staged preview` : inspection?.label ?? workspace.path ?? 'Changes'}</strong>
            {!commitPreview && !inspection ? <div className="git-workspace-actions">
              {snapshot?.files.some(file => file.path === workspace.path && file.conflict) ? <Button variant="outline" size="sm" disabled={busy} onClick={() => setConflictPath(workspace.path)}>Resolve conflict</Button> : null}
              <Button variant="outline" size="sm" disabled={busy || !workspace.path || !preview} onClick={() => workspace.path && void workspace.stageFiles([workspace.path])}>{workspace.side === 'staged' ? 'Unstage file' : 'Stage file'}</Button>
              <Button variant="outline" size="sm" disabled={busy || !preview?.patch} aria-pressed={selecting} onClick={() => setSelecting(value => !value)}>{selecting ? 'View diff' : 'Select hunks / lines'}</Button>
              <Button variant="outline" size="sm" disabled={busy || selected.size === 0} onClick={() => void workspace.stageSelection()}>{workspace.side === 'staged' ? 'Unstage' : 'Stage'} selection ({selected.size})</Button>
              <Button variant="ghost" size="sm" aria-pressed={split} onClick={() => setSplit(value => !value)}>{split ? 'Unified' : 'Split'}</Button>
            </div> : null}
          </div>
          {workspace.error ? <div role="alert" className="git-workspace-error">{workspace.error}</div> : null}
          <div className="git-workspace-diff">
            {inspection && !commitPreview ? <pre>{content}</pre> : selecting && !commitPreview ? <PatchSelection key={`${workspace.side}:${workspace.path}:${preview?.revision}`} rows={rows} selected={selected} busy={busy} toggle={workspace.toggleLines} /> : (commitPreview?.patch ?? preview?.patch) ? <PierrePatchDiffView patch={commitPreview?.patch ?? preview!.patch} maxHeight={null} presentation={{ diffStyle: split ? 'split' : 'stacked', wrap: true }} lineAnnotations={commitPreview || !workspace.path ? undefined : diffAnnotations} renderAnnotation={commitPreview ? undefined : ((annotation: PierreDiffAnnotation) => annotation.metadata.noteId.startsWith('hunk:') ? renderHunkActions(annotation) : comments.renderAnnotation(annotation)) as never} selectedLines={commitPreview ? undefined : comments.selectedLines} onSelectedLinesChange={commitPreview ? undefined : comments.onSelectedLinesChange} onGutterUtilityClick={commitPreview ? undefined : comments.onGutterUtilityClick} /> : <p className="git-workspace-empty">{snapshot ? 'No changes to display.' : 'Loading…'}</p>}
          </div>
          <div className="git-workspace-commit">
            <label htmlFor="git-workspace-message">Commit message</label>
            <Textarea id="git-workspace-message" value={message} onChange={event => { setMessage(event.target.value); workspace.closeCommit() }} placeholder="Describe the staged changes…" disabled={busy} rows={3} />
            <div className="git-workspace-actions">
              <label className="git-workspace-amend"><input type="checkbox" checked={amend} disabled={busy || !snapshot?.head} onChange={event => { setAmend(event.target.checked); workspace.closeCommit(); if (event.target.checked && !message) setMessage(snapshot?.lastMessage ?? '') }} />Amend HEAD</label>
              {commitPreview ? <><Button size="sm" disabled={busy || !message.trim()} onClick={async () => { if (await workspace.commit(message, amend)) { setMessage(''); setAmend(false) } }}>{busy ? 'Committing…' : amend ? 'Confirm amend' : 'Confirm commit'}</Button><Button size="sm" variant="ghost" disabled={busy} onClick={workspace.closeCommit}>Back to changes</Button></> : <Button size="sm" disabled={busy || (!stagedCount && !amend) || !message.trim() || Boolean(snapshot?.operation)} onClick={() => void workspace.prepareCommit()}>Review {stagedCount} staged files</Button>}
            </div>
            {amend ? <p>Amending replaces the HEAD commit, including its staged changes and message.</p> : null}
          </div>
          </>}
        </main>
      </div>
      <footer aria-live="polite">{busy ? 'Git operation running…' : workspace.output || 'Choose a file → stage hunks or lines → review staged changes → commit'}{workspace.output ? <details><summary>Command output</summary><pre>{workspace.output}</pre></details> : null}</footer>
    </section>
  </div>
}
