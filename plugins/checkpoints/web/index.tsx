'use client'

// Web entry for Checkpoints & review: its own chunk, loaded on first open.
// The same operations as the TUI's ⇧U popover, through the `checkpoints`
// service: every turn's snapshot, what changed since it, restoring a file or
// the whole tree, and the working diff as hunks to reject, commit or PR.
import { useCallback, useEffect, useState } from 'react'
import { PLUGIN_API_VERSION, type PluginViewModule } from '@/lib/plugins/types'
import type { WebPluginView, WebPluginViewProps } from '@/components/shell/pluginTypes'
import type { CheckpointFileChange, TurnCheckpoint, WorkingDiffHunk } from '@/lib/plugins/checkpoints'

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
const ago = (at: number) => {
  const minutes = Math.round((Date.now() - at) / 60_000)
  return minutes < 1 ? 'now' : minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.round(minutes / 60)}h` : `${Math.round(minutes / 1440)}d`
}
const STATUS_COLOR: Record<CheckpointFileChange['status'], string> = { A: 'var(--green, #3fb950)', M: 'var(--amber, #d29922)', D: 'var(--red, #f85149)' }

function DiffText({ text }: { text: string }) {
  if (!text.trim()) return <div style={{ color: 'var(--text-2)' }}>No differences.</div>
  return (
    <pre data-checkpoint-diff style={{ margin: 0, fontFamily: 'var(--font-mono, monospace)', fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre', overflow: 'auto' }}>
      {text.split('\n').map((line, index) => (
        <div key={index} style={{ color: line.startsWith('+') && !line.startsWith('+++') ? 'var(--green, #3fb950)' : line.startsWith('-') && !line.startsWith('---') ? 'var(--red, #f85149)' : line.startsWith('@@') ? 'var(--cyan, #39c5cf)' : 'var(--text-2)' }}>{line || ' '}</div>
      ))}
    </pre>
  )
}

function Checkpoints({ services, placement, close }: WebPluginViewProps) {
  const cwd = services.repository!.cwd
  const checkpoints = services.checkpoints!
  const session = services.session?.session ?? null
  const docked = placement !== 'overlay'
  const [tab, setTab] = useState<'turns' | 'review'>('turns')
  const [list, setList] = useState<TurnCheckpoint[] | null>(null)
  const [working, setWorking] = useState<{ hunks: WorkingDiffHunk[]; untracked: string[] } | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [changes, setChanges] = useState<CheckpointFileChange[] | null>(null)
  const [file, setFile] = useState<string | null>(null)
  const [diff, setDiff] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [commitMessage, setCommitMessage] = useState('')
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([checkpoints.list(cwd, controller.signal), checkpoints.working(cwd, controller.signal)])
      .then(([next, tree]) => { if (!controller.signal.aborted) { setList(next); setWorking(tree); setError(null) } })
      .catch(cause => { if (!controller.signal.aborted) setError(message(cause)) })
    return () => controller.abort()
  }, [checkpoints, cwd, generation])
  useEffect(() => {
    if (!selected) { setChanges(null); return undefined }
    const controller = new AbortController()
    checkpoints.changes(cwd, selected, controller.signal)
      .then(next => { if (!controller.signal.aborted) setChanges(next) })
      .catch(cause => { if (!controller.signal.aborted) setError(message(cause)) })
    return () => controller.abort()
  }, [checkpoints, cwd, selected, generation])
  useEffect(() => {
    if (!selected) { setDiff(null); return undefined }
    const controller = new AbortController()
    setDiff(null)
    checkpoints.diff(cwd, selected, file ?? undefined, undefined, controller.signal)
      .then(next => { if (!controller.signal.aborted) setDiff(next) })
      .catch(cause => { if (!controller.signal.aborted) setError(message(cause)) })
    return () => controller.abort()
  }, [checkpoints, cwd, selected, file, generation])
  useEffect(() => {
    if (docked) return undefined
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [docked, close])

  // Every change to the tree confirms first (a second click), then re-reads.
  const run = useCallback(async (key: string, action: () => Promise<string>) => {
    if (confirm !== key) { setConfirm(key); return }
    setConfirm(null); setBusy(true); setError(null)
    try { setNotice(await action()); setGeneration(value => value + 1) } catch (cause) { setError(message(cause)) } finally { setBusy(false) }
  }, [confirm])
  const context = session ? { sessionId: session.sessionId, provider: session.provider, providerInstanceId: session.providerInstanceId } : undefined
  const checkpoint = list?.find(entry => entry.sha === selected) ?? null
  const button = (key: string, label: string, action: () => Promise<string>, danger = true) => (
    <button type="button" disabled={busy} data-checkpoint-action={key} onClick={() => { void run(key, action) }}
      style={{ fontSize: 12, color: confirm === key && danger ? 'var(--red, #f85149)' : undefined }}>{confirm === key ? `${label}? click again` : label}</button>
  )

  const turns = (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 300px) 1fr', minHeight: 0, flex: 1 }}>
      <div style={{ overflow: 'auto', borderRight: '1px solid var(--border)' }}>
        {list === null ? <div style={{ padding: 12, color: 'var(--text-2)' }}>Reading checkpoints…</div>
          : list.length === 0 ? <div style={{ padding: 12, color: 'var(--text-2)' }}>No checkpoints yet. Every agent turn in this repository takes one before it runs.</div>
          : list.map(entry => (
            <button key={entry.ref} type="button" data-checkpoint={entry.sha} onClick={() => { setSelected(entry.sha); setFile(null); setConfirm(null) }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 12px', border: 'none', borderBottom: '1px solid var(--border)', background: entry.sha === selected ? 'var(--surface-3)' : 'transparent', color: 'var(--text)', cursor: 'pointer' }}>
              <div style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.label || '(no prompt)'}</div>
              <div style={{ fontSize: 11, color: 'var(--text-2)' }}>{ago(entry.createdAt)}{entry.provider ? ` · ${entry.provider}` : ''} · {entry.sha.slice(0, 7)}</div>
            </button>
          ))}
      </div>
      <div style={{ overflow: 'auto', padding: '10px 14px', minWidth: 0 }}>
        {!checkpoint ? <div style={{ color: 'var(--text-2)' }}>Select a turn to see what changed since it started.</div> : <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, flex: 1, minWidth: 0 }}>Changed since “{checkpoint.label || checkpoint.sha.slice(0, 7)}”</span>
            {changes?.length ? button('restore-all', 'Restore all files', async () => { const result = await checkpoints.restore(cwd, checkpoint.sha, undefined, context); return `Restored ${result.restored}, removed ${result.deleted}` }) : null}
          </div>
          {changes === null ? <div style={{ color: 'var(--text-2)' }}>Reading…</div>
            : changes.length === 0 ? <div style={{ color: 'var(--text-2)' }}>Nothing has changed since this turn started.</div>
            : changes.map(change => (
              <div key={change.path} data-checkpoint-file={change.path} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0', fontSize: 13 }}>
                <span style={{ width: 14, color: STATUS_COLOR[change.status], fontFamily: 'var(--font-mono, monospace)' }}>{change.status}</span>
                <button type="button" onClick={() => setFile(file === change.path ? null : change.path)}
                  style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 'none', background: 'transparent', color: file === change.path ? 'var(--text)' : 'var(--text-2)', cursor: 'pointer', fontWeight: file === change.path ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis' }}>{change.path}</button>
                {button(`restore:${change.path}`, 'Restore', async () => { await checkpoints.restore(cwd, checkpoint.sha, [change.path], context); return `Restored ${change.path}` })}
              </div>
            ))}
          <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 4 }}>{file ? file : 'All files'}</div>
            {diff === null ? <div style={{ color: 'var(--text-2)' }}>Reading diff…</div> : <DiffText text={diff} />}
          </div>
        </>}
      </div>
    </div>
  )

  const review = (
    <div style={{ overflow: 'auto', padding: '10px 14px', flex: 1, minHeight: 0 }}>
      {working === null ? <div style={{ color: 'var(--text-2)' }}>Reading the working tree…</div> : <>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
          <input aria-label="Commit message" placeholder="Commit message" value={commitMessage} onChange={event => setCommitMessage(event.target.value)}
            style={{ flex: 1, minWidth: 180, fontSize: 13, padding: '4px 8px', background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6 }} />
          {button('commit', 'Commit all', async () => { const sha = await checkpoints.commit(cwd, commitMessage); setCommitMessage(''); return `Committed ${sha.slice(0, 7)}` }, false)}
          {button('pr', 'Open pull request', async () => `Opened ${await checkpoints.pullRequest(cwd, commitMessage || 'Agent changes')}`, false)}
        </div>
        {working.hunks.length === 0 && working.untracked.length === 0 ? <div style={{ color: 'var(--text-2)' }}>The working tree is clean.</div> : null}
        {working.untracked.map(path => (
          <div key={path} data-checkpoint-untracked={path} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, padding: '2px 0' }}>
            <span style={{ color: 'var(--green, #3fb950)', fontFamily: 'var(--font-mono, monospace)' }}>?</span>
            <span style={{ flex: 1 }}>{path}</span>
            {button(`delete:${path}`, 'Delete', async () => { await checkpoints.deleteUntracked(cwd, path); return `Deleted ${path}` })}
          </div>
        ))}
        {working.hunks.map((hunk, index) => (
          <div key={`${hunk.file}:${hunk.header}:${index}`} data-checkpoint-hunk={hunk.file} style={{ border: '1px solid var(--border)', borderRadius: 6, margin: '8px 0', overflow: 'hidden' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 8px', background: 'var(--surface-2)', fontSize: 12 }}>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{hunk.file} <span style={{ color: 'var(--text-2)' }}>{hunk.header}</span></span>
              {button(`reject:${index}`, 'Reject', async () => { await checkpoints.rejectHunk(cwd, hunk.patchText); return `Rejected a hunk in ${hunk.file}` })}
            </div>
            <div style={{ padding: '4px 8px' }}><DiffText text={hunk.lines.join('\n')} /></div>
          </div>
        ))}
      </>}
    </div>
  )

  const body = (
    <div data-plugin-view="checkpoints" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--surface)', color: 'var(--text)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontWeight: 600, marginRight: 8 }}>Checkpoints & review</span>
        {(['turns', 'review'] as const).map(entry => (
          <button key={entry} type="button" aria-pressed={tab === entry} onClick={() => { setTab(entry); setConfirm(null) }}
            style={{ fontSize: 12, padding: '3px 10px', borderRadius: 999, border: `1px solid ${tab === entry ? 'var(--border-2)' : 'var(--border)'}`, background: tab === entry ? 'var(--surface-3)' : 'transparent', color: tab === entry ? 'var(--text)' : 'var(--text-2)', cursor: 'pointer' }}>
            {entry === 'turns' ? `Turns${list ? ` · ${list.length}` : ''}` : `Working changes${working ? ` · ${working.hunks.length + working.untracked.length}` : ''}`}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => setGeneration(value => value + 1)} style={{ fontSize: 12 }}>Refresh</button>
        {!docked ? <button type="button" aria-label="Close" onClick={close} style={{ fontSize: 12 }}>✕</button> : null}
      </div>
      {tab === 'turns' ? turns : review}
      {error || notice ? <div role="status" style={{ padding: '8px 14px', borderTop: '1px solid var(--border)', fontSize: 12, color: error ? 'var(--red, #f85149)' : 'var(--text-2)' }}>{error ?? notice}</div> : null}
    </div>
  )
  if (docked) return body
  return (
    <div role="dialog" aria-label="Checkpoints & review" onClick={close}
      style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)' }}>
      <div onClick={event => event.stopPropagation()}
        style={{ width: 'min(1040px, calc(100vw - 32px))', height: 'min(760px, calc(100vh - 48px))', border: '1px solid var(--border-2)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 16px 48px var(--shadow, rgba(0,0,0,0.3))' }}>
        {body}
      </div>
    </div>
  )
}

export const module: PluginViewModule<WebPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'checkpoints',
  views: { checkpoints: Checkpoints },
}
