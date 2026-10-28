import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { filesForSide, patchRows, type IndexSide, type WorkflowDraft, type WorkspaceAction, type WorkspacePreview, type WorkspaceSnapshot, type WorkspaceTransport } from './workspaceTypes'

export function useGitWorkspace(cwd: string, transport: WorkspaceTransport) {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null)
  const [side, setSide] = useState<IndexSide>('unstaged')
  const [path, setPath] = useState<string | null>(null)
  const [preview, setPreview] = useState<WorkspacePreview | null>(null)
  const [selected, setSelected] = useState<Set<number>>(() => new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [output, setOutput] = useState('')
  const [commitPreview, setCommitPreview] = useState<{ snapshot: WorkspaceSnapshot; patch: string } | null>(null)
  const generation = useRef(0), reads = useRef(0), operation = useRef(false)
  useEffect(() => { generation.current++; return () => { generation.current++ } }, [cwd])
  const refresh = useCallback(async () => {
    const scope = generation.current, request = ++reads.current
    try {
      const next = await transport.snapshot(cwd)
      if (scope === generation.current && request === reads.current && !operation.current) { setSnapshot(next); setError(null) }
    } catch (error) { if (scope === generation.current && request === reads.current && !operation.current) setError(error instanceof Error ? error.message : String(error)) }
  }, [cwd, transport])
  useEffect(() => { void refresh() }, [refresh])
  const files = useMemo(() => filesForSide(snapshot?.files ?? [], side), [snapshot?.files, side])
  const rows = useMemo(() => patchRows(preview?.patch ?? ''), [preview?.patch])
  const activePath = files.some(file => file.path === path) ? path : files[0]?.path ?? null
  useEffect(() => {
    let live = true
    setPreview(null); setSelected(new Set())
    if (snapshot && activePath) void transport.preview(cwd, side, activePath).then(next => {
      if (live) setPreview(next)
    }).catch(error => { if (live) setError(error instanceof Error ? error.message : String(error)) })
    return () => { live = false }
  }, [cwd, transport, side, activePath, snapshot?.revision])
  const run = useCallback(async (action: WorkspaceAction) => {
    if (operation.current) return false
    operation.current = true
    reads.current++
    const scope = generation.current
    setBusy(true); setError(null)
    try {
      const result = await transport.act(cwd, crypto.randomUUID(), action)
      if (scope === generation.current) { setSnapshot(result.snapshot); setOutput(result.output); setError(result.error ?? null); setCommitPreview(null); setSelected(new Set()) }
      return !result.error
    } catch (error) {
      if (scope === generation.current) setError(error instanceof Error ? error.message : String(error))
      return false
    } finally { operation.current = false; setBusy(previous => scope === generation.current ? false : previous) }
  }, [cwd, transport])
  const toggleLines = useCallback((indices: number[]) => setSelected(previous => {
    const next = new Set(previous), all = indices.every(index => next.has(index))
    indices.forEach(index => all ? next.delete(index) : next.add(index))
    return next
  }), [])
  const stageFiles = useCallback((paths: string[]) => snapshot ? run({ kind: side === 'staged' ? 'unstage' : 'stage', paths, revision: snapshot.revision }) : Promise.resolve(false), [snapshot, run, side])
  const stageSelection = useCallback(() => preview?.path ? run({ kind: 'patch', path: preview.path, side: preview.side, revision: preview.revision, patch: preview.patch, lines: [...selected] }) : Promise.resolve(false), [preview, run, selected])
  const prepareCommit = useCallback(async () => {
    if (operation.current) return false
    const scope = generation.current
    operation.current = true; reads.current++; setBusy(true); setError(null)
    try {
      const next = await transport.snapshot(cwd), staged = await transport.preview(cwd, 'staged', null)
      if (staged.revision !== next.revision) throw new Error('Repository changed. Review again.')
      if (scope === generation.current) { setSnapshot(next); setCommitPreview({ snapshot: next, patch: staged.patch }); return true }
      return false
    } catch (error) { if (scope === generation.current) setError(error instanceof Error ? error.message : String(error)); return false }
    finally { operation.current = false; setBusy(previous => scope === generation.current ? false : previous) }
  }, [cwd, transport])
  const workflow = useCallback((action: WorkflowDraft, revision = snapshot?.workflowRevision) => revision ? run({ ...action, revision }) : Promise.resolve(false), [snapshot?.workflowRevision, run])
  const commit = useCallback((message: string, amend: boolean) => commitPreview
    ? run({ kind: 'commit', message, amend, head: commitPreview.snapshot.head, indexRevision: commitPreview.snapshot.indexRevision })
    : Promise.resolve(false), [commitPreview, run])
  return { snapshot, side, setSide, path: activePath, setPath, files, preview, rows, selected, toggleLines,
    busy, error, output, refresh, workflow, stageFiles, stageSelection, commitPreview, prepareCommit, commit, closeCommit: () => setCommitPreview(null) }
}
