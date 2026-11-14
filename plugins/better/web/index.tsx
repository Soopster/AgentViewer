'use client'
import { useEffect, useRef, type ComponentType } from 'react'
import type { ComposerAccessoryProps, PluginComposerModule } from '../../../lib/plugins/composer'
import { PLUGIN_API_VERSION } from '../../../lib/plugins/types'
import { BETTER_STAGES, betterElapsed, betterToolsLine } from '../../../lib/plugins/betterProgress'
import { readBetterResponse } from '../../../lib/plugins/betterTransport'
import { useBetterPrompt, type BetterRunner } from '../useBetterPrompt'
const run: BetterRunner = async (session, draft, signal, onProgress) => readBetterResponse(await fetch(`/api/sessions/${encodeURIComponent(session.sessionId)}/better`, {
  method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ provider: session.provider ?? 'claude', providerInstanceId: session.providerInstanceId, cwd: session.cwd, draft }),
}), signal, onProgress)
export function BetterAccessory(props: ComposerAccessoryProps) {
  const state = useBetterPrompt(props, run), dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const node = dialog.current
    if (props.visible && state.open && !node?.open) node?.showModal()
    else if ((!props.visible || !state.open) && node?.open) node.close()
  }, [props.visible, state.open])
  if (!props.visible) return null
  const progress = state.progress
  return <>
    {(state.busy || state.notice || state.error) && <div data-better-live-rows aria-live="polite" style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, color: 'var(--text-3)', lineHeight: '20px' }}>
      {state.busy && progress ? <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 20 }}>
          <span aria-label={`Stage ${progress.stage + 1} of 6`} style={{ color: 'var(--cyan)', whiteSpace: 'nowrap' }}>{Array.from({ length: 6 }, (_, i) => <span key={i} style={{ opacity: i === progress.stage && Math.floor(state.now / 500) % 2 ? 0.35 : 1 }}>{i <= progress.stage ? '▰' : '▱'}</span>)}</span>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{BETTER_STAGES[progress.stage]}</span>
          <span style={{ whiteSpace: 'nowrap' }}>{betterElapsed(progress.startedAt, state.now)} · Escape cancels</span>
          <button type="button" onClick={state.cancel}>Cancel</button>
        </div>
        <div title={betterToolsLine(progress)} style={{ height: 20, display: 'flex', gap: 12, whiteSpace: 'nowrap' }}>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{progress.tools.slice(-3).map(tool => `${tool.status === 'running' ? '·' : tool.status === 'error' ? '✗' : '✓'} ${tool.label}`).join('  ') || 'Waiting for file reads…'}</span>
          <span>{progress.total} tools{progress.failed ? ` · ${progress.failed} failed` : ''}</span>
        </div>
      </> : <div style={{ display: 'flex', gap: 10 }}>
        <span role={state.error ? 'alert' : 'status'} style={{ color: state.error ? 'var(--red)' : undefined }}>{state.error ?? state.notice}</span>
        <button type="button" aria-label="Dismiss Better status" onClick={state.dismiss} style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>× Dismiss</button>
      </div>}
    </div>}
    <dialog ref={dialog} aria-labelledby="better-prompt-title" onCancel={event => { event.preventDefault(); state.cancel() }}
      style={{ margin: 'auto', padding: 24, width: 'min(760px, 92vw)', maxHeight: '85vh', background: 'var(--surface)', color: 'var(--text-1)', border: '1px solid var(--border)', borderRadius: 12 }}>
      <h2 id="better-prompt-title">Better prompt</h2>
      <label htmlFor="better-prompt-text">Your draft (leave empty to deepen the current conversation)</label>
      <textarea id="better-prompt-text" value={state.input} onChange={event => state.setInput(event.target.value)} rows={7}
        style={{ display: 'block', width: '100%', marginTop: 12, padding: 12, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, font: 'inherit' }} />
      <p>The rewrite returns to your composer. Edit it before sending.</p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 16, marginTop: 16 }}>
        <button type="button" onClick={state.cancel}>Cancel</button>
        <button type="button" onClick={() => void state.generate()}>Research and rewrite</button>
      </div>
    </dialog>
  </>
}
export const composer: PluginComposerModule<ComponentType<ComposerAccessoryProps>> = { apiVersion: PLUGIN_API_VERSION, pluginId: 'better', accessories: { 'better-prompt': BetterAccessory } }
