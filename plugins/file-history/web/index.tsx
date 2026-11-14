'use client'

// Web entry for File history: one file through every turn that changed it,
// with per-hunk undo and restore-to-before-a-turn — the TUI popover's
// operations, through the same `checkpoints` service.
import { useEffect, useState } from 'react'
import { PLUGIN_API_VERSION, type PluginViewModule } from '@/lib/plugins/types'
import type { WebPluginView, WebPluginViewProps } from '@/components/shell/pluginTypes'
import type { FileHistory } from '@/lib/plugins/checkpoints'

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
const ago = (at: number) => {
  const minutes = Math.round((Date.now() - at) / 60_000)
  return minutes < 1 ? 'now' : minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.round(minutes / 60)}h` : `${Math.round(minutes / 1440)}d`
}
const lineColor = (line: string) => line.startsWith('+') && !line.startsWith('+++') ? 'var(--green, #3fb950)' : line.startsWith('-') && !line.startsWith('---') ? 'var(--red, #f85149)' : line.startsWith('@@') ? 'var(--cyan, #39c5cf)' : 'var(--text-2)'

function FileHistoryView({ services, target, placement, close }: WebPluginViewProps) {
  const cwd = services.repository!.cwd
  const checkpoints = services.checkpoints!
  const path = target.path ?? null
  const docked = placement !== 'overlay'
  const [history, setHistory] = useState<FileHistory | null>(null)
  const [step, setStep] = useState<number>(-1)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    if (!path) return undefined
    const controller = new AbortController()
    checkpoints.fileHistory(cwd, path, controller.signal)
      .then(next => {
        if (controller.signal.aborted) return
        setHistory(next); setError(null)
        setStep(current => current >= 0 && current < next.steps.length ? current : next.steps.length - 1)
      })
      .catch(cause => { if (!controller.signal.aborted) setError(message(cause)) })
    return () => controller.abort()
  }, [checkpoints, cwd, path, generation])
  useEffect(() => {
    if (docked) return undefined
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [docked, close])

  const act = async (key: string, run: () => Promise<string>) => {
    if (confirm !== key) { setConfirm(key); return }
    setConfirm(null); setBusy(true); setError(null)
    try { setNotice(await run()); setGeneration(value => value + 1) } catch (cause) { setError(message(cause)) } finally { setBusy(false) }
  }
  const button = (key: string, label: string, run: () => Promise<string>) => (
    <button type="button" disabled={busy} data-file-history-action={key} onClick={() => { void act(key, run) }}
      style={{ fontSize: 12, color: confirm === key ? 'var(--red, #f85149)' : undefined }}>{confirm === key ? `${label}? click again` : label}</button>
  )
  const current = history?.steps[step] ?? null

  const body = (
    <div data-plugin-view="file-history" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--surface)', color: 'var(--text)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontWeight: 600 }}>File history</span>
        <span style={{ flex: 1, minWidth: 0, color: 'var(--text-2)', fontFamily: 'var(--font-mono, monospace)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{history?.relPath ?? path ?? ''}</span>
        <button type="button" onClick={() => setGeneration(value => value + 1)} style={{ fontSize: 12 }}>Refresh</button>
        {!docked ? <button type="button" aria-label="Close" onClick={close} style={{ fontSize: 12 }}>✕</button> : null}
      </div>
      {!path ? <div style={{ padding: 14, color: 'var(--text-2)' }}>No file to show.</div> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 280px) 1fr', minHeight: 0, flex: 1 }}>
          <div style={{ overflow: 'auto', borderRight: '1px solid var(--border)' }}>
            {history === null ? <div style={{ padding: 12, color: 'var(--text-2)' }}>Reading history…</div>
              : history.steps.length === 0 ? <div style={{ padding: 12, color: 'var(--text-2)' }}>No turn changed this file ({history.checkpointsScanned} checkpoints read).</div>
              : [...history.steps.keys()].reverse().map(index => {
                const entry = history.steps[index]!
                return (
                  <button key={entry.checkpoint.ref} type="button" data-file-history-step={index} onClick={() => { setStep(index); setConfirm(null) }}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 12px', border: 'none', borderBottom: '1px solid var(--border)', background: index === step ? 'var(--surface-3)' : 'transparent', color: 'var(--text)', cursor: 'pointer' }}>
                    <div style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.checkpoint.label || '(no prompt)'}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-2)' }}>
                      {ago(entry.checkpoint.createdAt)} · {entry.status} · <span style={{ color: 'var(--green, #3fb950)' }}>+{entry.additions}</span> <span style={{ color: 'var(--red, #f85149)' }}>−{entry.deletions}</span>{entry.until ? '' : ' · to now'}
                    </div>
                  </button>
                )
              })}
          </div>
          <div style={{ overflow: 'auto', padding: '10px 14px', minWidth: 0 }}>
            {!current || !history ? <div style={{ color: 'var(--text-2)' }}>{history ? 'Select a step.' : ''}</div> : <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, flex: 1, minWidth: 0 }}>“{current.checkpoint.label || current.checkpoint.sha.slice(0, 7)}”</span>
                {button(`restore:${current.checkpoint.sha}`, 'Restore to before this turn', async () => {
                  await checkpoints.restore(history.repoRoot, current.checkpoint.sha, [history.relPath], current.checkpoint)
                  return `Restored ${history.relPath} to before this turn`
                })}
              </div>
              {current.hunks.length === 0 ? <pre style={{ margin: 0, fontSize: 12, color: 'var(--text-2)' }}>{current.diff || 'No textual change.'}</pre>
                : current.hunks.map((hunk, index) => (
                  <div key={`${hunk.header}:${index}`} data-file-history-hunk={index} style={{ border: '1px solid var(--border)', borderRadius: 6, margin: '8px 0', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', background: 'var(--surface-2)', fontSize: 12 }}>
                      <span style={{ flex: 1, color: 'var(--text-2)' }}>{hunk.header}</span>
                      {button(`undo:${step}:${index}`, 'Undo this change', async () => {
                        await checkpoints.revertFileHunk(history.repoRoot, history.relPath, hunk.patchText)
                        return `Undid one change in ${history.relPath}`
                      })}
                    </div>
                    <pre style={{ margin: 0, padding: '4px 8px', fontFamily: 'var(--font-mono, monospace)', fontSize: 12, lineHeight: 1.5, overflow: 'auto' }}>
                      {hunk.lines.map((line, row) => <div key={row} style={{ color: lineColor(line) }}>{line || ' '}</div>)}
                    </pre>
                  </div>
                ))}
            </>}
          </div>
        </div>
      )}
      {error || notice ? <div role="status" style={{ padding: '8px 14px', borderTop: '1px solid var(--border)', fontSize: 12, color: error ? 'var(--red, #f85149)' : 'var(--text-2)' }}>{error ?? notice}</div> : null}
    </div>
  )
  if (docked) return body
  return (
    <div role="dialog" aria-label="File history" onClick={close}
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
  pluginId: 'file-history',
  views: { 'file-history': FileHistoryView },
}
