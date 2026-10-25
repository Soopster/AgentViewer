'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { chooseConflictBlock, conflictBlocks } from '@/lib/git/conflictText'
import type { ConflictPreview, WorkflowDraft, WorkspaceTransport } from '@/lib/git/workspaceTypes'
export function ConflictEditor({ cwd, path, transport, busy, error, onRun, onClose }: { cwd: string; path: string; transport: WorkspaceTransport; busy: boolean; error: string | null; onRun: (action: WorkflowDraft, revision: string) => Promise<boolean>; onClose: () => void }) {
  const [conflict, setConflict] = useState<ConflictPreview | null>(null)
  const [content, setContent] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [version, setVersion] = useState<'base' | 'ours' | 'theirs'>('ours')
  const [pending, setPending] = useState<WorkflowDraft | null>(null)
  useEffect(() => {
    let live = true
    void transport.conflict(cwd, path).then(next => { if (live) { setConflict(next); setContent(next.working ?? '') } }).catch(error => { if (live) setLoadError(String(error)) })
    return () => { live = false }
  }, [cwd, path, transport])
  const blocks = conflictBlocks(content)
  const apply = async () => { if (pending && conflict && await onRun(pending, conflict.revision)) onClose() }
  return <section className="git-workflow-panel" aria-label="Resolve Git conflict">
    <div className="git-workspace-detail-header"><strong>Resolve {path}</strong><Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Back to workspace</Button></div>
    <div className="git-workflow-content">
      {loadError || error ? <p role="alert" className="git-workspace-error">{loadError ?? error}</p> : null}
      {!conflict ? <p>Loading conflict versions…</p> : pending ? <>
        <p>{pending.kind === 'conflict-save' ? 'Save the edited result and stage this file as resolved?' : pending.kind === 'resolve' && pending.choice === 'working' ? 'Stage the current working file as resolved?' : `Replace the working file with ${pending.kind === 'resolve' ? pending.choice : ''} and stage it? A missing version deletes the file.`}</p>
        <p>Target: {path}</p><div className="git-workspace-actions"><Button size="sm" disabled={busy} onClick={() => void apply()}>Confirm resolution</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => setPending(null)}>Keep editing</Button></div>
      </> : <>
        <p>Base is the common ancestor. During rebase, ours is the branch being rebased onto; theirs is the commit being replayed.</p>
        <div className="git-workspace-actions">{(['base', 'ours', 'theirs'] as const).map(side => <Button size="sm" key={side} variant={version === side ? 'secondary' : 'ghost'} onClick={() => setVersion(side)}>{side}</Button>)}</div>
        <pre className="git-conflict-version">{!conflict[version] ? '(file absent in this version)' : conflict[version]?.binary ? '(binary, symlink, or submodule content)' : conflict[version]?.content}</pre>
        <label htmlFor="git-conflict-result">Resolved result · {blocks.length} conflict blocks remaining</label>
        {conflict.editable ? <Textarea id="git-conflict-result" rows={12} value={content} disabled={busy} onChange={event => setContent(event.target.value)} /> : <p>Text editing is unavailable for this file. Choose a whole-file version or resolve it in an external editor.</p>}
        {blocks.length > 0 ? <div className="git-workspace-actions"><span>Resolve first remaining block:</span>{(['ours', 'theirs', 'both'] as const).map(choice => <Button key={choice} size="sm" variant="outline" disabled={busy} onClick={() => setContent(value => chooseConflictBlock(value, 0, choice))}>Use {choice} block</Button>)}</div> : null}
        <div className="git-workspace-actions"><Button size="sm" disabled={busy || !conflict.editable || blocks.length > 0} onClick={() => setPending({ kind: 'conflict-save', path, content })}>Save and mark resolved</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => setPending({ kind: 'resolve', path, choice: 'ours' })}>Use ours file</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => setPending({ kind: 'resolve', path, choice: 'theirs' })}>Use theirs file</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => setPending({ kind: 'resolve', path, choice: 'working' })}>Mark working file resolved</Button></div>
      </>}
    </div>
  </section>
}
