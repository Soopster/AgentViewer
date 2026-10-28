/** @jsxImportSource @opentui/react */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { TextareaRenderable } from '@opentui/core'
import type { GitPopoverProps, GitKeyEvent } from './GitPopover'
import { useGitWorkspace } from '../../../lib/git/useGitWorkspace'
import { localWorkspaceTransport } from '../../../lib/git/workspaceService'
import { filesForSide, patchRows } from '../../../lib/git/workspaceTypes'
import { readCommitDraft, writeCommitDraft } from '../../../lib/git/commitDraft'
import { GitDivider } from './GitDivider'
import { GitWorkflowMenu } from './GitWorkflowMenu'
import { GitConflictEditor } from './GitConflictEditor'
import type { WorkspaceSnapshot } from '../../../lib/git/workspaceTypes'
import type { WorkflowContext } from '../../../lib/git/workflowMenu'
import { DiffCodeText, useWindowVisible } from '../../../tui/opentui/shell/sdkDiff'
import { PopoverDetachButton } from '../../../tui/opentui/shell/sdk'

type Section = 'files' | 'branches' | 'commits' | 'stashes'
export function GitWorkspace({ cwd, theme, width, height, docked, zIndex = 50, onClose, onReview, onKeyHandlerReady, onKeyCaptureChange, onDetach, embedded = false, startCompose = false, onRepositoryChange, onBusyChange, refreshRevision }: GitPopoverProps & { onReview: () => void; startCompose?: boolean }) {
  const visible = useWindowVisible()
  const root = cwd || process.cwd(), workspace = useGitWorkspace(root, localWorkspaceTransport)
  useEffect(() => { if (refreshRevision !== undefined) void workspace.refresh() }, [refreshRevision, workspace.refresh])
  const { snapshot, side, files, path, preview, busy, selected, commitPreview } = workspace
  const [section, setSection] = useState<Section>('files')
  const [remoteBranches, setRemoteBranches] = useState(false)
  const branchList = remoteBranches ? snapshot?.remoteBranches.map(branch => branch.name) ?? [] : snapshot?.branches ?? []
  const [cursor, setCursor] = useState(0)
  const [diffCursor, setDiffCursor] = useState(0)
  const [anchor, setAnchor] = useState<number | null>(null)
  const [focus, setFocus] = useState<'list' | 'diff' | 'compose' | 'confirm'>(startCompose ? 'compose' : 'list')
  useEffect(() => { if (startCompose) setFocus('compose') }, [startCompose])
  useEffect(() => { onRepositoryChange?.() }, [snapshot?.revision, snapshot?.workflowRevision, snapshot?.head, onRepositoryChange])
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false) }, [busy, onBusyChange])
  const [message, setMessage] = useState(() => readCommitDraft(root))
  const [amend, setAmend] = useState(false)
  const [inspection, setInspection] = useState<{ kind: 'branch' | 'remote-branch' | 'commit' | 'stash'; ref: string; label: string; selector?: string } | null>(null)
  const [content, setContent] = useState('')
  const [pan, setPan] = useState(0)
  const [workflowTarget, setWorkflowTarget] = useState<{ snapshot: WorkspaceSnapshot; context: WorkflowContext; path: string | null } | null>(null)
  const [conflictPath, setConflictPath] = useState<string | null>(null)
  const workflowKey = useRef<(key: GitKeyEvent) => boolean | void>(() => {})
  const openActions = useCallback(() => { if (snapshot) { setConflictPath(null); setWorkflowTarget({ snapshot, context: inspection, path }) } }, [snapshot, inspection, path])
  const closeAction = useCallback(() => { setWorkflowTarget(null); setConflictPath(null); setInspection(null); setSection('files'); setFocus('list') }, [])
  const editor = useRef<TextareaRenderable | null>(null)
  const popW = Math.max(20, docked ? width : width - 2), popH = Math.max(8, docked ? height : height - 2)
  const [filePaneWidth, setFilePaneWidth] = useState<number | null>(null)
  const narrow = popW < 72
  const leftW = narrow ? 0 : Math.max(24, Math.min(filePaneWidth ?? Math.min(46, Math.floor(popW * .32)), Math.floor(popW * .65), popW - 24))
  const rightW = Math.max(12, popW - leftW - 3)
  const currentPatch = commitPreview ? commitPreview.patch : inspection ? content : preview?.patch ?? ''
  const rows = useMemo(() => commitPreview || inspection ? patchRows(currentPatch) : workspace.rows, [commitPreview, inspection, currentPatch, workspace.rows])
  const compose = focus === 'compose' || focus === 'confirm'
  const footerRows = workspace.error ? 2 : 1
  const viewH = Math.max(1, popH - 6 - footerRows - (compose ? 7 : 0))
  const visibleStart = Math.max(0, Math.min(diffCursor - Math.floor(viewH / 2), rows.length - viewH))
  useEffect(() => { const timer = setTimeout(() => writeCommitDraft(root, message), 200); return () => clearTimeout(timer) }, [root, message])
  useEffect(() => { setDiffCursor(Math.max(0, patchRows(preview?.patch ?? '').findIndex(row => row.text.startsWith('@@ ')))); setAnchor(null); setPan(0) }, [preview, inspection, commitPreview])
  useEffect(() => {
    let live = true
    setContent('Loading…')
    if (inspection) void localWorkspaceTransport.inspect(root, inspection.kind, inspection.ref).then(value => { if (live) setContent(value || 'No differences from HEAD.') }).catch(error => { if (live) setContent(String(error)) })
    return () => { live = false }
  }, [root, inspection])
  useLayoutEffect(() => { onKeyCaptureChange?.(Boolean(visible && (compose || workflowTarget || conflictPath))); return () => onKeyCaptureChange?.(false) }, [visible, compose, workflowTarget, conflictPath, onKeyCaptureChange])
  const selectItem = useCallback((nextSection: Section, index: number) => {
    setSection(nextSection); setCursor(index); setFocus('list')
    if (nextSection === 'files') { setInspection(null); if (files[index]) workspace.setPath(files[index]!.path) }
    if (nextSection === 'branches' && branchList[index]) setInspection({ kind: remoteBranches ? 'remote-branch' : 'branch', ref: branchList[index]!, label: branchList[index]! })
    if (nextSection === 'commits' && snapshot?.commits[index]) setInspection({ kind: 'commit', ref: snapshot.commits[index]!.sha, label: snapshot.commits[index]!.subject })
    if (nextSection === 'stashes' && snapshot?.stashes[index]) setInspection({ kind: 'stash', ref: snapshot.stashes[index]!.sha, label: snapshot.stashes[index]!.label, selector: snapshot.stashes[index]!.selector })
  }, [files, snapshot, workspace.setPath, branchList, remoteBranches])
  const submit = useCallback(async () => {
    if (!message.trim()) return
    if (await workspace.commit(message, amend)) { setMessage(''); writeCommitDraft(root, ''); setAmend(false); setFocus('list') }
  }, [workspace.commit, message, amend, root])
  const reviewCommit = useCallback(async () => { if (message.trim() && await workspace.prepareCommit()) setFocus('confirm') }, [message, workspace.prepareCommit])
  const handleKey = useCallback((key: GitKeyEvent) => {
    if (workflowTarget || conflictPath) return workflowKey.current(key)
    if (busy) return
    if (focus === 'confirm') {
      if (key.name === 'escape') { workspace.closeCommit(); setFocus('compose') }
      else if (key.name === 'return') void submit()
      return
    }
    if (focus === 'compose') {
      if (key.name === 'escape') { writeCommitDraft(root, message); setFocus('list'); return }
      else if (key.ctrl && (key.name === 'return' || key.name === 's')) {
        void reviewCommit(); return
      }
      return false
    }
    if (key.sequence === ':' || key.sequence === '?') { if (!snapshot) return false; openActions(); return }
    if (key.sequence === 'f' && path && snapshot?.files.some(file => file.path === path && file.conflict)) { setConflictPath(path); return }
    if (key.name === 'escape') { onClose(); return }
    if (embedded && ['3', '4', '5', 'B'].includes(key.sequence)) return
    if (key.sequence === 'B') {
      const next = remoteBranches ? snapshot?.branches[0] : snapshot?.remoteBranches[0]?.name
      setRemoteBranches(value => !value); setSection('branches'); setCursor(0)
      setInspection(next ? { kind: remoteBranches ? 'branch' : 'remote-branch', ref: next, label: next } : null)
      return
    }
    if (key.sequence === 'G') { onReview(); return }
    if (key.sequence === 'r') { void workspace.refresh(); return }
    if (key.sequence === 'c') { setFocus('compose'); return }
    if (key.sequence === 'A' && snapshot?.head) { setAmend(value => !value); if (!message) setMessage(snapshot.lastMessage); setFocus('compose'); return }
    if (key.sequence === 't') { workspace.setSide(side === 'staged' ? 'unstaged' : 'staged'); setInspection(null); setSection('files'); setCursor(0); return }
    const sectionFor = { '1': 'files', '2': 'files', '3': 'branches', '4': 'commits', '5': 'stashes' } as const
    if (key.sequence in sectionFor) { selectItem(sectionFor[key.sequence as keyof typeof sectionFor], 0); return }
    if (key.name === 'tab') { setFocus(value => value === 'diff' ? 'list' : 'diff'); return }
    if (key.sequence === 'v' && focus === 'diff') { setAnchor(value => value === null ? diffCursor : null); return }
    if ((key.sequence === 'a' || key.sequence === ' ') && focus === 'diff' && !inspection) {
      const row = rows[diffCursor]
      const indices = key.sequence === 'a' ? rows.filter(item => row && item.hunk === row.hunk && item.changed).map(item => item.index)
        : rows.filter(item => item.changed && item.index >= Math.min(anchor ?? diffCursor, diffCursor) && item.index <= Math.max(anchor ?? diffCursor, diffCursor)).map(item => item.index)
      workspace.toggleLines(indices); setAnchor(null); return
    }
    if (key.sequence === 's' && focus === 'diff' && !inspection) { void workspace.stageSelection(); return }
    if (key.sequence === ' ' && focus === 'list' && section === 'files' && path) { void workspace.stageFiles([path]); return }
    if (key.sequence === 'a' && focus === 'list' && section === 'files') { void workspace.stageFiles(files.map(file => file.path)); return }
    if (key.name === 'return') { setFocus('diff'); return }
    if (key.name === 'left' || key.sequence === 'h') { setPan(value => Math.max(0, value - 8)); return }
    if (key.name === 'right' || key.sequence === 'l') { setPan(value => value + 8); return }
    const delta = key.name === 'down' || key.sequence === 'j' ? 1 : key.name === 'up' || key.sequence === 'k' ? -1 : key.name === 'pagedown' ? viewH : key.name === 'pageup' ? -viewH : 0
    if (delta) {
      if (focus === 'diff') { if (key.shift && anchor === null) setAnchor(diffCursor); setDiffCursor(value => Math.max(0, Math.min(rows.length - 1, value + delta))) }
      else {
        const count = section === 'files' ? files.length : section === 'branches' ? branchList.length : section === 'commits' ? snapshot?.commits.length ?? 0 : snapshot?.stashes.length ?? 0
        selectItem(section, Math.max(0, Math.min(count - 1, cursor + delta)))
      }
    }
  }, [workflowTarget, conflictPath, openActions, busy, focus, workspace, root, message, submit, reviewCommit, onClose, onReview, snapshot, embedded, side, selectItem, diffCursor, anchor, rows, section, files, path, viewH, cursor, branchList, remoteBranches])
  useEffect(() => { onKeyHandlerReady(handleKey) }, [handleKey, onKeyHandlerReady])
  const sidebarH = Math.max(1, popH - 6)
  const overviewH = Math.max(2, Math.floor((sidebarH - 5) / 5))
  const fileH = Math.max(2, sidebarH - 5 - overviewH * 3)
  const listSection = (kind: Section, title: string, labels: string[], budget: number) => {
    const index = kind === 'files' ? Math.max(0, files.findIndex(file => file.path === path)) : section === kind ? cursor : 0
    const start = Math.max(0, index - Math.floor((budget - 1) / 2))
    return <box key={kind} height={budget} flexShrink={0} flexDirection="column" border={['bottom']} borderColor={theme.border}>
      <box height={1} onMouseDown={() => selectItem(kind, 0)} backgroundColor={section === kind && focus === 'list' ? theme.surface3 : undefined}><text fg={section === kind ? theme.cyan : theme.muted} wrapMode="none">{title} ({labels.length})</text></box>
      {labels.slice(start, start + Math.max(0, budget - 2)).map((label, offset) => <box key={start + offset} height={1} flexShrink={0} backgroundColor={section === kind && index === start + offset ? theme.surface3 : undefined} onMouseDown={event => { if (event.button === 0) { event.stopPropagation(); selectItem(kind, start + offset) } }}><text fg={section === kind && index === start + offset ? theme.cyan : theme.text} wrapMode="none">{label}</text></box>)}
      {labels.length === 0 ? <text fg={theme.dim}>empty</text> : null}
    </box>
  }
  const firstDiffRow = Math.min(Math.max(0, diffCursor), rows.length - 1)
  return <box position={docked ? undefined : 'absolute'} left={docked ? undefined : 1} top={docked ? undefined : 1} width={popW} height={popH} border={docked ? [] : true} borderColor={theme.border2} backgroundColor={theme.surface} zIndex={docked ? undefined : zIndex} flexDirection="column" title={docked ? undefined : ' Git workspace '} titleColor={theme.cyan}>
    {!docked && onDetach ? <PopoverDetachButton theme={theme} onPress={onDetach} /> : null}
    <box height={1} paddingX={1} flexDirection="row" flexShrink={0}>
      <text fg={theme.green} wrapMode="none">{`${snapshot?.branch ?? 'Loading…'}  ↑${snapshot?.ahead ?? 0} ↓${snapshot?.behind ?? 0} `}</text>
      <box onMouseDown={() => { if (!busy) onReview() }}><text fg={theme.cyan}>[G Annotated review] </text></box>
      <box onMouseDown={() => { if (!busy) openActions() }}><text fg={theme.cyan}>[: Actions]</text></box>
    </box>
    <box flexGrow={1} minHeight={1} flexDirection="row">
      {!narrow ? <box width={leftW} flexShrink={0} flexDirection="column" paddingX={1}>
        {!embedded ? <box height={3} flexShrink={0} flexDirection="column"><text fg={theme.cyan}>[1] Status</text><text fg={theme.muted} wrapMode="none">{snapshot?.operation ?? snapshot?.upstream ?? 'No upstream'}</text></box> : null}
        {listSection('files', `[2] ${side === 'staged' ? 'Staged' : 'Unstaged'} · t switch`, files.map(file => `${file.x}${file.y} ${file.path}`), embedded ? sidebarH : fileH)}
        {!embedded ? <>{listSection('branches', remoteBranches ? '[3] Remotes · B local' : '[3] Branches · B remotes', branchList.map(branch => `${branch === snapshot?.branch ? '● ' : ''}${branch}`), overviewH)}
        {listSection('commits', '[4] Commits', snapshot?.commits.map(commit => `${commit.sha.slice(0, 7)} ${commit.subject}`) ?? [], overviewH)}
        {listSection('stashes', '[5] Stashes', snapshot?.stashes.map(stash => stash.label) ?? [], overviewH)}</> : null}
        <box position="absolute" top={0} right={0} width={1} height={sidebarH}><GitDivider id="git-staging-divider" vertical width={1} height={sidebarH} size={leftW} theme={theme} onResize={value => setFilePaneWidth(Math.max(24, Math.min(value, Math.floor(popW * .65), popW - 24)))} /></box>
      </box> : null}
      <box flexGrow={1} minWidth={0} flexDirection="column">
        <box height={1} flexShrink={0} paddingX={1}><text fg={theme.cyan} wrapMode="none">{commitPreview ? `${amend ? 'Amend HEAD' : 'Commit'} · staged preview` : inspection?.label ?? `${side}: ${path ?? 'clean'}`}</text></box>
        <box height={1} flexShrink={0} paddingX={1} flexDirection="row">
          <box onMouseDown={() => { if (!busy) { workspace.setSide(side === 'staged' ? 'unstaged' : 'staged'); setInspection(null) } }}><text fg={theme.cyan}>[t staged/unstaged] </text></box>
          <box onMouseDown={() => { if (!busy) setFocus('compose') }}><text fg={theme.cyan}>[c commit] </text></box>
          <text fg={theme.dim} wrapMode="none">{`${selected.size} lines selected`}</text>
        </box>
        <box flexGrow={1} minHeight={1} flexDirection="column" overflow="hidden">
          {rows.slice(visibleStart, visibleStart + viewH).map((row, offset) => {
            const rowIndex = visibleStart + offset, active = rowIndex === firstDiffRow && focus === 'diff'
            const range = anchor !== null && rowIndex >= Math.min(anchor, diffCursor) && rowIndex <= Math.max(anchor, diffCursor)
            return <box key={row.index} height={1} flexShrink={0} width={rightW} backgroundColor={active || range || selected.has(row.index) ? theme.surface3 : undefined} onMouseDown={event => {
              if (event.button !== 0 || busy || compose) return
              event.stopPropagation(); setFocus('diff'); setDiffCursor(rowIndex)
              if (row.changed && !inspection && !commitPreview) workspace.toggleLines([row.index])
              else if (row.text.startsWith('@@ ') && !inspection && !commitPreview) workspace.toggleLines(rows.filter(item => item.hunk === row.hunk && item.changed).map(item => item.index))
            }}>
              <text fg={selected.has(row.index) ? theme.green : active ? theme.cyan : theme.dim} wrapMode="none">{selected.has(row.index) ? '[x]' : row.changed ? '[ ]' : '   '}</text>
              <DiffCodeText text={row.text || ' '} columns={rightW - 3} tabWidth={4} wrap={false} offset={pan} fg={row.text.startsWith('+') ? theme.green : row.text.startsWith('-') ? theme.red : row.text.startsWith('@@') ? theme.cyan : theme.text} />
            </box>
          })}
          {!currentPatch ? <text fg={theme.dim}>{snapshot ? 'No changes to display.' : 'Loading…'}</text> : null}
        </box>
        {compose ? <box height={7} flexShrink={0} paddingX={1} flexDirection="column">
          <text fg={theme.cyan}>{`${amend ? 'Amend HEAD' : 'Commit message'} · ${filesForSide(snapshot?.files ?? [], 'staged').length} staged files`}</text>
          {focus === 'compose' ? <box height={4} border borderColor={theme.cyan}><textarea key={root} id="git-workspace-message" ref={editor} focused={visible && focus === 'compose'} initialValue={message} width="100%" height="100%" placeholder="Describe the staged changes…" onContentChange={() => setMessage(editor.current?.plainText ?? '')} /></box>
            : <box height={4} flexDirection="column"><text fg={theme.text} wrapMode="word">{message}</text></box>}
          <box onMouseDown={() => { if (busy) return; if (focus === 'confirm') void submit(); else void reviewCommit() }}><text fg={theme.amber} wrapMode="none">{focus === 'confirm' ? 'Enter confirms · Esc edits · preview above' : 'Ctrl+Enter reviews staged diff · Esc saves draft'}</text></box>
        </box> : null}
      </box>
    </box>
    {workspace.error ? <box height={1} flexShrink={0} paddingX={1}><text fg={theme.red} wrapMode="none">{workspace.error}</text></box> : null}
    <box height={1} flexShrink={0} paddingX={1}><text fg={busy ? theme.amber : theme.dim} wrapMode="none">{busy ? 'Git operation running…' : workspace.output || ': Git actions · f resolve conflict · Space stage · a all/hunk · Tab diff · s apply · c commit · A amend · r refresh'}</text></box>
    {workflowTarget ? <GitWorkflowMenu {...workflowTarget} theme={theme} width={popW} height={popH} busy={busy} error={workspace.error} onRun={workspace.workflow} onClose={closeAction} onKeyHandlerReady={handler => { workflowKey.current = handler }} /> : null}
    {conflictPath ? <GitConflictEditor key={conflictPath} cwd={root} path={conflictPath} theme={theme} width={popW} height={popH} busy={busy} error={workspace.error} onRun={workspace.workflow} onClose={closeAction} onKeyHandlerReady={handler => { workflowKey.current = handler }} /> : null}
  </box>
}
